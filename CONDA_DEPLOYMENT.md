# Conda + systemd + Nginx 部署

适用于 Ubuntu 服务器。项目使用 Node.js，Conda 用来隔离 Node.js 运行环境，systemd 负责常驻，Nginx 负责对外访问。

## 已部署服务器更新

如果服务器已经部署过旧版本，按下面顺序更新。该流程会保留订单、菜单和餐品图片：

```bash
cd /srv/mifan-ordering

# 备份现有业务数据
backup_dir="/srv/mifan-backups/$(date +%F-%H%M%S)"
mkdir -p "$backup_dir"
cp -a data/menu.json "$backup_dir/"
cp -a data/mifan.sqlite "$backup_dir/" 2>/dev/null || true
cp -a data/uploads "$backup_dir/" 2>/dev/null || true

# 拉取代码与安装 SQLite 依赖
git pull --ff-only origin main
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate mifan-node
npm install --omit=dev

# 重启并验证
systemctl restart mifan-ordering
systemctl status mifan-ordering --no-pager
curl http://127.0.0.1:3000/api/health
```

新版会自动创建 `data/mifan.sqlite`。旧版本的 `data/orders.json` 不会被删除；确认 SQLite 中已有新订单后再保留或归档旧文件。

## 1. 安装系统组件

```bash
apt update
apt install -y git nginx curl openssl
```

确认 Conda：

```bash
conda --version
```

如果服务器没有 Conda：

```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
bash Miniconda3-latest-Linux-x86_64.sh -b -p /opt/miniconda3
source /opt/miniconda3/etc/profile.d/conda.sh
```

## 2. 创建 Node.js 环境

```bash
source "$(conda info --base)/etc/profile.d/conda.sh"
conda create -y -n mifan-node --override-channels -c conda-forge nodejs=22
conda activate mifan-node
node --version
npm --version
```

本项目使用 SQLite，需要安装生产依赖：

```bash
npm install --omit=dev
```

## 3. 拉取项目

```bash
mkdir -p /srv
cd /srv
git clone https://github.com/gymiao/mifan-ordering.git
cd /srv/mifan-ordering
```

以后更新代码：

```bash
cd /srv/mifan-ordering
git pull --ff-only
```

## 4. 配置管理员令牌

生成随机令牌：

```bash
openssl rand -hex 32
```

创建配置文件：

```bash
nano /etc/mifan-ordering.env
```

写入以下内容，把占位符替换成刚才生成的随机字符串：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
```

```bash
chmod 600 /etc/mifan-ordering.env
```

不要把这个文件提交到 GitHub。后台初始管理员为 `root` / `kgjy`，初始普通用户为 `user` / `kgjy`；首次登录后请创建新的管理员账户并修改默认密码。

## 5. 创建 systemd 服务

获取 Conda 环境中 Node.js 的路径：

```bash
CONDA_BASE="$(conda info --base)"
NODE_BIN="$CONDA_BASE/envs/mifan-node/bin/node"
echo "$NODE_BIN"
```

创建服务文件：

```bash
nano /etc/systemd/system/mifan-ordering.service
```

写入以下内容。如果 `NODE_BIN` 不是 `/opt/miniconda3/envs/mifan-node/bin/node`，请替换 `ExecStart` 的路径：

```ini
[Unit]
Description=Mifan Ordering Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/mifan-ordering
EnvironmentFile=/etc/mifan-ordering.env
ExecStart=/opt/miniconda3/envs/mifan-node/bin/node /srv/mifan-ordering/server.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

启动并设置开机自启：

```bash
systemctl daemon-reload
systemctl enable --now mifan-ordering
systemctl status mifan-ordering
```

验证后端：

```bash
curl http://127.0.0.1:3000/api/health
```

## 6. 配置 Nginx

```bash
nano /etc/nginx/sites-available/mifan-ordering
```

写入：

```nginx
server {
    listen 80;
    server_name 101.96.193.137;

    client_max_body_size 128k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(css|js|svg|png|jpg|jpeg|webp)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 1d;
        add_header Cache-Control "public, max-age=86400";
    }
}
```

启用并检查：

```bash
ln -s /etc/nginx/sites-available/mifan-ordering /etc/nginx/sites-enabled/mifan-ordering
nginx -t
systemctl reload nginx
```

## 7. 访问地址

点餐页面：

```text
http://101.96.193.137/
```

菜单管理后台：

```text
http://101.96.193.137/admin.html
```

当前使用 IP 地址时先使用 HTTP。正式上线建议绑定域名，然后使用 Certbot 配置 HTTPS。

## 8. 更新与备份

```bash
cd /srv/mifan-ordering
git pull --ff-only
systemctl restart mifan-ordering
systemctl status mifan-ordering
```

更新菜单或代码前备份数据：

```bash
cp /srv/mifan-ordering/data/menu.json /srv/mifan-ordering/data/menu.json.bak
cp /srv/mifan-ordering/data/mifan.sqlite /srv/mifan-ordering/data/mifan.sqlite.bak 2>/dev/null || true
```

餐品图片保存在 `/srv/mifan-ordering/data/uploads/`，该目录已被 `.gitignore` 排除，不会进入 Git。备份时也要包含这个目录：

```bash
tar -czf /srv/mifan-ordering-data-$(date +%F).tar.gz /srv/mifan-ordering/data
```

当前文件存储适合单店内测和低流量运行。正式营业前建议迁移到 PostgreSQL，并增加 Redis、支付回调、订单通知和备份告警。
