/**
 * Maison.co — Furniture E-commerce Backend
 * Serves TWO separate sites:
 *   http://localhost:3000  → Buyer Store  (public/buyer/index.html)
 *   http://localhost:3001  → Seller Portal (public/seller/index.html)
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

// ─── Two Express apps ────────────────────────────────────────────────────────
const buyerApp = express();
const sellerApp = express();
const apiApp = express(); // shared API

const BUYER_PORT = process.env.BUYER_PORT || 3000;
const SELLER_PORT = process.env.SELLER_PORT || 3001;
const API_PORT = process.env.API_PORT || 3002;

// ─── Razorpay ────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Shared Middleware ───────────────────────────────────────────────────────
const sharedMiddleware = [
  cors({ origin: "*" }),
  express.json(),
  express.urlencoded({ extended: true }),
];
[buyerApp, sellerApp, apiApp].forEach((app) => {
  app.use(...sharedMiddleware);
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
});

// ─── Ensure directories ──────────────────────────────────────────────────────
["uploads", "data", "public/buyer", "public/seller"].forEach((dir) => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ─── File-based DB ───────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, "data", "products.json");
const ORDERS_PATH = path.join(__dirname, "data", "orders.json");

function readDB(filePath, def = []) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return def; }
}
function writeDB(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Seed products
if (!fs.existsSync(DB_PATH)) {
  writeDB(DB_PATH, [
    { id:"p1", name:"Velvet Cloud Sofa", cat:"sofa", price:45999, original:59999, desc:"3-seater premium velvet sofa with solid oak legs. Cloud-like comfort.", badge:"Bestseller", img:null, stock:10, createdAt:new Date().toISOString() },
    { id:"p2", name:"Nordic Oak Dining Table", cat:"table", price:28500, original:null, desc:"Solid oak dining table seats 6. Clean Scandinavian lines.", badge:"New", img:null, stock:5, createdAt:new Date().toISOString() },
    { id:"p3", name:"Rattan Lounge Chair", cat:"chair", price:12800, original:16000, desc:"Handwoven natural rattan with cushioned seat. Indoor & outdoor use.", badge:"Sale", img:null, stock:12, createdAt:new Date().toISOString() },
    { id:"p4", name:"Walnut Storage Cabinet", cat:"storage", price:34200, original:null, desc:"4-door walnut veneer cabinet with soft-close hinges.", badge:null, img:null, stock:7, createdAt:new Date().toISOString() },
    { id:"p5", name:"Linen Platform Bed", cat:"bed", price:52000, original:68000, desc:"King size platform bed in natural linen. Includes 2 bedside drawers.", badge:"Hot", img:null, stock:4, createdAt:new Date().toISOString() },
    { id:"p6", name:"Marble Top Coffee Table", cat:"table", price:18600, original:null, desc:"White Carrara marble top with brushed brass frame. 100×55cm.", badge:null, img:null, stock:8, createdAt:new Date().toISOString() },
  ]);
}

// ─── Multer ──────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `product-${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Images only"));
  },
});

// ════════════════════════════════════════════════════════════════════════════
// SHARED API ROUTES (mounted on all three apps)
// ════════════════════════════════════════════════════════════════════════════

function mountApiRoutes(app) {

  // Products
  app.get("/api/products", (req, res) => {
    let products = readDB(DB_PATH);
    const { cat } = req.query;
    if (cat && cat !== "all") products = products.filter(p => p.cat === cat);
    res.json({ success: true, products });
  });

  app.get("/api/products/:id", (req, res) => {
    const product = readDB(DB_PATH).find(p => p.id === req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, product });
  });

  app.post("/api/products", upload.single("image"), (req, res) => {
    const { name, cat, price, original, badge, desc, stock } = req.body;
    if (!name || !cat || !price)
      return res.status(400).json({ success: false, message: "name, cat and price required" });
    const products = readDB(DB_PATH);
    const p = {
      id: "p" + uuidv4().replace(/-/g,"").substring(0,8),
      name, cat,
      price: parseFloat(price),
      original: original ? parseFloat(original) : null,
      desc: desc || "",
      badge: badge || null,
      stock: parseInt(stock) || 10,
      img: req.file ? `/uploads/${req.file.filename}` : null,
      createdAt: new Date().toISOString(),
    };
    products.push(p);
    writeDB(DB_PATH, products);
    res.status(201).json({ success: true, product: p });
  });

  app.put("/api/products/:id", upload.single("image"), (req, res) => {
    const products = readDB(DB_PATH);
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: "Not found" });
    const { name, cat, price, original, badge, desc, stock } = req.body;
    products[idx] = {
      ...products[idx],
      ...(name && { name }), ...(cat && { cat }),
      ...(price && { price: parseFloat(price) }),
      ...(original !== undefined && { original: original ? parseFloat(original) : null }),
      ...(badge !== undefined && { badge: badge || null }),
      ...(desc && { desc }),
      ...(stock && { stock: parseInt(stock) }),
      ...(req.file && { img: `/uploads/${req.file.filename}` }),
      updatedAt: new Date().toISOString(),
    };
    writeDB(DB_PATH, products);
    res.json({ success: true, product: products[idx] });
  });

  app.delete("/api/products/:id", (req, res) => {
    let products = readDB(DB_PATH);
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: "Not found" });
    products.splice(idx, 1);
    writeDB(DB_PATH, products);
    res.json({ success: true });
  });

  // Payment
  app.post("/api/payment/create-order", async (req, res) => {
    try {
      const { cartItems, address } = req.body;
      if (!cartItems?.length) return res.status(400).json({ success: false, message: "Cart empty" });
      const products = readDB(DB_PATH);
      let subtotal = 0;
      const orderItems = [];
      for (const item of cartItems) {
        const product = products.find(p => p.id === item.id);
        if (!product) return res.status(400).json({ success: false, message: `Product ${item.id} not found` });
        if (product.stock < item.qty) return res.status(400).json({ success: false, message: `${product.name}: only ${product.stock} in stock` });
        subtotal += product.price * item.qty;
        orderItems.push({ id: product.id, name: product.name, price: product.price, qty: item.qty });
      }
      const delivery = subtotal > 50000 ? 0 : 599;
      const tax = Math.round(subtotal * 0.18);
      const total = subtotal + delivery + tax;
      const receiptId = "rcpt_" + uuidv4().replace(/-/g,"").substring(0,12);
      const rzOrder = await razorpay.orders.create({
        amount: total * 100,
        currency: process.env.CURRENCY || "INR",
        receipt: receiptId,
        notes: { items: orderItems.map(i=>`${i.name}x${i.qty}`).join(",") },
      });
      const orders = readDB(ORDERS_PATH);
      orders.push({ internalId: receiptId, razorpayOrderId: rzOrder.id, items: orderItems, subtotal, delivery, tax, total, address: address||{}, status:"pending", createdAt: new Date().toISOString() });
      writeDB(ORDERS_PATH, orders);
      res.json({ success:true, orderId:rzOrder.id, amount:rzOrder.amount, currency:rzOrder.currency, keyId:process.env.RAZORPAY_KEY_ID, receipt:receiptId, orderDetails:{subtotal,delivery,tax,total,items:orderItems} });
    } catch(err) {
      console.error(err);
      res.status(500).json({ success:false, message:err.message });
    }
  });

  app.post("/api/payment/verify", (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex");
    if (expected !== razorpay_signature)
      return res.status(400).json({ success:false, message:"Verification failed" });
    const orders = readDB(ORDERS_PATH);
    const idx = orders.findIndex(o => o.razorpayOrderId === razorpay_order_id);
    if (idx !== -1) {
      orders[idx].status = "paid";
      orders[idx].paymentId = razorpay_payment_id;
      orders[idx].paidAt = new Date().toISOString();
      const products = readDB(DB_PATH);
      for (const item of orders[idx].items) {
        const pi = products.findIndex(p => p.id === item.id);
        if (pi !== -1) products[pi].stock = Math.max(0, products[pi].stock - item.qty);
      }
      writeDB(DB_PATH, products);
      writeDB(ORDERS_PATH, orders);
    }
    res.json({ success:true, paymentId:razorpay_payment_id, orderId:razorpay_order_id });
  });

  app.post("/api/payment/failed", (req, res) => {
    const { razorpay_order_id } = req.body;
    const orders = readDB(ORDERS_PATH);
    const idx = orders.findIndex(o => o.razorpayOrderId === razorpay_order_id);
    if (idx !== -1) { orders[idx].status = "failed"; orders[idx].failedAt = new Date().toISOString(); writeDB(ORDERS_PATH, orders); }
    res.json({ success:true });
  });

  app.get("/api/orders", (req, res) => {
    res.json({ success:true, orders: readDB(ORDERS_PATH).reverse() });
  });
}

// Mount API on all apps
[buyerApp, sellerApp].forEach(mountApiRoutes);

// ─── Static file serving ─────────────────────────────────────────────────────
buyerApp.use(express.static(path.join(__dirname, "public", "buyer")));
buyerApp.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "buyer", "index.html")));

sellerApp.use(express.static(path.join(__dirname, "public", "seller")));
sellerApp.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "seller", "index.html")));

// ─── Error handlers ──────────────────────────────────────────────────────────
[buyerApp, sellerApp].forEach(app => {
  app.use((err, req, res, next) => {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ success:false, message:"File too large (max 5MB)" });
    res.status(500).json({ success:false, message:err.message });
  });
});

// ─── Start servers ───────────────────────────────────────────────────────────
buyerApp.listen(BUYER_PORT, () => {
  console.log(`\n🛒  Buyer  Store  → http://localhost:${BUYER_PORT}`);
});
sellerApp.listen(SELLER_PORT, () => {
  console.log(`🏪  Seller Portal → http://localhost:${SELLER_PORT}`);
  console.log(`   Razorpay Key : ${process.env.RAZORPAY_KEY_ID || "⚠️  NOT SET"}\n`);
});
