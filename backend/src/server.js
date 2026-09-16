import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { db } from './db.js'

dotenv.config()

const app = express()
const port = Number(process.env.PORT || 4000)
const jwtSecret = process.env.JWT_SECRET || 'development-only-change-me'
const resetTtl = Number(process.env.RESET_TOKEN_TTL_MINUTES || 30) * 60 * 1000
const midtransServerKey = process.env.MIDTRANS_SERVER_KEY || ''
const midtransApiUrl = process.env.MIDTRANS_API_URL || 'https://app.sandbox.midtrans.com/snap/v1/transactions'
const clientOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim()
const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY || ''

app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((item) => item.trim()) }))
app.use(express.json({ limit: '1mb' }))

const captchaSchema = z.object({ captchaToken: z.string().min(1, 'CAPTCHA wajib diisi') })
const registerSchema = z.object({
  username: z.string().trim().min(2).max(40),
  email: z.string().trim().email().max(120),
  password: z.string().min(6).max(72),
  confirmPassword: z.string().min(6).max(72),
  phone: z.string().trim().min(8).max(20),
  captchaToken: z.string().min(1, 'CAPTCHA wajib diisi'),
}).refine((value) => value.password === value.confirmPassword, { message: 'Konfirmasi password tidak cocok', path: ['confirmPassword'] })
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1), captchaToken: z.string().min(1, 'CAPTCHA wajib diisi') })
const emailSchema = z.object({ email: z.string().trim().email(), captchaToken: z.string().min(1, 'CAPTCHA wajib diisi') })
const resetSchema = z.object({ token: z.string().min(20), password: z.string().min(6).max(72), confirmPassword: z.string().min(6).max(72), captchaToken: z.string().min(1, 'CAPTCHA wajib diisi') }).refine((value) => value.password === value.confirmPassword, { message: 'Konfirmasi password tidak cocok', path: ['confirmPassword'] })
const cartSchema = z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(99) })
const checkoutSchema = z.object({
  shippingName: z.string({ error: 'Nama penerima wajib diisi' }).trim().min(2, 'Nama penerima minimal 2 karakter').max(100, 'Nama penerima terlalu panjang'),
  shippingPhone: z.string({ error: 'Nomor HP wajib diisi' }).trim().min(8, 'Nomor HP minimal 8 karakter').max(20, 'Nomor HP terlalu panjang'),
  shippingAddress: z.string({ error: 'Alamat pengiriman wajib diisi' }).trim().min(10, 'Alamat pengiriman minimal 10 karakter').max(500, 'Alamat pengiriman terlalu panjang'),
})

const publicUser = (user) => ({ id: user.id, username: user.username, email: user.email, phone: user.phone, createdAt: user.created_at })
const publicProduct = (product) => ({ id: product.id, name: product.name, category: product.category, price: product.price, oldPrice: product.old_price, image: product.image, tag: product.tag, description: product.description, stock: product.stock })
const createToken = (user) => jwt.sign({ sub: String(user.id), email: user.email }, jwtSecret, { expiresIn: '7d' })
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex')
const validate = (schema, body) => {
  const result = schema.safeParse(body)
  if (!result.success) {
    const error = new Error(result.error.issues.map((issue) => issue.message).join(', '))
    error.status = 400
    throw error
  }
  return result.data
}

async function verifyCaptcha(token, remoteIp) {
  if (token === 'dev-bypass' && process.env.NODE_ENV !== 'production' && !turnstileSecretKey) return true
  if (!turnstileSecretKey) throw Object.assign(new Error('CAPTCHA belum dikonfigurasi di server'), { status: 503 })
  const body = new URLSearchParams({ secret: turnstileSecretKey, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const result = await response.json()
  if (!result.success) throw Object.assign(new Error('Verifikasi CAPTCHA gagal'), { status: 400 })
  return true
}

function requireAuth(request, response, next) {
  try {
    const header = request.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return response.status(401).json({ message: 'Token autentikasi diperlukan' })
    const payload = jwt.verify(token, jwtSecret)
    const user = db.prepare('SELECT id, username, email, phone, created_at FROM users WHERE id = ?').get(Number(payload.sub))
    if (!user) return response.status(401).json({ message: 'Sesi tidak valid' })
    request.user = user
    next()
  } catch {
    response.status(401).json({ message: 'Token autentikasi tidak valid atau sudah kedaluwarsa' })
  }
}

const getCart = (userId) => {
  const items = db.prepare(`SELECT p.id, p.name, p.category, p.price, p.old_price, p.image, p.tag, p.stock, c.quantity, (p.price * c.quantity) AS subtotal FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ? ORDER BY c.rowid DESC`).all(userId)
  return { items: items.map((item) => ({ ...publicProduct(item), quantity: item.quantity, subtotal: item.subtotal })), total: items.reduce((sum, item) => sum + item.subtotal, 0) }
}

const completeOrder = db.transaction((orderId) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  if (!order) throw Object.assign(new Error('Order tidak ditemukan'), { status: 404 })
  if (order.status === 'paid') return order
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId)
  for (const item of items) {
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id)
    if (!product || product.stock < item.quantity) throw Object.assign(new Error(`Stok ${item.product_name} tidak mencukupi`), { status: 400 })
  }
  const reduceStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
  items.forEach((item) => reduceStock.run(item.quantity, item.product_id))
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(order.user_id)
  db.prepare("UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId)
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
})

const createPendingOrder = (userId, shipping, cart, paymentProvider) => {
  const create = db.transaction(() => {
    for (const item of cart.items) {
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.id)
      if (!product || product.stock < item.quantity) throw Object.assign(new Error(`Stok ${item.name} tidak mencukupi`), { status: 400 })
    }
    const order = db.prepare('INSERT INTO orders (user_id, status, total, shipping_name, shipping_phone, shipping_address, payment_provider) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, 'pending', cart.total, shipping.shippingName, shipping.shippingPhone, shipping.shippingAddress, paymentProvider)
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)')
    cart.items.forEach((item) => insertItem.run(order.lastInsertRowid, item.id, item.name, item.price, item.quantity))
    return order.lastInsertRowid
  })
  return create()
}

app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'nusa-backend' }))

app.post('/api/auth/register', async (request, response, next) => {
  try {
    const data = validate(registerSchema, request.body)
    await verifyCaptcha(data.captchaToken, request.ip)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email)
    if (existing) return response.status(409).json({ message: 'Email sudah terdaftar' })
    const passwordHash = await bcrypt.hash(data.password, 12)
    const result = db.prepare('INSERT INTO users (username, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(data.username, data.email, data.phone, passwordHash)
    const user = db.prepare('SELECT id, username, email, phone, created_at FROM users WHERE id = ?').get(result.lastInsertRowid)
    response.status(201).json({ user: publicUser(user), token: createToken(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const data = validate(loginSchema, request.body)
    await verifyCaptcha(data.captchaToken, request.ip)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email)
    if (!user || !(await bcrypt.compare(data.password, user.password_hash))) return response.status(401).json({ message: 'Email atau password salah' })
    response.json({ user: publicUser(user), token: createToken(user) })
  } catch (error) { next(error) }
})

app.get('/api/auth/me', requireAuth, (request, response) => response.json({ user: publicUser(request.user) }))

app.post('/api/auth/forgot-password', async (request, response, next) => {
  try {
    const { email } = validate(emailSchema, request.body)
    await verifyCaptcha(request.body.captchaToken, request.ip)
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    let developmentToken
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      developmentToken = rawToken
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id)
      db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(user.id, hashToken(rawToken), Date.now() + resetTtl)
      // In production, send this token through an email provider instead of returning it.
    }
    const result = { message: 'Jika email terdaftar, instruksi reset password telah dikirim' }
    if (process.env.NODE_ENV !== 'production' && developmentToken) result.developmentToken = developmentToken
    response.json(result)
  } catch (error) { next(error) }
})

app.post('/api/auth/reset-password', async (request, response, next) => {
  try {
    const data = validate(resetSchema, request.body)
    await verifyCaptcha(data.captchaToken, request.ip)
    const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(hashToken(data.token), Date.now())
    if (!reset) return response.status(400).json({ message: 'Token reset tidak valid atau sudah kedaluwarsa' })
    const passwordHash = await bcrypt.hash(data.password, 12)
    const update = db.transaction(() => { db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id); db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(Date.now(), reset.id) })
    update()
    response.json({ message: 'Password berhasil diubah' })
  } catch (error) { next(error) }
})

app.get('/api/products', (request, response) => {
  const query = String(request.query.search || '').trim()
  const category = String(request.query.category || '').trim()
  const products = db.prepare(`SELECT * FROM products WHERE (? = '' OR name LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%') AND (? = '' OR category = ?) ORDER BY id`).all(query, query, query, category, category)
  response.json({ products: products.map(publicProduct) })
})

app.get('/api/products/:id', (request, response) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(request.params.id))
  if (!product) return response.status(404).json({ message: 'Produk tidak ditemukan' })
  response.json({ product: publicProduct(product) })
})

app.get('/api/cart', requireAuth, (request, response) => response.json(getCart(request.user.id)))

app.post('/api/cart/items', requireAuth, (request, response, next) => {
  try {
    const data = validate(cartSchema, request.body)
    const product = db.prepare('SELECT id, stock FROM products WHERE id = ?').get(data.productId)
    if (!product) return response.status(404).json({ message: 'Produk tidak ditemukan' })
    const current = db.prepare('SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?').get(request.user.id, data.productId)
    if ((current?.quantity || 0) + data.quantity > product.stock) return response.status(400).json({ message: 'Jumlah produk melebihi stok' })
    db.prepare(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity`).run(request.user.id, data.productId, data.quantity)
    response.status(201).json(getCart(request.user.id))
  } catch (error) { next(error) }
})

app.patch('/api/cart/items/:productId', requireAuth, (request, response, next) => {
  try {
    const data = validate(z.object({ quantity: z.coerce.number().int().min(1).max(99) }), request.body)
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(Number(request.params.productId))
    if (!product) return response.status(404).json({ message: 'Produk tidak ditemukan' })
    if (data.quantity > product.stock) return response.status(400).json({ message: 'Jumlah produk melebihi stok' })
    const result = db.prepare('UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?').run(data.quantity, request.user.id, Number(request.params.productId))
    if (!result.changes) return response.status(404).json({ message: 'Item tidak ada di keranjang' })
    response.json(getCart(request.user.id))
  } catch (error) { next(error) }
})

app.delete('/api/cart/items/:productId', requireAuth, (request, response) => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(request.user.id, Number(request.params.productId))
  response.json(getCart(request.user.id))
})

app.post('/api/payments/create', requireAuth, async (request, response, next) => {
  try {
    const shipping = validate(checkoutSchema, request.body)
    const cart = getCart(request.user.id)
    if (!cart.items.length) return response.status(400).json({ message: 'Keranjang masih kosong' })
    const orderId = createPendingOrder(request.user.id, shipping, cart, midtransServerKey ? 'midtrans' : 'mock')
    const paymentOrderId = `nusa-${orderId}-${Date.now()}`
    db.prepare('UPDATE orders SET payment_order_id = ? WHERE id = ?').run(paymentOrderId, orderId)

    if (!midtransServerKey) {
      const order = completeOrder(orderId)
      return response.status(201).json({ mode: 'mock', status: order.status, orderId: order.id, message: 'Pembayaran simulasi berhasil' })
    }

    const midtransResponse = await fetch(midtransApiUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${midtransServerKey}:`).toString('base64')}` },
      body: JSON.stringify({
        transaction_details: { order_id: paymentOrderId, gross_amount: cart.total },
        item_details: cart.items.map((item) => ({ id: String(item.id), price: item.price, quantity: item.quantity, name: item.name })),
        customer_details: { first_name: shipping.shippingName, phone: shipping.shippingPhone },
        callbacks: { finish: `${clientOrigin}/?payment=finish&order_id=${paymentOrderId}` },
      }),
    })
    const payment = await midtransResponse.json()
    if (!midtransResponse.ok || !payment.token) {
      db.prepare('DELETE FROM orders WHERE id = ?').run(orderId)
      return response.status(502).json({ message: payment.error_messages?.join(', ') || 'Midtrans tidak dapat membuat transaksi' })
    }
    db.prepare('UPDATE orders SET payment_token = ?, payment_redirect_url = ? WHERE id = ?').run(payment.token, payment.redirect_url || null, orderId)
    response.status(201).json({ mode: 'midtrans', status: 'pending', orderId, token: payment.token, redirectUrl: payment.redirect_url })
  } catch (error) { next(error) }
})

app.post('/api/payments/midtrans/webhook', async (request, response, next) => {
  try {
    const notification = request.body
    const expectedSignature = crypto.createHash('sha512').update(`${notification.order_id}${notification.status_code}${notification.gross_amount}${midtransServerKey}`).digest('hex')
    if (midtransServerKey && notification.signature_key !== expectedSignature) return response.status(401).json({ message: 'Signature Midtrans tidak valid' })
    const order = db.prepare('SELECT * FROM orders WHERE payment_order_id = ?').get(notification.order_id)
    if (!order) return response.status(404).json({ message: 'Order pembayaran tidak ditemukan' })
    const isPaid = notification.transaction_status === 'settlement' || (notification.transaction_status === 'capture' && notification.fraud_status === 'accept')
    if (isPaid) completeOrder(order.id)
    else if (['deny', 'cancel', 'expire'].includes(notification.transaction_status)) db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(notification.transaction_status, order.id)
    else db.prepare("UPDATE orders SET status = 'pending' WHERE id = ?").run(order.id)
    response.json({ received: true })
  } catch (error) { next(error) }
})

app.post('/api/orders', requireAuth, (request, response, next) => {
  try {
    const shipping = validate(checkoutSchema, request.body)
    const cart = getCart(request.user.id)
    if (!cart.items.length) return response.status(400).json({ message: 'Keranjang masih kosong' })
    const createOrder = db.transaction(() => {
      for (const item of cart.items) {
        const current = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.id)
        if (!current || current.stock < item.quantity) throw Object.assign(new Error(`Stok ${item.name} tidak mencukupi`), { status: 400 })
      }
      const order = db.prepare('INSERT INTO orders (user_id, total, shipping_name, shipping_phone, shipping_address) VALUES (?, ?, ?, ?, ?)').run(request.user.id, cart.total, shipping.shippingName, shipping.shippingPhone, shipping.shippingAddress)
      const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)')
      const reduceStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
      cart.items.forEach((item) => { insertItem.run(order.lastInsertRowid, item.id, item.name, item.price, item.quantity); reduceStock.run(item.quantity, item.id) })
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(request.user.id)
      return order.lastInsertRowid
    })
    const orderId = createOrder()
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
    response.status(201).json({ order: { ...order, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId) } })
  } catch (error) { next(error) }
})

app.get('/api/orders', requireAuth, (request, response) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(request.user.id)
  const items = db.prepare('SELECT oi.*, p.image, p.category FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (SELECT id FROM orders WHERE user_id = ?)').all(request.user.id)
  response.json({ orders: orders.map((order) => ({ ...order, items: items.filter((item) => item.order_id === order.id) })) })
})

app.use((_request, response) => response.status(404).json({ message: 'Endpoint tidak ditemukan' }))
app.use((error, _request, response, _next) => { console.error(error); response.status(error.status || 500).json({ message: error.status ? error.message : 'Terjadi kesalahan pada server' }) })

app.listen(port, () => console.log(`Nusa API running at http://localhost:${port}`))
