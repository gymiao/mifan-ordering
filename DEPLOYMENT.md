# 部署方案

本项目确定采用“Docker Compose + Nginx + HTTPS”的单服务器部署方案。

## 当前阶段：内测 / 单店上线

```text
用户浏览器 / 微信扫码
          │ HTTPS
          ▼
Nginx（TLS、静态缓存、反向代理）
          │ 127.0.0.1:3000
          ▼
Node.js 点餐服务（Docker 容器）
          │
          ▼
Docker volume：data/orders.json、data/menu.json
```

服务器只暴露 80/443，Node.js 仅绑定到本机回环地址。菜单管理后台使用 `/admin.html`，写操作通过 `ADMIN_TOKEN` 保护。菜单和订单文件通过 Docker volume 保留，容器重建不会丢失数据。

## 上线步骤

1. 安装 Docker、Docker Compose 和 Nginx。
2. 配置服务器环境变量：`ADMIN_TOKEN` 使用随机长字符串，不提交到 Git。
3. 执行 `docker compose up -d --build`。
4. Nginx 使用 `deploy/nginx.conf` 反向代理到 `127.0.0.1:3000`。
5. 使用云厂商证书或 Certbot 配置 HTTPS。
6. 验证 `/api/health`、首页和 `/admin.html`，再开放域名二维码。

## 正式营业升级

当订单量增加或需要多实例时，保持现有 HTTP API，把订单和菜单迁移到 PostgreSQL；使用 Redis 保存幂等键、限流计数和短期会话；菜品图片迁移到对象存储并由 CDN 分发。支付以支付平台回调为最终状态，增加商家接单、库存、通知、备份和告警。

## 不提交的内容

`.env`、`data/orders.json`、管理员令牌、支付密钥和服务器私钥都不进入 Git 仓库。服务器凭据只通过环境变量或密钥管理系统注入。
