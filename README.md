# 荷包蛋餐厅点餐系统

一个可直接运行的前后端点餐 MVP。前端使用原生 HTML/CSS/JavaScript，后端使用 Node.js HTTP 服务和 SQLite 数据库，适合快速验证和低成本部署。

服务器使用 Conda 部署时，请直接查看 [CONDA_DEPLOYMENT.md](CONDA_DEPLOYMENT.md)。

## 本地运行

需要 Node.js 20 或更高版本：

```bash
npm start
```

打开 `http://localhost:3000`。健康检查地址为 `GET /api/health`。

## 已实现

- 响应式菜单首页，兼顾手机扫码和桌面访问
- 分类切换、关键词搜索、商品数量调整
- 购物车本地持久化，交互无需等待网络
- 外卖配送与到店自取切换
- 后端重新校验商品、价格、数量和配送费
- 订单和订单明细持久化到 `data/mifan.sqlite`，启用 WAL 和索引
- 菜单缓存、静态资源长缓存、健康检查接口
- `/admin.html` 菜单管理后台，支持新增、编辑、删除、上下架
- 订单中心支持按状态筛选、按下单时间倒序显示和状态更新
- 顾客页与商家后台互相提供入口；下单和菜品都支持深链接分享
- 管理后台支持 JPG、PNG、WebP 餐品图片上传，单张最大 8MB
- 管理后台使用账户登录，菜单公开接口保持只读

测试文件位于 `test/`，覆盖菜单契约、订单核心规则和管理员菜品数据校验，可在具备 Node.js 20+ 的 CI 或服务器环境中执行 `npm test`。

## API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/menu` | 获取餐厅、分类和菜品 |
| `POST` | `/api/auth/login` | 用户登录，返回会话令牌 |
| `POST` | `/api/auth/logout` | 退出当前登录会话 |
| `POST` | `/api/admin/menu` | 新增菜品，需要管理员会话 |
| `PUT` | `/api/admin/menu/:id` | 编辑或上下架菜品，需要管理员会话 |
| `DELETE` | `/api/admin/menu/:id` | 删除菜品，需要管理员会话 |
| `POST` | `/api/admin/uploads` | 上传餐品图片，需要管理员会话 |
| `POST` | `/api/orders` | 创建订单，需要顾客登录，价格以后端为准 |
| `GET` | `/api/orders/my` | 查询当前登录用户的订单 |
| `GET` | `/api/orders/:id` | 查询当前用户自己的单个订单 |
| `GET` | `/api/admin/orders?status=all` | 管理员查看订单，需要管理员令牌 |
| `PATCH` | `/api/admin/orders/:id/status` | 管理员更新订单状态，需要管理员令牌 |

创建订单示例：

```json
{
  "items": [{ "id": "beef-rice", "quantity": 2 }],
  "fulfillment": "pickup",
  "note": "不要香菜"
}
```

顾客必须登录才可提交订单，订单会关联用户 ID。订单状态使用 `ordered`（已下单）、`cooking`（正在做）和 `completed`（已完成）。

下单成功会生成 `/admin.html?order=<订单号>`，商家登录后会自动定位该订单。管理后台的“分享”按钮会生成 `/?dish=<菜品ID>`；顾客打开后会自动聚焦对应菜品。

## 上服务器的建议方案

当前版本适合演示、内测和单店低流量运行。正式营业建议保持现有 API 契约，将 SQLite 迁移到 PostgreSQL，并增加 Redis 防重复下单和限流。推荐拓扑：

```text
浏览器 / 微信扫码
       │ HTTPS
       ▼
CDN 或 Nginx（静态缓存、TLS、压缩）
       │
       ▼
Node.js 应用（2 个或更多实例）
       ├── PostgreSQL（菜单、订单、支付记录）
       ├── Redis（会话、限流、幂等键）
       └── 对象存储（菜品图片）
```

生产部署还需补齐：微信/支付宝支付回调验签、用户登录或桌号二维码、商家接单后台、订单状态推送、库存扣减、日志告警、数据库备份。支付状态必须以后端收到的支付平台回调为准。

建议分三阶段上线：

1. 内测：当前版本部署到单台服务器，Nginx 终止 HTTPS，使用 Docker 托管 Node 进程。本仓库已提供 `Dockerfile`、`compose.yaml` 和 `deploy/nginx.conf`。
2. 试营业：接入 PostgreSQL、商家后台、短信或微信通知，并完成压力测试和备份恢复演练。
3. 正式营业：接入支付、Redis 幂等和限流、双实例滚动发布、监控告警与 CDN 图片处理。

## 性能目标

- 首屏静态资源 gzip 后控制在 150 KB 内（不含可选在线字体）
- 菜单接口在同地域服务器上 P95 小于 100 ms
- 加减购物车、筛选、搜索均在浏览器本地完成，目标响应小于 16 ms
- 菜单接口允许 60 秒缓存并支持 5 分钟过期重验证

页面仅使用系统字体，不依赖外部字体、图片或前端 CDN，服务器不可访问公网时仍可完整加载。

## Docker 内测部署

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/api/health
```

菜单后台地址为 `https://你的域名/admin.html`。初始管理员是 `root`，初始密码是 `kgjy`；初始普通用户是 `user`，初始密码也是 `kgjy`。登录 Token 默认长期有效，浏览器关闭后仍会保留；管理员停用用户即可撤销该用户全部访问。

复制 `deploy/nginx.conf` 到服务器 Nginx 配置目录，替换其中的域名，再用 Certbot 或云厂商证书启用 HTTPS。`order-data` 卷用于保留订单文件；升级到 PostgreSQL 后应删除文件存储并把数据库凭据放入服务器环境变量。
