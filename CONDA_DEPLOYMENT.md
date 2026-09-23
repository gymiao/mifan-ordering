# Conda + systemd + Nginx 部署

适用于 Ubuntu 服务器。项目使用 Node.js，Conda 用来隔离 Node.js 运行环境，systemd 负责常驻，Nginx 负责对外访问。

## 已部署服务器更新

每次代码推送到 GitHub 后，在服务器执行以下内容。该流程会保留订单、菜单、用户账户和餐品图片。`git reset --hard origin/main` 会强制让服务器代码与 GitHub 的 `main` 分支一致，但不会删除 `data/` 中未被 Git 跟踪的业务数据。

```bash
cd /srv/mifan-ordering

# 备份现有业务数据
backup_dir="/srv/mifan-backups/$(date +%F-%H%M%S)"
mkdir -p "$backup_dir"
cp -a data/menu.json "$backup_dir/" 2>/dev/null || true
cp -a data/mifan.sqlite "$backup_dir/" 2>/dev/null || true
cp -a data/uploads "$backup_dir/" 2>/dev/null || true

# 服务器本地代码强制对齐 GitHub main
git fetch origin
git reset --hard origin/main

# 激活 Conda 环境并安装/更新依赖
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate mifan-node
npm install --omit=dev

# 重启服务并检查后端
systemctl restart mifan-ordering
systemctl status mifan-ordering --no-pager
curl http://127.0.0.1:3000/api/health
```

预期健康检查返回包含 `"ok":true` 的 JSON。若 `npm install` 编译 `better-sqlite3` 失败，先执行 `apt update && apt install -y build-essential python3 make g++`，再重新执行 `npm install --omit=dev`。

最后在浏览器检查首页和 `http://服务器IP/admin.html`：分别登录普通用户和管理员，创建一笔测试订单，并在后台确认订单出现及状态可更新。

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
git fetch origin
git reset --hard origin/main
```

完整更新仍应使用文档开头的“已部署服务器更新”步骤，以便同时备份数据、安装依赖并重启服务。

## 4. 配置运行环境

创建配置文件：

```bash
nano /etc/mifan-ordering.env
```

写入以下内容：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
```

```bash
chmod 600 /etc/mifan-ordering.env
```

不要把这个文件提交到 GitHub。后台使用用户名和密码登录；首次登录后请创建新的管理员账户并更换默认账户密码。

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
git fetch origin
git reset --hard origin/main
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate mifan-node
npm install --omit=dev
systemctl restart mifan-ordering
curl http://127.0.0.1:3000/api/health
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
