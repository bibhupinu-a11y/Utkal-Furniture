require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const Razorpay = require("razorpay");
const fs = require("fs");

const BUYER_PORT  = process.env.PORT || 3000;
const SELLER_PORT = process.env.PORT || 3000;

// ─── Razorpay ────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Ensure directories ──────────────────────────────────────────────────────
["uploads", "data", "public/buyer", "public/seller"].forEach((dir) => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ─── File DB ─────────────────────────────────────────────────────────────────
const DB_PATH     = path.join(__dirname, "data", "products.json");
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
    { id:"p1", name:"Velvet Cloud Sofa",       cat:"sofa",    price:45999, original:59999, desc:"3-seater premium velvet sofa with solid oak legs.",       badge:"Bestseller", img:null, stock:10, createdAt:new Date().toISOString() },
    { id:"p2", name:"Nordic Oak Dining Table", cat:"table",   price:28500, original:null,  desc:"Solid oak dining table seats 6. Scandinavian lines.",      badge:"New",        img:null, stock:5,  createdAt:new Date().toISOString() },
    { id:"p3", name:"Rattan Lounge Chair",     cat:"chair",   price:12800, original:16000, desc:"Handwoven natural rattan with cushioned seat.",            badge:"Sale",       img:null, stock:12, createdAt:new Date().toISOString() },
    { id:"p4", name:"Walnut Storage Cabinet",  cat:"storage", price:34200, original:null,  desc:"4-door walnut veneer cabinet with soft-close hinges.",     badge:null,         img:null, stock:7,  createdAt:new Date().toISOString() },
    { id:"p5", name:"Linen Platform Bed",      cat:"bed",     price:52000, original:68000, desc:"King size platform bed in natural linen.",                 badge:"Hot",        img:null, stock:4,  createdAt:new Date().toISOString() },
    { id:"p6", name:"Marble Top Coffee Table", cat:"table",   price:18600, original:null,  desc:"White Carrara marble top with brushed brass frame.",       badge:null,         img:null, stock:8,  createdAt:new Date().toISOString() },
  ]);
}

// ─── Multer — MUST be defined before mountApiRoutes ──────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename:    (req, file, cb) => cb(null, `product-${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Images only"));
  },
});

// ─── Shared API ───────────────────────────────────────────────────────────────
function mountApiRoutes(app) {

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
      id:       "p" + uuidv4().replace(/-/g,"").substring(0,8),
      name, cat,
      price:    parseFloat(price),
      original: original ? parseFloat(original) : null,
      desc:     desc || "",
      badge:    badge || null,
      stock:    parseInt(stock) || 10,
      img:      req.file ? `/uploads/${req.file.filename}` : null,
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
      ...(name  && { name }),
      ...(cat   && { cat }),
      ...(price && { price: parseFloat(price) }),
      ...(original  !== undefined && { original: original ? parseFloat(original) : null }),
      ...(badge     !== undefined && { badge: badge || null }),
      ...(desc  && { desc }),
      ...(stock && { stock: parseInt(stock) }),
      ...(req.file  && { img: `/uploads/${req.file.filename}` }),
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
        subtotal += product.price * item.qty;
        orderItems.push({ id: product.id, name: product.name, price: product.price, qty: item.qty });
      }
      const delivery = subtotal > 50000 ? 0 : 599;
      const tax      = Math.round(subtotal * 0.18);
      const total    = subtotal + delivery + tax;
      const receiptId = "rcpt_" + uuidv4().replace(/-/g,"").substring(0,12);
      const rzOrder = await razorpay.orders.create({
        amount: total * 100,
        currency: process.env.CURRENCY || "INR",
        receipt: receiptId,
      });
      const orders = readDB(ORDERS_PATH);
      orders.push({ internalId: receiptId, razorpayOrderId: rzOrder.id, items: orderItems, subtotal, delivery, tax, total, address: address||{}, status:"pending", createdAt: new Date().toISOString() });
      writeDB(ORDERS_PATH, orders);
      res.json({ success:true, orderId:rzOrder.id, amount:rzOrder.amount, currency:rzOrder.currency, keyId:process.env.RAZORPAY_KEY_ID });
    } catch(err) {
      console.error(err);
      res.status(500).json({ success:false, message:err.message });
    }
  });

  app.post("/api/payment/verify", (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");
    if (expected !== razorpay_signature)
      return res.status(400).json({ success:false, message:"Verification failed" });
    const orders = readDB(ORDERS_PATH);
    const idx = orders.findIndex(o => o.razorpayOrderId === razorpay_order_id);
    if (idx !== -1) {
      orders[idx].status    = "paid";
      orders[idx].paymentId = razorpay_payment_id;
      orders[idx].paidAt    = new Date().toISOString();
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
    if (idx !== -1) { orders[idx].status = "failed"; writeDB(ORDERS_PATH, orders); }
    res.json({ success:true });
  });

  app.get("/api/orders", (req, res) => {
    res.json({ success:true, orders: readDB(ORDERS_PATH).reverse() });
  });
}

// ─── Create app, mount routes, serve static, start ───────────────────────────
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

mountApiRoutes(app);

const BUYER_ONLY  = process.env.BUYER_ONLY  === "true";
const SELLER_ONLY = process.env.SELLER_ONLY === "true";

if (SELLER_ONLY) {
  app.use(express.static(path.join(__dirname, "public", "seller")));
  app.get("*", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "seller", "index.html"))
  );
} else {
  // Default = buyer
  app.use(express.static(path.join(__dirname, "public", "buyer")));
  app.get("*", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "buyer", "index.html"))
  );
}

app.use((err, req, res, next) => {
  res.status(500).json({ success:false, message: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = SELLER_ONLY ? "Seller Portal" : "Buyer Store";
  console.log(`${mode} running → http://localhost:${PORT}`);
});
