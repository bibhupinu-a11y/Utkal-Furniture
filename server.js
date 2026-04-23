/**
 * Utkal Furniture Backend
 * Node.js + Express + Razorpay Payment Gateway
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const Razorpay = require("razorpay");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Razorpay Instance ───────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ─── Ensure directories exist ────────────────────────────────────────────────
["uploads", "data"].forEach((dir) => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// ─── Simple JSON file-based "DB" (swap with MongoDB/PostgreSQL in production) ─
const DB_PATH = path.join(__dirname, "data", "products.json");
const ORDERS_PATH = path.join(__dirname, "data", "orders.json");

function readDB(filePath, defaultVal = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return defaultVal;
  }
}

function writeDB(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Seed default products if none exist
if (!fs.existsSync(DB_PATH)) {
  writeDB(DB_PATH, [
    {
      id: "p1",
      name: "Velvet Cloud Sofa",
      cat: "sofa",
      price: 45999,
      original: 59999,
      desc: "3-seater premium velvet sofa with solid oak legs. Cloud-like comfort.",
      badge: "Bestseller",
      img: null,
      stock: 10,
      createdAt: new Date().toISOString(),
    },
    {
      id: "p2",
      name: "Nordic Oak Dining Table",
      cat: "table",
      price: 28500,
      original: null,
      desc: "Solid oak dining table seats 6. Clean Scandinavian lines.",
      badge: "New",
      img: null,
      stock: 5,
      createdAt: new Date().toISOString(),
    },
    {
      id: "p3",
      name: "Rattan Lounge Chair",
      cat: "chair",
      price: 12800,
      original: 16000,
      desc: "Handwoven natural rattan with cushioned seat. Indoor & outdoor.",
      badge: "Sale",
      img: null,
      stock: 12,
      createdAt: new Date().toISOString(),
    },
    {
      id: "p4",
      name: "Walnut Storage Cabinet",
      cat: "storage",
      price: 34200,
      original: null,
      desc: "4-door walnut veneer cabinet. Ample storage with soft-close hinges.",
      badge: null,
      img: null,
      stock: 7,
      createdAt: new Date().toISOString(),
    },
    {
      id: "p5",
      name: "Linen Platform Bed",
      cat: "bed",
      price: 52000,
      original: 68000,
      desc: "King size platform bed in natural linen. Includes 2 bedside drawers.",
      badge: "Hot",
      img: null,
      stock: 4,
      createdAt: new Date().toISOString(),
    },
    {
      id: "p6",
      name: "Marble Top Coffee Table",
      cat: "table",
      price: 18600,
      original: null,
      desc: "White Carrara marble top with brushed brass frame. 100×55cm.",
      badge: null,
      img: null,
      stock: 8,
      createdAt: new Date().toISOString(),
    },
  ]);
}

// ─── Multer (Image Uploads) ──────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `product-${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"), false);
  },
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCT ROUTES
// ════════════════════════════════════════════════════════════════════════════

// GET /api/products — list all (or filter by ?cat=sofa)
app.get("/api/products", (req, res) => {
  let products = readDB(DB_PATH);
  const { cat, search } = req.query;
  if (cat && cat !== "all") products = products.filter((p) => p.cat === cat);
  if (search)
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.desc.toLowerCase().includes(search.toLowerCase())
    );
  res.json({ success: true, products });
});

// GET /api/products/:id
app.get("/api/products/:id", (req, res) => {
  const products = readDB(DB_PATH);
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, product });
});

// POST /api/products — create product (seller)
app.post("/api/products", upload.single("image"), (req, res) => {
  const { name, cat, price, original, badge, desc, stock } = req.body;
  if (!name || !cat || !price)
    return res.status(400).json({ success: false, message: "name, cat and price are required" });

  const products = readDB(DB_PATH);
  const newProduct = {
    id: "p" + uuidv4().replace(/-/g, "").substring(0, 8),
    name,
    cat,
    price: parseFloat(price),
    original: original ? parseFloat(original) : null,
    desc: desc || "",
    badge: badge || null,
    stock: parseInt(stock) || 10,
    img: req.file ? `/uploads/${req.file.filename}` : null,
    createdAt: new Date().toISOString(),
  };
  products.push(newProduct);
  writeDB(DB_PATH, products);
  res.status(201).json({ success: true, product: newProduct });
});

// PUT /api/products/:id — update product (seller)
app.put("/api/products/:id", upload.single("image"), (req, res) => {
  const products = readDB(DB_PATH);
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Not found" });

  const { name, cat, price, original, badge, desc, stock } = req.body;
  const updated = {
    ...products[idx],
    ...(name && { name }),
    ...(cat && { cat }),
    ...(price && { price: parseFloat(price) }),
    ...(original !== undefined && { original: original ? parseFloat(original) : null }),
    ...(badge !== undefined && { badge: badge || null }),
    ...(desc && { desc }),
    ...(stock && { stock: parseInt(stock) }),
    ...(req.file && { img: `/uploads/${req.file.filename}` }),
    updatedAt: new Date().toISOString(),
  };
  products[idx] = updated;
  writeDB(DB_PATH, products);
  res.json({ success: true, product: updated });
});

// DELETE /api/products/:id
app.delete("/api/products/:id", (req, res) => {
  let products = readDB(DB_PATH);
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Not found" });
  products.splice(idx, 1);
  writeDB(DB_PATH, products);
  res.json({ success: true, message: "Product deleted" });
});

// ════════════════════════════════════════════════════════════════════════════
// PAYMENT ROUTES (Razorpay)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/payment/create-order
 * Creates a Razorpay order. Called when buyer clicks "Pay Now".
 * Body: { cartItems: [{id, qty}], address: {...} }
 */
app.post("/api/payment/create-order", async (req, res) => {
  try {
    const { cartItems, address } = req.body;
    if (!cartItems || !cartItems.length)
      return res.status(400).json({ success: false, message: "Cart is empty" });

    const products = readDB(DB_PATH);

    // Validate items & compute total server-side (never trust client prices)
    let subtotal = 0;
    const orderItems = [];
    for (const item of cartItems) {
      const product = products.find((p) => p.id === item.id);
      if (!product) return res.status(400).json({ success: false, message: `Product ${item.id} not found` });
      if (product.stock < item.qty)
        return res.status(400).json({ success: false, message: `${product.name} has only ${product.stock} in stock` });
      subtotal += product.price * item.qty;
      orderItems.push({ id: product.id, name: product.name, price: product.price, qty: item.qty });
    }

    const delivery = subtotal > 50000 ? 0 : 599;
    const tax = Math.round(subtotal * 0.18);
    const total = subtotal + delivery + tax;

    // Amount in paise (Razorpay uses smallest currency unit)
    const amountInPaise = total * 100;

    const receiptId = "rcpt_" + uuidv4().replace(/-/g, "").substring(0, 12);

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: process.env.CURRENCY || "INR",
      receipt: receiptId,
      notes: {
        items: JSON.stringify(orderItems.map((i) => `${i.name} x${i.qty}`)),
        customer_address: address ? JSON.stringify(address) : "",
      },
    });

    // Persist a pending order locally
    const orders = readDB(ORDERS_PATH);
    orders.push({
      internalId: receiptId,
      razorpayOrderId: razorpayOrder.id,
      items: orderItems,
      subtotal,
      delivery,
      tax,
      total,
      address: address || {},
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    writeDB(ORDERS_PATH, orders);

    res.json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      receipt: receiptId,
      orderDetails: { subtotal, delivery, tax, total, items: orderItems },
    });
  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment/verify
 * Verifies Razorpay signature after successful payment on frontend.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
app.post("/api/payment/verify", (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // HMAC-SHA256 verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    // Update order status & reduce stock
    const orders = readDB(ORDERS_PATH);
    const orderIdx = orders.findIndex((o) => o.razorpayOrderId === razorpay_order_id);
    if (orderIdx !== -1) {
      orders[orderIdx].status = "paid";
      orders[orderIdx].paymentId = razorpay_payment_id;
      orders[orderIdx].paidAt = new Date().toISOString();

      // Reduce stock
      const products = readDB(DB_PATH);
      for (const item of orders[orderIdx].items) {
        const pIdx = products.findIndex((p) => p.id === item.id);
        if (pIdx !== -1) products[pIdx].stock = Math.max(0, products[pIdx].stock - item.qty);
      }
      writeDB(DB_PATH, products);
      writeDB(ORDERS_PATH, orders);
    }

    res.json({
      success: true,
      message: "Payment verified",
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
    });
  } catch (err) {
    console.error("verify error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/payment/failed
 * Called when Razorpay payment fails/is dismissed.
 */
app.post("/api/payment/failed", (req, res) => {
  const { razorpay_order_id, error } = req.body;
  const orders = readDB(ORDERS_PATH);
  const idx = orders.findIndex((o) => o.razorpayOrderId === razorpay_order_id);
  if (idx !== -1) {
    orders[idx].status = "failed";
    orders[idx].failedAt = new Date().toISOString();
    orders[idx].error = error || {};
    writeDB(ORDERS_PATH, orders);
  }
  res.json({ success: true });
});

// GET /api/orders — list all orders (seller dashboard)
app.get("/api/orders", (req, res) => {
  const orders = readDB(ORDERS_PATH);
  res.json({ success: true, orders: orders.reverse() });
});

// ─── Razorpay Webhook (optional but recommended for production) ──────────────
app.post("/api/webhook/razorpay", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret) {
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.body)
      .digest("hex");
    if (signature !== expectedSignature) {
      return res.status(400).json({ error: "Invalid signature" });
    }
  }

  const event = JSON.parse(req.body);
  console.log("Webhook event:", event.event);

  if (event.event === "payment.captured") {
    // Additional server-side logic on capture (email notifications, etc.)
    console.log("Payment captured:", event.payload.payment.entity.id);
  }

  res.json({ status: "ok" });
});

// ─── Serve frontend for all non-API routes ───────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  console.error(err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛋️  Maison.co server running → http://localhost:${PORT}`);
  console.log(`   Razorpay Key: ${process.env.RAZORPAY_KEY_ID || "⚠️  NOT SET — check .env"}`);
  console.log(`   Mode: ${process.env.NODE_ENV || "development"}\n`);
});
