# Nusa Backend

Express API for authentication, products, cart, and orders.

## Run

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The API listens on `http://localhost:4000` by default.

## Main endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/cart` (Bearer token)
- `POST /api/cart/items` (Bearer token)
- `PATCH /api/cart/items/:productId` (Bearer token)
- `DELETE /api/cart/items/:productId` (Bearer token)
- `POST /api/orders` (Bearer token)
- `GET /api/orders` (Bearer token)
- `POST /api/payments/create` (Bearer token)
- `POST /api/payments/midtrans/webhook`

## Midtrans Sandbox

Set `MIDTRANS_SERVER_KEY` in `.env` to activate real Midtrans Sandbox checkout. If it is empty, `/api/payments/create` completes a local mock payment so development can continue without credentials. Configure the Midtrans notification URL to:

```text
https://your-domain.example/api/payments/midtrans/webhook
```

## Cloudflare Turnstile

Set `VITE_TURNSTILE_SITE_KEY` in the frontend environment and `TURNSTILE_SECRET_KEY` in the backend environment. Use Cloudflare test keys during local development. Without keys, local development accepts a development bypass; production requires a valid CAPTCHA token.
