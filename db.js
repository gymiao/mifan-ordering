const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(process.env.DB_PATH || path.join(dataDir, 'mifan.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
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
`);

const insertOrder = db.transaction((order) => {
  db.prepare(`INSERT INTO orders (id,status,fulfillment,contact,address,note,subtotal,delivery_fee,total,estimated_minutes,created_at)
    VALUES (@id,@status,@fulfillment,@contact,@address,@note,@subtotal,@deliveryFee,@total,@estimatedMinutes,@createdAt)`).run(order);
  const insertItem = db.prepare(`INSERT INTO order_items (order_id,item_id,name,price,quantity,subtotal)
    VALUES (@orderId,@id,@name,@price,@quantity,@subtotal)`);
  for (const item of order.items) insertItem.run({ orderId: order.id, ...item });
});

function rowsToOrders(rows) {
  return rows.map((row) => ({
    id: row.id, status: row.status, fulfillment: row.fulfillment, contact: row.contact,
    address: row.address, note: row.note, subtotal: row.subtotal, deliveryFee: row.delivery_fee,
    total: row.total, estimatedMinutes: row.estimated_minutes, createdAt: row.created_at,
    items: db.prepare('SELECT item_id AS id, name, price, quantity, subtotal FROM order_items WHERE order_id = ? ORDER BY id').all(row.id)
  }));
}

function getOrder(id) {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return row ? rowsToOrders([row])[0] : null;
}

function listOrders(status = 'all') {
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all()
    : db.prepare("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC").all(status);
  return rowsToOrders(rows);
}

function updateOrderStatus(id, status) {
  if (!['ordered', 'cooking', 'completed'].includes(status)) throw new Error('订单状态无效');
  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  return result.changes ? getOrder(id) : null;
}

module.exports = { db, insertOrder, getOrder, listOrders, updateOrderStatus };
