import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import dotenv from 'dotenv'

dotenv.config()

const databaseFile = path.resolve(process.cwd(), process.env.DATABASE_FILE || './data/nusa.db')
fs.mkdirSync(path.dirname(databaseFile), { recursive: true })

export const db = new Database(databaseFile)
db.pragma('foreign_keys = ON')
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    old_price INTEGER,
    image TEXT NOT NULL,
    tag TEXT,
    description TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cart_items (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (user_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    total INTEGER NOT NULL CHECK (total >= 0),
    shipping_name TEXT NOT NULL,
    shipping_phone TEXT NOT NULL,
    shipping_address TEXT NOT NULL,
    payment_provider TEXT,
    payment_order_id TEXT,
    payment_token TEXT,
    payment_redirect_url TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    quantity INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
`)

const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name)
for (const column of [
  ['payment_provider', 'TEXT'],
  ['payment_order_id', 'TEXT'],
  ['payment_token', 'TEXT'],
  ['payment_redirect_url', 'TEXT'],
  ['paid_at', 'TEXT'],
]) {
  if (!orderColumns.includes(column[0])) db.exec(`ALTER TABLE orders ADD COLUMN ${column[0]} ${column[1]}`)
}

const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count
if (productCount === 0) {
  const seed = db.prepare(`INSERT INTO products (name, category, price, old_price, image, tag, description, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const seedProducts = [
    ['Aura Knit Cardigan', 'Fashion', 389000, 489000, 'https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=700&q=85', 'Best seller', 'Cardigan rajut lembut untuk gaya santai yang hangat.', 20],
    ['Ceramic Mood Lamp', 'Home living', 279000, null, 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=700&q=85', 'New', 'Lampu keramik dengan cahaya hangat untuk ruang favoritmu.', 15],
    ['Luna Leather Bag', 'Accessories', 549000, 699000, 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=700&q=85', 'Popular', 'Tas kulit dengan ruang yang cukup untuk kebutuhan harian.', 12],
    ['Daily Ritual Set', 'Wellness', 199000, null, 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=700&q=85', 'Limited', 'Set perawatan kecil untuk memulai dan menutup hari.', 30]
  ]
  const insertMany = db.transaction(() => seedProducts.forEach((product) => seed.run(...product)))
  insertMany()
}
