require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const path      = require("path");
const crypto    = require("crypto");
const multer    = require("multer");
const { v4: uuidv4 } = require("uuid");
const Razorpay  = require("razorpay");
const fs        = require("fs");
const mongoose  = require("mongoose");

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const productSchema = new mongoose.Schema({
  _id:      { type: String, default: () => "p" + uuidv4().replace(/-/g,"").substring(0,8) },
  name:     { type: String, required: true },
  cat:      { type: String, required: true },
  price:    { type: Number, required: true },
  original: { type: Number, default: null },
  desc:     { type: String, default: "" },
  badge:    { type: String, default: null },
  stock:    { type: Number, default: 10 },
  img:      { type: String, default: null },
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  internalId:      String,
  razorpayOrderId: String,
  items:           Array,
  subtotal:        Number,
  delivery:        Number,
  tax:             Number,
  total:           Number,
  address:         Object,
  status:          { type: String, default: "pending" },
  paymentId:       String,
  paidAt:          Date,
  failedAt:        Date,
}, { timestamps: true });

const Product = mongoose.model("Product", productSchema);
const Order   = mongoose.model("Order",   orderSchema);

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename:    (req, file, cb) => cb(null, `product-${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Images only")),
});

async function seedProducts() {
  const count = await Product.countDocuments();
  if (count > 0) return;
  await Product.insertMany([
    { _id:"p1", name:"Velvet Cloud Sofa",       cat:"sofa",    price:45999, original:59999, desc:"3-seater premium velvet sofa with solid oak legs.",    badge:"Bestseller", stock:10 },
    { _id:"p2", name:"Nordic Oak Dining Table", cat:"table",   price:28500, original:null,  desc:"Solid oak dining table seats 6. Scandinavian lines.", badge:"New",        stock:5  },
    { _id:"p3", name:"Rattan Lounge Chair",     cat:"chair",   price:12800, original:16000, desc:"Handwoven natural rattan with cushioned seat.",       badge:"Sale",       stock:12 },
    { _id:"p4", name:"Walnut Storage Cabinet",  cat:"storage", price:34200, original:null,  desc:"4-door walnut veneer cabinet with soft-close hinges.",badge:null,         stock:7  },
    { _id:"p5", name:"Linen Platform Bed",      cat:"bed",     price:52000, original:68000, desc:"King size platform bed in natural linen.",            badge:"Hot",        stock:4  },
    { _id:"p6", name:"Marble Top Coffee Table", cat:"table",   price:18600, original:null,  desc:"White Carrara marble top with brushed brass frame.",  badge:null,         stock:8  },
  ]);
  console.log("Seeded default products");
}

function mountApiRoutes(app) {
  app.get("/api/products", async (req, res) => {
    try {
      const filter = {};
      if (req.query.cat && req.query.cat !== "all") filter.cat = req.query.cat;
      const products = await Product.find(filter).sort({ createdAt: -1 });
      res.json({ success: true, products });
    } catch(e) { res.status(500).json({ success:false, message:e.message }); }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ success:false, message:"Not found" });
      res.json({ success:true, product });
    } catch(e) { res.status(500).json({ success:false, message:e.message }); }
  });

  app.post("/api/products", upload.single("image"), async (req, res) => {
    try {
      const { name, cat, price, original, badge, desc, stock } = req.body;
      if (!name || !cat || !price)
        return res.status(400).json({ success:false, message:"name, cat and price required" });
      const product = await Product.create({
        name, cat,
        price:    parseFloat(price),
        original: original ? parseFloat(original) : null,
        desc:     desc || "",
        badge:    badge || null,
        stock:    parseInt(stock) || 10,
        img:      req.file ? `/uploads/${req.file.filename}` : null,
      });
      res.status(201).json({ success:true, product });
    } catch(e) { res.status(500).json({ success:false, message:e.message }); }
  });

  app.put("/api/products/:id", upload.single("image"), async (req, res) => {
    try {
      const { name, cat, price, original, badge, desc, stock } = req.body;
      const update = {
        ...(name  && { name }),
        ...(cat   && { cat }),
        ...(price && { price: parseFloat(price) }),
        ...(original !== undefined && { original: original ? parseFloat(original) : null }),
        ...(badge    !== undefined && { badge: badge || null }),
        ...(desc  && { desc }),
        ...(stock && { stock: parseInt(stock) }),
        ...(req.file && { img: `/uploads/${req.file.filename}` }),
      };
      const product = await Product.findByIdAndUpdate(req.params.id, update, { new:true });
      if (!product) return res.status(404).json({ success:false, message:"Not found" });
      res.json({ success:true, product });
    } catch(e) { res.status(500).json({ success:false, message:e.message }); }
  });

  app.delete("/api/products/:id", async (req, res) => {
    try {
      const product = await Product.findByIdAndDelete(req.params.id);
      if (!product) return res.status(404).json({ success:false, message:"Not found" });
      res.json({ success:true });
    } catch(e) { res.status(500).json({ success:false, message:e.message }); }
  });

  app.post("/api/payment/create-order", async (req, res) => {
    try {
      const { cartItems, address } = req.body;
      if (!cartItems?.length) return res.status(400).json({ success:false, message:"Cart empty" });
      let subtotal = 0;
      const orderItems = [];
      for (const item of cartItems) {
        const product = await Product.findById(item.id);
        if (!product) return res.status(400).json({ success:false, message:`Product ${item.id} not found` });
        subtotal += product.price * item.qty;
        orderItems.push({ id:product._id, name:product.name, price:product.price, qty:item.qty });
      }
      const delivery  = subtotal > 50000 ? 0 : 599;
      const tax       = Math.round(subtotal * 0.18);
      const total     = subtotal + delivery + tax;
      const receiptId = "rcpt_" + uuidv4().replace(/-/g,"").substring(0,12);
      const rzOrder   = await razorpay.orders.create({ amount: total * 100, currency: process.env.CURRENCY || "INR", receipt: receiptId });
      await Order.create({ internalId: receiptId, razorpayOrderId: rzOrder.id, items: orderItems, subtotal, delivery, tax, total, address: address || {}, status: "pending" });
      res.json({ success:true, orderId:rzOrder.id, amount:rzOrder.amount, currency:rzOrder.currency, keyId:process.env.RAZORPAY_KEY_ID });
    } catch(e) { console.error(e); res.status(500).json({ success:false, message:e.message }); }
  });

  app.post("/api/payment/verify", async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ success:false, message:"Verification failed" });
      const order = await Order.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        { status:"paid", paymentId:razorpay_payment_id, paidAt:new Date() },
        { new:true }
      );
      if (order) {
        for (const item of order.items)
          await Product.findByIdAndUpdate(item.id, { $inc: { stock: -item.qty } });
      }
      res.json({ success:true, paymentId:razorpay_payment_id, orderId:razorpay_order_id });
    } catch(e) { res.status(500).json({ success:false, message:e.message }); }
  });

  app.post("/api/payment/failed", async (req, res) => {
    try {
      await Order.findOneAndUpdate({ razorpayOrderId: req.body.razorpay_order_id }, { status:"failed", failedAt:new Date() });
      res.json({ success:true });
    } catch(e) { res.json({ success:true }); }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const orders = await Order.find().sort({ createdAt:-1 });
      res.json({ success:true, orders });
    } catch(e) { res.status(500).json({ success:false, message:e.message }); }
  });
}

async function start() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");
  await seedProducts();

  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  mountApiRoutes(app);

  const SELLER_ONLY = process.env.SELLER_ONLY === "true";
  if (SELLER_ONLY) {
    app.use(express.static(path.join(__dirname, "public", "seller")));
    app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "seller", "index.html")));
  } else {
    app.use(express.static(path.join(__dirname, "public", "buyer")));
    app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "buyer", "index.html")));
  }

  app.use((err, req, res, next) => { res.status(500).json({ success:false, message:err.message }); });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`${process.env.SELLER_ONLY === "true" ? "Seller Portal" : "Buyer Store"} running on port ${PORT}`);
  });
}

start().catch(err => { console.error("Startup error:", err); process.exit(1); });
