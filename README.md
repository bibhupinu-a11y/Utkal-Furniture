# 🛋️ Maison.co — Furniture E-commerce

Full-stack furniture store with Node.js backend and **Razorpay** payment gateway.

---

## Project Structure

```
maison-furniture/
├── server.js          ← Express API + Razorpay integration
├── public/
│   └── index.html     ← Complete frontend (Shop, Seller, Cart, Orders)
├── uploads/           ← Product images (auto-created)
├── data/
│   ├── products.json  ← Product database (auto-created)
│   └── orders.json    ← Orders database (auto-created)
├── .env               ← Your secrets (copy from .env.example)
├── .env.example       ← Template
└── package.json
```

---

## Quick Start

### 1. Install dependencies
```bash
cd maison-furniture
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
```

Edit `.env`:
```
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=XXXXXXXXXXXXXXXXXXXXXXXX
PORT=3000
```

### 3. Get Razorpay API Keys

1. Sign up at [dashboard.razorpay.com](https://dashboard.razorpay.com)
2. Go to **Settings → API Keys**
3. Click **Generate Test Key**
4. Copy **Key ID** and **Key Secret** into your `.env`

> Use `rzp_test_` keys for development and `rzp_live_` for production.

### 4. Run the server
```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

Open: **http://localhost:3000**

---

## API Endpoints

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List all products (optional `?cat=sofa`) |
| GET | `/api/products/:id` | Get single product |
| POST | `/api/products` | Add product (multipart/form-data) |
| PUT | `/api/products/:id` | Update product (multipart/form-data) |
| DELETE | `/api/products/:id` | Delete product |

### Payments (Razorpay)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/payment/create-order` | Create Razorpay order (returns orderId + keyId) |
| POST | `/api/payment/verify` | Verify payment signature (HMAC-SHA256) |
| POST | `/api/payment/failed` | Log failed/dismissed payments |
| GET | `/api/orders` | List all orders |
| POST | `/api/webhook/razorpay` | Razorpay webhook (for server-to-server events) |

---

## Payment Flow

```
Buyer clicks "Pay" 
  → POST /api/payment/create-order  (server creates Razorpay order)
  → Razorpay Checkout opens in browser
  → Buyer pays (card / UPI / net banking / wallets)
  → Razorpay calls handler() with razorpay_signature
  → POST /api/payment/verify  (server verifies HMAC signature)
  → Order marked as PAID, stock decremented
  → Success screen shown to buyer
```

---

## Test Payments

Use these **test credentials** in Razorpay checkout:

| Method | Details |
|--------|---------|
| Card | `4111 1111 1111 1111` / Exp: any future / CVV: any |
| UPI | `success@razorpay` (success) or `failure@razorpay` (failure) |
| Net Banking | Select any bank — auto-approves in test mode |

---

## Razorpay Webhook Setup (Optional but Recommended)

1. Go to **Razorpay Dashboard → Webhooks**
2. Add URL: `https://your-domain.com/api/webhook/razorpay`
3. Select events: `payment.captured`, `payment.failed`
4. Copy the webhook secret into `.env`:
   ```
   RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
   ```

---

## Production Checklist

- [ ] Replace `rzp_test_` keys with `rzp_live_` keys
- [ ] Set `NODE_ENV=production`
- [ ] Switch from JSON file storage to MongoDB or PostgreSQL
- [ ] Enable HTTPS (required for Razorpay live mode)
- [ ] Set `FRONTEND_URL` to your actual domain
- [ ] Configure Razorpay webhook for reliable payment confirmation
- [ ] Add authentication to seller endpoints
- [ ] Add rate limiting (`express-rate-limit`)

---

## Upgrading Storage to MongoDB

Replace the `readDB`/`writeDB` helpers in `server.js` with:

```bash
npm install mongoose
```

```js
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI);

const ProductSchema = new mongoose.Schema({
  name: String, cat: String, price: Number,
  original: Number, desc: String, badge: String,
  stock: Number, img: String,
}, { timestamps: true });

const Product = mongoose.model('Product', ProductSchema);
```

Then replace `readDB(DB_PATH)` with `await Product.find()`, etc.
