import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Turnstile } from '@marsidev/react-turnstile'
import './App.css'

type AuthView = 'login' | 'register' | 'forgot'
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
type Product = { id: number; name: string; category: string; price: number; oldPrice: number | null; image: string; tag: string | null; description: string; stock: number }
type CartItem = Product & { quantity: number; subtotal: number }
type Cart = { items: CartItem[]; total: number }
type ShippingDetails = { shippingName: string; shippingPhone: string; shippingAddress: string }
type User = { id: number; username: string; email: string; phone: string }
type Order = { id: number; status: string; total: number; shipping_name: string; shipping_phone: string; shipping_address: string; payment_provider: string | null; created_at: string; items: { product_name: string; price: number; quantity: number; image: string; category: string }[] }

const emptyCart: Cart = { items: [], total: 0 }
const formatPrice = (price: number) => `Rp ${price.toLocaleString('id-ID')}`
const fallbackProducts: Product[] = [
  { id: 1, name: 'Mug Senja', category: 'Home', price: 129000, oldPrice: null, image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=700&q=85', tag: 'Best seller', description: 'Keramik handmade untuk ritual pagi.', stock: 12 },
  { id: 2, name: 'Lilin Purnama', category: 'Wellness', price: 159000, oldPrice: 189000, image: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=700&q=85', tag: 'Nusa pick', description: 'Aroma lembut untuk ruang yang tenang.', stock: 8 },
  { id: 3, name: 'Tote Rona', category: 'Everyday', price: 189000, oldPrice: null, image: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=700&q=85', tag: 'New', description: 'Tas kanvas ringan untuk keseharian.', stock: 15 },
  { id: 4, name: 'Vas Aruna', category: 'Home', price: 249000, oldPrice: null, image: 'https://images.unsplash.com/photo-1581783898377-1c85bf937427?auto=format&fit=crop&w=700&q=85', tag: 'Limited', description: 'Aksen sederhana dengan karakter kuat.', stock: 6 },
]

function App() {
  const [authView, setAuthView] = useState<AuthView | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')
  const [notice, setNotice] = useState('')
  const [authError, setAuthError] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [cart, setCart] = useState<Cart>(emptyCart)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartError, setCartError] = useState('')
  const [checkoutMessage, setCheckoutMessage] = useState('')
  const [paymentStep, setPaymentStep] = useState(false)
  const [shippingDetails, setShippingDetails] = useState<ShippingDetails | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')

  const loadProducts = async (query = '', category = '') => {
    setProductsLoading(true)
    setProductsError('')
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('search', query.trim())
      if (category) params.set('category', category)
      const response = await fetch(`${apiUrl}/products?${params}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Produk tidak dapat dimuat')
      setProducts(result.products)
    } catch (error) {
      if (!query.trim() && !category) setProducts(fallbackProducts)
      else setProducts([])
      setProductsError('')
    } finally { setProductsLoading(false) }
  }

  const submitSearch = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    fetch(`${apiUrl}/products`)
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Kategori tidak dapat dimuat')))
      .then((result) => setCategories([...new Set((result.products as Product[]).map((product) => product.category))]))
      .catch(() => setCategories([...new Set(fallbackProducts.map((product) => product.category))]))
  }, [])

  useEffect(() => {
    if (!currentUser) return
    const token = localStorage.getItem('nusa_token')
    if (!token) return
    fetch(`${apiUrl}/cart`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Keranjang tidak dapat dimuat')))
      .then((result) => setCart(result))
      .catch(() => setCart(emptyCart))
  }, [currentUser])

  useEffect(() => {
    const timer = window.setTimeout(() => loadProducts(searchQuery, selectedCategory), 180)
    return () => window.clearTimeout(timer)
  }, [searchQuery, selectedCategory])

  useEffect(() => {
    const token = localStorage.getItem('nusa_token')
    if (!token) return
    fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Sesi berakhir')))
      .then((result) => setCurrentUser(result.user))
      .catch(() => { localStorage.removeItem('nusa_token'); setCurrentUser(null) })
  }, [])

  const openAuth = (view: AuthView) => {
    setNotice('')
    setAuthError('')
    setCaptchaToken('')
    setAuthView(view)
    setMenuOpen(false)
  }

  const loadCart = async () => {
    const token = localStorage.getItem('nusa_token')
    if (!token) { openAuth('login'); return false }
    const response = await fetch(`${apiUrl}/cart`, { headers: { Authorization: `Bearer ${token}` } })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Keranjang tidak dapat dimuat')
    setCart(result)
    return true
  }

  const loadOrders = async () => {
    const token = localStorage.getItem('nusa_token')
    if (!token) { openAuth('login'); return }
    setOrdersOpen(true)
    setOrdersLoading(true)
    setOrdersError('')
    try {
      const response = await fetch(`${apiUrl}/orders`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Riwayat pesanan tidak dapat dimuat')
      setOrders(result.orders)
    } catch (error) { setOrdersError(error instanceof Error ? error.message : 'Riwayat pesanan tidak dapat dimuat') } finally { setOrdersLoading(false) }
  }

  const addToCart = async (productId: number) => {
    const token = localStorage.getItem('nusa_token')
    if (!token) { openAuth('login'); return }
    try {
      setCartError('')
      const response = await fetch(`${apiUrl}/cart/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ productId, quantity: 1 }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Produk tidak dapat ditambahkan')
      setCart(result)
      setCartOpen(true)
    } catch (error) { setCartError(error instanceof Error ? error.message : 'Gagal menambahkan produk') }
  }

  const updateCartItem = async (productId: number, quantity: number) => {
    const token = localStorage.getItem('nusa_token')
    if (!token) return
    try {
      const response = await fetch(`${apiUrl}/cart/items/${productId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ quantity }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Jumlah tidak dapat diubah')
      setCart(result)
    } catch (error) { setCartError(error instanceof Error ? error.message : 'Gagal mengubah keranjang') }
  }

  const removeCartItem = async (productId: number) => {
    const token = localStorage.getItem('nusa_token')
    if (!token) return
    const response = await fetch(`${apiUrl}/cart/items/${productId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    if (response.ok) setCart(await response.json())
  }

  const handleCheckout = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const token = localStorage.getItem('nusa_token')
    if (!token) { openAuth('login'); return }
    const form = new FormData(event.currentTarget)
    const shippingName = String(form.get('shippingName') || '').trim()
    const shippingPhone = String(form.get('shippingPhone') || '').trim()
    const shippingAddress = String(form.get('shippingAddress') || '').trim()
    if (shippingName.length < 2) { setCartError('Nama penerima minimal 2 karakter.'); return }
    if (shippingPhone.length < 8) { setCartError('Nomor HP minimal 8 karakter.'); return }
    if (shippingAddress.length < 10) { setCartError('Alamat pengiriman minimal 10 karakter.'); return }
    setCartError('')
    setCheckoutMessage('')
    setShippingDetails({ shippingName, shippingPhone, shippingAddress })
    setPaymentStep(true)
  }

  const handleDanaPayment = async () => {
    const token = localStorage.getItem('nusa_token')
    if (!token || !shippingDetails) return
    try {
      setCartError('')
      const response = await fetch(`${apiUrl}/payments/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(shippingDetails) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Pembayaran gagal')
      if (result.mode === 'midtrans' && result.redirectUrl) {
        window.location.href = result.redirectUrl
        return
      }
      setCart(emptyCart)
      setPaymentStep(false)
      setShippingDetails(null)
      setCheckoutMessage(`${result.message}. Pesanan #${result.orderId} tersimpan di riwayat pesanan.`)
    } catch (error) { setCartError(error instanceof Error ? error.message : 'Pembayaran gagal') }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice('')
    setAuthError('')
    const form = new FormData(event.currentTarget)
    const endpoint = authView === 'login' ? 'login' : authView === 'register' ? 'register' : 'forgot-password'
    const body = authView === 'register'
      ? { username: String(form.get('username')), email: String(form.get('email')), password: String(form.get('password')), confirmPassword: String(form.get('confirmPassword')), phone: String(form.get('phone')), captchaToken: captchaToken || 'dev-bypass' }
      : { email: String(form.get('email')), captchaToken: captchaToken || 'dev-bypass', ...(authView === 'login' ? { password: String(form.get('password')) } : {}) }
    try {
      const response = await fetch(`${apiUrl}/auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Permintaan gagal')
      if (result.token) {
        localStorage.setItem('nusa_token', result.token)
        setCurrentUser(result.user)
      }
      if (authView === 'register') {
        setAuthView(null)
        setNotice('Registrasi berhasil. Selamat datang di nusa!')
        window.setTimeout(() => setNotice(''), 4500)
      } else {
        setNotice(result.developmentToken ? `${result.message}. Token demo: ${result.developmentToken}` : authView === 'login' ? 'Berhasil masuk. Selamat berbelanja!' : result.message)
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Backend tidak dapat dihubungi')
    }
  }

  const logout = () => {
    localStorage.removeItem('nusa_token')
    setCurrentUser(null)
    setProfileOpen(false)
    setCart(emptyCart)
    setNotice('Kamu sudah keluar dari akun.')
    window.setTimeout(() => setNotice(''), 3500)
  }

  return (
    <div className="app-shell">
      <div className="announcement">Gratis ongkir untuk pembelian di atas Rp 500.000 <span>→</span></div>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Nusa home">nusa<span>.</span></a>
        <nav className={menuOpen ? 'main-nav is-open' : 'main-nav'}>
          <a className="active" href="#top" onClick={() => setMenuOpen(false)}>Home</a>
          <a href="#collection" onClick={() => setMenuOpen(false)}>Collection</a>
          <a href="#story" onClick={() => setMenuOpen(false)}>Our story</a>
        </nav>
        <div className="header-actions">
          <form className="search-area" onSubmit={submitSearch}><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setSearchQuery('')} placeholder="Cari produk" aria-label="Cari produk" /><button className="icon-button search-button" type={searchQuery ? 'submit' : 'button'} aria-label={searchQuery ? 'Jalankan pencarian' : 'Cari produk'} onClick={() => !searchQuery && submitSearch()}>⌕</button></form>
          <button className="icon-button bag-button" aria-label="Keranjang belanja" onClick={() => { setCartOpen(true); loadCart().catch((error) => setCartError(error instanceof Error ? error.message : 'Keranjang tidak dapat dimuat')) }}>♧<i>{cart.items.reduce((total, item) => total + item.quantity, 0)}</i></button>
          {currentUser ? <div className="profile-area"><button className="profile-button" onClick={() => setProfileOpen(!profileOpen)}><span>{currentUser.username.slice(0, 1).toUpperCase()}</span>{currentUser.username}</button>{profileOpen && <div className="profile-card"><p className="eyebrow">My profile</p><strong>{currentUser.username}</strong><small>{currentUser.email}</small><small>{currentUser.phone}</small><button className="orders-link" onClick={loadOrders}>Pesanan saya</button><button onClick={logout}>Keluar</button></div>}</div> : <><button className="login-button" onClick={() => openAuth('login')}>Masuk</button><button className="register-button" onClick={() => openAuth('register')}>Daftar</button></>}
          <button className="menu-button" aria-label="Buka menu" onClick={() => setMenuOpen(!menuOpen)}>☰</button>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy"><p className="eyebrow">A little something for you</p><h1>Temukan hal kecil yang membuat <em>hari lebih berarti.</em></h1><p className="hero-text">Kurasi produk indah dan fungsional untuk menemani ritme hidupmu setiap hari.</p><a className="primary-button" href="#collection">Jelajahi koleksi <span>↗</span></a></div>
          <div className="hero-art"><div className="sun"></div><img src="https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=1000&q=85" alt="Koleksi keramik dan dekorasi rumah" /><p className="art-caption">Objects with<br /><strong>quiet character</strong></p></div>
        </section>
        <section className="category-strip" aria-label="Kategori produk"><span>Shop by mood</span><button className={!selectedCategory ? 'category-link active' : 'category-link'} onClick={() => setSelectedCategory('')}>Semua</button>{categories.map((category) => <button className={selectedCategory === category ? 'category-link active' : 'category-link'} key={category} onClick={() => setSelectedCategory(category)}>{category}</button>)}</section>
        <section className="collection-section" id="collection"><div className="section-heading"><div><p className="eyebrow">Curated for you</p><h2>{searchQuery ? `Hasil untuk “${searchQuery}”` : selectedCategory || 'Yang sedang disukai'}</h2></div>{searchQuery || selectedCategory ? <button className="text-link clear-search" onClick={() => { setSearchQuery(''); setSelectedCategory('') }}>Bersihkan <span>×</span></button> : <a href="#collection" className="text-link">Lihat semua <span>↗</span></a>}</div>{productsLoading ? <p className="empty-search">Memuat produk...</p> : productsError ? <div className="error-message">{productsError}<button className="retry-button" onClick={() => loadProducts(searchQuery, selectedCategory)}>Coba lagi</button></div> : products.length ? <div className="product-grid">{products.map((product) => <article className="product-card" key={product.id}><div className="product-image"><img src={product.image} alt={product.name} /><span>{product.tag || 'Nusa pick'}</span><button onClick={() => addToCart(product.id)} aria-label={`Tambah ${product.name} ke keranjang`}>+</button></div><p className="product-category">{product.category}</p><h3>{product.name}</h3><p className="price">{formatPrice(product.price)} {product.oldPrice && <del>{formatPrice(product.oldPrice)}</del>}</p></article>)}</div> : <p className="empty-search">Produk tidak ditemukan. Coba kata kunci lain.</p>}</section>
        <section className="story-section" id="story"><div><p className="eyebrow">The nusa edit</p><h2>Barang baik, cerita yang panjang.</h2></div><p>Kami percaya benda yang menemani keseharian tak perlu ramai. Cukup dibuat dengan niat baik, dipilih dengan hati, dan terasa tepat saat sampai di tanganmu.</p><a className="text-link" href="#story">Kenali nusa <span>↗</span></a></section>
      </main>
      <footer><a className="brand" href="#top">nusa<span>.</span></a><p>Dibuat untuk hari-hari yang berarti.</p><p>© 2025 nusa studio</p></footer>

      {notice && !authView && <div className="site-toast" role="status">{notice}</div>}

      {ordersOpen && <div className="orders-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOrdersOpen(false)}><section className="orders-panel" role="dialog" aria-modal="true" aria-labelledby="orders-title"><div className="cart-heading"><div><p className="eyebrow">Your history</p><h2 id="orders-title">Pesanan saya</h2></div><button className="close-button" aria-label="Tutup riwayat pesanan" onClick={() => setOrdersOpen(false)}>×</button></div>{ordersLoading && <p className="empty-cart">Memuat riwayat pesanan...</p>}{ordersError && <div className="error-message">{ordersError}</div>}{!ordersLoading && !ordersError && !orders.length && <p className="empty-cart">Belum ada pesanan. Pesanan yang berhasil dibuat akan muncul di sini.</p>}{!ordersLoading && orders.map((order) => <article className="order-card" key={order.id}><div className="order-card-heading"><div><strong>Order #{order.id}</strong><small>{new Date(order.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</small></div><span className={`order-status status-${order.status}`}>{order.status}</span></div><div className="order-meta"><span>Metode pembayaran</span><strong>{order.payment_provider === 'midtrans' ? 'DANA via Midtrans' : order.payment_provider === 'mock' ? 'DANA (simulasi)' : order.payment_provider || 'Belum dipilih'}</strong></div><div className="order-items">{order.items.map((item, index) => <div className="order-item-row" key={`${order.id}-${item.product_name}-${index}`}><img src={item.image} alt={item.product_name} /><span><strong>{item.product_name}</strong><small>{item.category} · {formatPrice(item.price)} × {item.quantity}</small></span><strong>{formatPrice(item.price * item.quantity)}</strong></div>)}</div><div className="order-total"><span>Total</span><strong>{formatPrice(order.total)}</strong></div><div className="order-customer"><p><strong>Data pemesan</strong><br />{order.shipping_name}<br />{order.shipping_phone}</p><p><strong>Alamat pengiriman</strong><br />{order.shipping_address}</p></div></article>)}</section></div>}

      {cartOpen && <div className="cart-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}><aside className="cart-drawer" aria-label="Keranjang belanja"><div className="cart-heading"><div><p className="eyebrow">Your selection</p><h2>Keranjang</h2></div><button className="close-button" aria-label="Tutup keranjang" onClick={() => setCartOpen(false)}>×</button></div>{cartError && <div className="error-message">{cartError}</div>}{checkoutMessage && <div className="success-message">{checkoutMessage}</div>}{!cart.items.length && !checkoutMessage ? <p className="empty-cart">Keranjangmu masih kosong. Pilih produk untuk mulai berbelanja.</p> : <>{cart.items.map((item) => <div className="cart-item" key={item.id}><img src={item.image} alt={item.name} /><div><h3>{item.name}</h3><p>{formatPrice(item.price)}</p><div className="quantity-control"><button onClick={() => item.quantity > 1 && updateCartItem(item.id, item.quantity - 1)} aria-label="Kurangi jumlah">−</button><span>{item.quantity}</span><button onClick={() => updateCartItem(item.id, item.quantity + 1)} aria-label="Tambah jumlah">+</button><button className="remove-item" onClick={() => removeCartItem(item.id)}>Hapus</button></div></div></div>)}{cart.items.length > 0 && <><div className="cart-total"><span>Total</span><strong>{formatPrice(cart.total)}</strong></div><form className="checkout-form" onSubmit={handleCheckout}><p className="eyebrow">Shipping details</p><label>Nama penerima<input name="shippingName" required placeholder="Nama lengkap" /></label><label>No. HP<input name="shippingPhone" required type="tel" placeholder="08xxxxxxxxxx" /></label><label>Alamat pengiriman<textarea name="shippingAddress" required minLength={10} placeholder="Alamat lengkap"></textarea></label><button className="submit-button" type="submit">Lanjut ke pembayaran <span>→</span></button></form></>}</>}</aside></div>}

      {paymentStep && shippingDetails && <div className="payment-backdrop"><section className="payment-page" role="dialog" aria-modal="true" aria-labelledby="payment-title"><button className="close-button" aria-label="Kembali ke keranjang" onClick={() => setPaymentStep(false)}>×</button><p className="eyebrow">Secure checkout</p><h2 id="payment-title">Pilih pembayaran</h2><p className="payment-subtitle">Selesaikan pembayaranmu melalui Midtrans Sandbox.</p><div className="payment-summary"><span>Total pembayaran</span><strong>{formatPrice(cart.total)}</strong></div><button className="dana-option" aria-label="Pilih DANA"><span className="dana-mark">DANA</span><span><strong>DANA via Midtrans</strong><small>Metode pembayaran Sandbox</small></span><b>✓</b></button><div className="payment-note">Mode demo aktif jika MIDTRANS_SERVER_KEY belum diisi. Jangan masukkan PIN atau kredensial DANA asli ke website ini.</div>{cartError && <div className="error-message">{cartError}</div>}<button className="submit-button dana-button" onClick={handleDanaPayment}>Lanjut ke pembayaran <span>→</span></button><button className="back-payment" onClick={() => setPaymentStep(false)}>Kembali ke detail pengiriman</button></section></div>}

      {authView && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAuthView(null)}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="close-button" aria-label="Tutup" onClick={() => setAuthView(null)}>×</button><div className="auth-intro"><p className="eyebrow">Selamat datang di nusa</p><h2 id="auth-title">{authView === 'login' ? 'Senang melihatmu lagi.' : authView === 'register' ? 'Mulai perjalananmu.' : 'Atur ulang kata sandi.'}</h2><p>{authView === 'forgot' ? 'Masukkan emailmu dan kami akan mengirimkan tautan untuk mengatur ulang kata sandi.' : 'Masuk untuk menyimpan wishlist dan melihat pesananmu.'}</p></div>{authError && <div className="error-message">{authError}</div>}{notice ? <div className="success-message">{notice}</div> : <form onSubmit={handleSubmit}>
        {authView === 'register' && <label>Username<input name="username" required type="text" placeholder="namamu" /></label>}
        <label>Email<input name="email" required type="email" placeholder="nama@email.com" /></label>
        {authView !== 'forgot' && <label>Kata sandi<input name="password" required minLength={6} type="password" placeholder="••••••••" /></label>}
        {authView === 'register' && <><label>Konfirmasi kata sandi<input name="confirmPassword" required minLength={6} type="password" placeholder="••••••••" /></label><label>No. HP<input name="phone" required type="tel" placeholder="08xxxxxxxxxx" /></label></>}
        {turnstileSiteKey ? <Turnstile siteKey={turnstileSiteKey} onSuccess={setCaptchaToken} onExpire={() => setCaptchaToken('')} options={{ theme: 'light' }} /> : <label className="captcha-demo"><input type="checkbox" checked={captchaToken === 'dev-bypass'} onChange={(event) => setCaptchaToken(event.target.checked ? 'dev-bypass' : '')} /> <span>Saya bukan robot <small>CAPTCHA lokal untuk development</small></span></label>}
        {authView === 'login' && <button type="button" className="forgot-link" onClick={() => openAuth('forgot')}>Lupa kata sandi?</button>}
        <button className="submit-button" type="submit">{authView === 'login' ? 'Masuk ke akun' : authView === 'register' ? 'Buat akun' : 'Kirim tautan reset'} <span>→</span></button>
      </form>}<p className="auth-switch">{authView === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'} <button onClick={() => openAuth(authView === 'login' ? 'register' : 'login')}>{authView === 'login' ? 'Daftar sekarang' : 'Masuk'}</button></p></section></div>}
    </div>
  )
}

export default App
