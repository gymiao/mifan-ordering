const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { insertOrder, getOrder, listOrders, listOrdersByUser, updateOrderStatus, login, getSession, listUsers, createUser, updateUser } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const MENU_FILE = path.join(DATA_DIR, 'menu.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_BODY = 64 * 1024;
const MAX_UPLOAD = 8 * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
let menu = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));
let menuById = new Map(menu.items.map((item) => [item.id, item]));

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function readBody(req) {
  return readBuffer(req, MAX_BODY).then((body) => {
    try { return JSON.parse(body.toString('utf8') || '{}'); } catch { throw new Error('JSON 格式错误'); }
  });
}

function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new Error('上传内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks)); });
    req.on('error', (error) => { if (!settled) reject(error); });
  });
}

function parseMultipart(body, contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('上传格式不正确');
  const boundary = `--${match[1] || match[2]}`;
  const parts = body.toString('latin1').split(boundary);
  for (const rawPart of parts) {
    const part = rawPart.replace(/^\r\n|\r\n--$|\r\n$/g, '');
    const separator = part.indexOf('\r\n\r\n');
    if (separator < 0) continue;
    const headers = part.slice(0, separator);
    const content = Buffer.from(part.slice(separator + 4), 'latin1');
    const disposition = headers.match(/name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!disposition) continue;
    if (disposition[2]) return { field: disposition[1], filename: disposition[2], content };
  }
  throw new Error('请选择图片文件');
}

function detectImageExtension(file) {
  const type = file.content;
  if (type.length >= 8 && type.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (type.length >= 3 && type.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'jpg';
  if (type.length >= 12 && type.toString('ascii', 0, 4) === 'RIFF' && type.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('只支持 JPG、PNG 或 WebP 图片');
}

function persistMenu() {
  const tempFile = `${MENU_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(menu, null, 2) + '\n');
  fs.renameSync(tempFile, MENU_FILE);
  menuById = new Map(menu.items.map((item) => [item.id, item]));
}

function requireAdmin(req) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) return { username: 'legacy-admin', role: 'admin' };
  const user = getSession(token);
  if (!user || user.role !== 'admin') throw new Error('管理员身份验证失败');
  return user;
}

function requireUser(req) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const user = getSession(token);
  if (!user) throw new Error('用户身份验证失败');
  return user;
}

function slugify(value) {
  const slug = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || `item-${Date.now()}`;
}

function normalizeMenuItem(input, existingId) {
  const name = String(input.name || '').trim().slice(0, 40);
  const description = String(input.description || '').trim().slice(0, 120);
  const price = Number(input.price);
  const category = String(input.category || '').trim();
  if (!name || !description || !category || !Number.isFinite(price) || price <= 0 || price > 9999) {
    throw new Error('菜品名称、描述、分类和价格不能为空');
  }
  if (!menu.categories.some((entry) => entry.id === category)) throw new Error('菜品分类不存在');
  const id = existingId || slugify(input.id || name);
  if (!existingId && menuById.has(id)) throw new Error('菜品 ID 已存在');
  return {
    id,
    category,
    name,
    description,
    image: typeof input.image === 'string' && input.image.startsWith('/uploads/') ? input.image.slice(0, 180) : '',
    price: Math.round(price * 100) / 100,
    sales: Number.isInteger(Number(input.sales)) ? Math.max(0, Number(input.sales)) : 0,
    emoji: String(input.emoji || '🍱').slice(0, 4),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#7da66a',
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 4) : [],
    available: input.available !== false
  };
}

function adminError(res, error) {
  const status = error.message.includes('身份验证') ? 401 : error.message.includes('尚未配置') ? 503 : 400;
  return json(res, status, { error: error.message });
}

function calculateOrder(input) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('购物车为空');
  if (!['delivery', 'pickup'].includes(input.fulfillment)) throw new Error('请选择取餐方式');

  const merged = new Map();
  for (const line of input.items) {
    const quantity = Number(line.quantity);
    if (!menuById.has(line.id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error('商品或数量无效');
    }
    merged.set(line.id, Math.min(20, (merged.get(line.id) || 0) + quantity));
  }

  const lines = [...merged].map(([id, quantity]) => {
    const item = menuById.get(id);
    if (!item.available) throw new Error(`${item.name} 已售罄`);
    return { id, name: item.name, price: item.price, quantity, subtotal: item.price * quantity };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const deliveryFee = input.fulfillment === 'delivery' && subtotal < menu.restaurant.freeDeliveryAt
    ? menu.restaurant.deliveryFee : 0;
  const contact = String(input.contact || '').trim().slice(0, 40);
  const address = String(input.address || '').trim().slice(0, 160);
  return {
    status: 'ordered',
    fulfillment: input.fulfillment,
    contact,
    address,
    note: String(input.note || '').trim().slice(0, 120),
    items: lines,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    createdAt: new Date().toISOString(),
    estimatedMinutes: input.fulfillment === 'pickup' ? 20 : 35
  };
}

function createOrder(input, user) {
  if (!user?.id) throw new Error('请先登录后再下单');
  const order = {
    id: `MF${Date.now().toString().slice(-8)}${crypto.randomInt(10, 99)}`,
    userId: user.id,
    ...calculateOrder(input)
  };
  insertOrder(order);
  return order;
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return json(res, 403, { error: '禁止访问' });
  fs.readFile(filePath, (error, data) => {
    if (error) return json(res, 404, { error: '页面不存在' });
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
    });
    res.end(data);
  });
}

function serveUpload(res, pathname) {
  const filename = path.basename(decodeURIComponent(pathname.slice('/uploads/'.length)));
  if (!filename || filename !== decodeURIComponent(pathname.slice('/uploads/'.length))) return json(res, 400, { error: '图片地址无效' });
  const filePath = path.resolve(UPLOAD_DIR, filename);
  if (!filePath.startsWith(`${UPLOAD_DIR}${path.sep}`)) return json(res, 403, { error: '禁止访问' });
  fs.readFile(filePath, (error, data) => {
    if (error) return json(res, 404, { error: '图片不存在' });
    const ext = path.extname(filePath).toLowerCase();
    const contentType = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, time: new Date().toISOString() });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    return serveUpload(res, url.pathname);
  }
  if (req.method === 'GET' && url.pathname === '/api/menu') {
    return json(res, 200, menu, { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    try {
      const input = await readBody(req);
      const session = login(String(input.username || ''), String(input.password || ''));
      return session ? json(res, 200, session) : json(res, 401, { error: '用户名或密码错误' });
    } catch (error) { return json(res, 400, { error: error.message || '登录失败' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    try { return json(res, 200, { user: requireUser(req) }); }
    catch (error) { return json(res, 401, { error: error.message }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    try { requireAdmin(req); return json(res, 200, { users: listUsers() }); }
    catch (error) { return adminError(res, error); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/users') {
    try {
      requireAdmin(req);
      const input = await readBody(req);
      return json(res, 201, { user: createUser(String(input.username || ''), String(input.password || ''), input.role) });
    } catch (error) { return adminError(res, error); }
  }
  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (req.method === 'PATCH' && adminUserMatch) {
    try {
      requireAdmin(req);
      const user = updateUser(Number(adminUserMatch[1]), await readBody(req));
      return user ? json(res, 200, { user }) : json(res, 404, { error: '用户不存在' });
    } catch (error) { return adminError(res, error); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/uploads') {
    try {
      requireAdmin(req);
      const file = parseMultipart(await readBuffer(req, MAX_UPLOAD), req.headers['content-type']);
      const extension = detectImageExtension(file);
      const filename = `${crypto.randomUUID()}.${extension}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.content);
      return json(res, 201, { url: `/uploads/${filename}`, size: file.content.length });
    } catch (error) { return adminError(res, error); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/menu') {
    try {
      requireAdmin(req);
      const item = normalizeMenuItem(await readBody(req));
      menu.items.push(item);
      persistMenu();
      return json(res, 201, { item });
    } catch (error) { return adminError(res, error); }
  }
  const adminMenuMatch = url.pathname.match(/^\/api\/admin\/menu\/([A-Za-z0-9\u4e00-\u9fff-]+)$/);
  if (adminMenuMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    try {
      requireAdmin(req);
      const id = adminMenuMatch[1];
      const index = menu.items.findIndex((item) => item.id === id);
      if (index < 0) return json(res, 404, { error: '菜品不存在' });
      if (req.method === 'DELETE') {
        menu.items.splice(index, 1);
        persistMenu();
        return json(res, 200, { deleted: id });
      }
      const input = await readBody(req);
      const item = normalizeMenuItem({ ...menu.items[index], ...input }, id);
      menu.items[index] = item;
      persistMenu();
      return json(res, 200, { item });
    } catch (error) { return adminError(res, error); }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
    try {
      requireAdmin(req);
      const status = url.searchParams.get('status') || 'all';
      if (!['all', 'ordered', 'cooking', 'completed'].includes(status)) throw new Error('订单状态无效');
      return json(res, 200, { orders: listOrders(status) });
    } catch (error) { return adminError(res, error); }
  }
  const adminOrderMatch = url.pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9-]+)\/status$/);
  if (req.method === 'PATCH' && adminOrderMatch) {
    try {
      requireAdmin(req);
      const input = await readBody(req);
      const order = updateOrderStatus(adminOrderMatch[1], input.status);
      return order ? json(res, 200, { order }) : json(res, 404, { error: '订单不存在' });
    } catch (error) { return adminError(res, error); }
  }
  if (req.method === 'POST' && url.pathname === '/api/orders') {
    try {
      const order = createOrder(await readBody(req), requireUser(req));
      return json(res, 201, { order });
    } catch (error) {
      return json(res, 400, { error: error.message || '下单失败' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/orders/my') {
    try {
      const user = requireUser(req);
      return json(res, 200, { orders: listOrdersByUser(user.id) });
    } catch (error) { return json(res, 401, { error: error.message }); }
  }
  const match = url.pathname.match(/^\/api\/orders\/([A-Za-z0-9-]+)$/);
  if (req.method === 'GET' && match) {
    try {
      const user = requireUser(req);
      const order = getOrder(match[1]);
      if (!order || (user.role !== 'admin' && order.userId !== user.id)) return json(res, 404, { error: '订单不存在' });
      return json(res, 200, { order });
    } catch (error) { return json(res, 401, { error: error.message }); }
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
  return json(res, 405, { error: '请求方法不支持' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`荷包蛋餐厅已启动：http://${HOST}:${PORT}`);
  });
}

module.exports = { calculateOrder, createOrder, menu, normalizeMenuItem };
