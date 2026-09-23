const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(process.env.DB_PATH || path.join(dataDir, 'mifan.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered', 'cooking', 'completed')),
    fulfillment TEXT NOT NULL CHECK(fulfillment IN ('delivery', 'pickup')),
    contact TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    subtotal REAL NOT NULL,
    delivery_fee REAL NOT NULL,
    total REAL NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    subtotal REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name);
if (!orderColumns.includes('user_id')) db.exec('ALTER TABLE orders ADD COLUMN user_id INTEGER');
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC)');

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, saved) {
  const [salt, expected] = String(saved).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function seedUsers() {
  const insert = db.prepare('INSERT OR IGNORE INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)');
  const now = new Date().toISOString();
  insert.run('root', passwordHash('kgjy'), 'admin', now);
  insert.run('user', passwordHash('kgjy'), 'user', now);
}
seedUsers();

const insertOrder = db.transaction((order) => {
  db.prepare(`INSERT INTO orders (id,user_id,status,fulfillment,contact,address,note,subtotal,delivery_fee,total,estimated_minutes,created_at)
    VALUES (@id,@userId,@status,@fulfillment,@contact,@address,@note,@subtotal,@deliveryFee,@total,@estimatedMinutes,@createdAt)`).run(order);
  const insertItem = db.prepare(`INSERT INTO order_items (order_id,item_id,name,price,quantity,subtotal)
    VALUES (@orderId,@id,@name,@price,@quantity,@subtotal)`);
  for (const item of order.items) insertItem.run({ orderId: order.id, ...item });
});

function rowsToOrders(rows) {
  return rows.map((row) => ({
    id: row.id, userId: row.user_id, username: row.username || '', status: row.status, fulfillment: row.fulfillment, contact: row.contact,
    address: row.address, note: row.note, subtotal: row.subtotal, deliveryFee: row.delivery_fee,
    total: row.total, estimatedMinutes: row.estimated_minutes, createdAt: row.created_at,
    items: db.prepare('SELECT item_id AS id, name, price, quantity, subtotal FROM order_items WHERE order_id = ? ORDER BY id').all(row.id)
  }));
}

function getOrder(id) {
  const row = db.prepare('SELECT orders.*, users.username FROM orders LEFT JOIN users ON users.id = orders.user_id WHERE orders.id = ?').get(id);
  return row ? rowsToOrders([row])[0] : null;
}

function listOrders(status = 'all') {
  const rows = status === 'all'
    ? db.prepare('SELECT orders.*, users.username FROM orders LEFT JOIN users ON users.id = orders.user_id ORDER BY orders.created_at DESC').all()
    : db.prepare("SELECT orders.*, users.username FROM orders LEFT JOIN users ON users.id = orders.user_id WHERE orders.status = ? ORDER BY orders.created_at DESC").all(status);
  return rowsToOrders(rows);
}

function listOrdersByUser(userId) {
  const rows = db.prepare('SELECT orders.*, users.username FROM orders LEFT JOIN users ON users.id = orders.user_id WHERE orders.user_id = ? ORDER BY orders.created_at DESC').all(userId);
  return rowsToOrders(rows);
}

function updateOrderStatus(id, status) {
  if (!['ordered', 'cooking', 'completed'].includes(status)) throw new Error('订单状态无效');
  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  return result.changes ? getOrder(id) : null;
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const createdAt = new Date().toISOString();
  const expiresAt = '9999-12-31T23:59:59.999Z';
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(tokenHash, user.id, expiresAt, createdAt);
  return { token: rawToken, user: { id: user.id, username: user.username, role: user.role, expiresAt } };
}
function getSession(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.prepare(`SELECT users.id, users.username, users.role, users.active, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?`).get(tokenHash);
  if (!session || !session.active || session.expires_at <= new Date().toISOString()) return null;
  return { id: session.id, username: session.username, role: session.role, expiresAt: session.expires_at };
}
function logout(token) {
  if (!token) return false;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash).changes > 0;
}
function listUsers() { return db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY id').all(); }
function createUser(username, password, role) {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) throw new Error('用户名需要 3 至 32 位字母、数字、下划线或短横线');
  if (String(password).length < 4 || String(password).length > 128) throw new Error('密码长度需要为 4 至 128 位');
  if (!['admin', 'user'].includes(role)) throw new Error('用户角色无效');
  const result = db.prepare('INSERT INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)')
    .run(username, passwordHash(password), role, new Date().toISOString());
  return db.prepare('SELECT id,username,role,active,created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
}
function updateUser(id, input) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;
  const role = input.role === undefined ? user.role : input.role;
  const active = input.active === undefined ? user.active : Number(Boolean(input.active));
  if (!['admin', 'user'].includes(role)) throw new Error('用户角色无效');
  if (user.username === 'root' && (!active || role !== 'admin')) throw new Error('系统管理员 root 不能被停用或降级');
  if (input.password !== undefined && (String(input.password).length < 4 || String(input.password).length > 128)) throw new Error('密码长度需要为 4 至 128 位');
  const hash = input.password === undefined ? user.password_hash : passwordHash(input.password);
  db.prepare('UPDATE users SET password_hash = ?, role = ?, active = ? WHERE id = ?').run(hash, role, active, id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return db.prepare('SELECT id,username,role,active,created_at FROM users WHERE id = ?').get(id);
}

module.exports = { db, insertOrder, getOrder, listOrders, listOrdersByUser, updateOrderStatus, login, getSession, logout, listUsers, createUser, updateUser };
