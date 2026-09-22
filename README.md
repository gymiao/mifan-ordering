# 米饭食堂点餐系统

一个可直接运行的前后端点餐 MVP。前端使用原生 HTML/CSS/JavaScript，后端使用 Node.js 内置 HTTP 服务，不依赖第三方运行库，适合快速验证和低成本部署。

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
- 订单持久化到 `data/orders.json`，采用临时文件替换避免写入半成品
- 菜单缓存、静态资源长缓存、健康检查接口
- `/admin.html` 菜单管理后台，支持新增、编辑、删除、上下架
- 管理写接口使用 `ADMIN_TOKEN` 鉴权，菜单公开接口保持只读

测试文件位于 `test/`，覆盖菜单契约、订单核心规则和管理员菜品数据校验，可在具备 Node.js 20+ 的 CI 或服务器环境中执行 `npm test`。

## API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/menu` | 获取餐厅、分类和菜品 |
| `POST` | `/api/admin/menu` | 新增菜品，需要 `Authorization: Bearer <ADMIN_TOKEN>` |
| `PUT` | `/api/admin/menu/:id` | 编辑或上下架菜品，需要管理员令牌 |
| `DELETE` | `/api/admin/menu/:id` | 删除菜品，需要管理员令牌 |
| `POST` | `/api/orders` | 创建订单，价格以后端为准 |
| `GET` | `/api/orders/:id` | 查询单个订单 |

创建订单示例：

```json
{
  "items": [{ "id": "beef-rice", "quantity": 2 }],
  "fulfillment": "delivery",
  "contact": "13800000000",
  "address": "上海市黄浦区示例路 1 号",
  "note": "不要香菜"
}
```

## 上服务器的建议方案

当前版本适合演示、内测和单店低流量运行。正式营业建议保持现有 API 契约，将订单存储换成 PostgreSQL，并增加 Redis 防重复下单和限流。推荐拓扑：

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
export ADMIN_TOKEN='请替换为随机长字符串'
docker compose up -d --build
curl http://127.0.0.1:3000/api/health
```

菜单后台地址为 `https://你的域名/admin.html`。管理员令牌只通过服务器环境变量配置，不写入仓库；后台浏览器仅保存在当前会话的 `sessionStorage` 中。

复制 `deploy/nginx.conf` 到服务器 Nginx 配置目录，替换其中的域名，再用 Certbot 或云厂商证书启用 HTTPS。`order-data` 卷用于保留订单文件；升级到 PostgreSQL 后应删除文件存储并把数据库凭据放入服务器环境变量。
