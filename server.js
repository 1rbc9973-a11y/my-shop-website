const fs=require("fs");
const multer =require("multer");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
require("dotenv").config();

const app = express();
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp"
    }[file.mimetype];

    cb(null, `${Date.now()}-${require("crypto").randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use("/uploads", express.static(uploadDir));
const db = new Database("shop.db");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000
  }
}));

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id TEXT UNIQUE NOT NULL,
    shop_name TEXT NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mrp REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0
  );
`);
const productColumns = db.prepare(
  "PRAGMA table_info(products)"
).all();

if (!productColumns.some(column => column.name === "image_path")) {
  db.exec("ALTER TABLE products ADD COLUMN image_path TEXT");
}
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_shop
  ON orders(shop_id, id DESC);
`);

function requireLogin(req, res, next) {
  if (!req.session.shopId) {
    return res.status(401).json({ error: "Please log in first." });
  }
  next();
}

// Create a shopkeeper account
app.post("/api/register", async (req, res) => {
  try {
    const { shopId, shopName, password } = req.body;

    if (
      typeof shopId !== "string" ||
      !/^[a-zA-Z0-9_-]{3,30}$/.test(shopId) ||
      typeof shopName !== "string" ||
      !shopName.trim() ||
      shopName.length > 100 ||
      typeof password !== "string" ||
      password.length < 10 ||
      password.length > 72
    ) {
      return res.status(400).json({
        error: "Enter a valid shop ID, shop name, and password (10–72 characters)."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    db.prepare(`
      INSERT INTO shops (shop_id, shop_name, password)
      VALUES (?, ?, ?)
    `).run(shopId, shopName.trim(), hash);

    res.status(201).json({ message: "Shop created. You can now log in." });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "That shop ID is already taken." });
    }
    console.error(err);
    res.status(500).json({ error: "Could not create shop." });
  }
});

// Shopkeeper login
app.post("/api/login", async (req, res) => {
  const { shopId, password } = req.body;

  if (typeof shopId !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter your ID and password." });
  }

  const shop = db.prepare(
    "SELECT * FROM shops WHERE shop_id = ?"
  ).get(shopId);

  if (!shop || !(await bcrypt.compare(password, shop.password))) {
    return res.status(401).json({ error: "Invalid shop ID or password." });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Login failed." });

    req.session.shopId = shop.shop_id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: "Login failed." });

      res.json({
        message: "Login successful.",
        shopId: shop.shop_id,
        shopName: shop.shop_name
      });
    });
  });
});

// Check current login
app.get("/api/me", requireLogin, (req, res) => {
  const shop = db.prepare(
    "SELECT shop_id, shop_name FROM shops WHERE shop_id = ?"
  ).get(req.session.shopId);

  if (!shop) return res.status(401).json({ error: "Shop not found." });
  res.json(shop);
});

// Add a product
app.post(
  "/api/products",
  requireLogin,
  (req, res, next) => {
    upload.single("image")(req, res, err => {
      if (err) {
        return res.status(400).json({
          error: err.code === "LIMIT_FILE_SIZE"
            ? "Image must be 5 MB or smaller."
            : "Upload a JPEG, PNG, or WebP image."
        });
      }
      next();
    });
  },
  (req, res) => {
    const { name } = req.body;
    const mrp = Number(req.body.mrp);
    const discount = Number(req.body.discount);
    const stock = Number(req.body.stock);

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 120 ||
      !Number.isFinite(mrp) || mrp <= 0 ||
      !Number.isFinite(discount) || discount < 0 || discount > 100 ||
      !Number.isSafeInteger(stock) || stock < 0
    ) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: "Check the product details."
      });
    }

    const imagePath = req.file
      ? `/uploads/${req.file.filename}`
      : null;

    try {
      const result = db.prepare(`
        INSERT INTO products
          (shop_id, name, mrp, discount, stock, image_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        req.session.shopId,
        name.trim(),
        mrp,
        discount,
        stock,
        imagePath
      );

      res.status(201).json({
        id: result.lastInsertRowid,
        name: name.trim(),
        mrp,
        discount,
        stock,
        image_path: imagePath,
        sellingPrice: Math.round(mrp * (1 - discount / 100) * 100) / 100
      });
    } catch (error) {
      if (req.file) fs.unlinkSync(req.file.path);
      console.error(error);
      res.status(500).json({ error: "Could not save product." });
    }
  }
);

// List only this shopkeeper's products
app.get("/api/products", requireLogin, (req, res) => {
  const products = db.prepare(`
    SELECT id, name, mrp, discount, stock ,image_path
    FROM products
    WHERE shop_id = ?
    ORDER BY id DESC
  `).all(req.session.shopId);

  res.json(products.map(p => ({
    ...p,
    sellingPrice: Math.round(p.mrp * (1 - p.discount / 100) * 100) / 100
  })));
});

// Delete only products belonging to this shop
app.delete("/api/products/:id", requireLogin, (req, res) => {
  const result = db.prepare(`
    DELETE FROM products WHERE id = ? AND shop_id = ?
  `).run(req.params.id, req.session.shopId);

  if (!result.changes) {
    return res.status(404).json({ error: "Product not found." });
  }
  res.json({ message: "Product deleted." });
});
const ORDER_STATUSES = [
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready for Pickup",
  "Out for Delivery",
  "Delivered",
  "Cancelled"
];

// Customer places an order.
// Request body: shopId, customerName, phone, address,
// items: [{ productId, quantity }]
app.post("/api/orders", (req, res) => {
  const { shopId, customerName, phone, address, items } = req.body;

  if (
    typeof shopId !== "string" ||
    typeof customerName !== "string" ||
    !customerName.trim() ||
    customerName.trim().length > 100 ||
    typeof phone !== "string" ||
    !/^[0-9+()\-\s]{7,20}$/.test(phone) ||
    typeof address !== "string" ||
    !address.trim() ||
    address.trim().length > 500 ||
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 50
  ) {
    return res.status(400).json({
      error: "Please enter valid customer and order details."
    });
  }

  const shop = db.prepare(
    "SELECT shop_id FROM shops WHERE shop_id = ?"
  ).get(shopId);

  if (!shop) {
    return res.status(404).json({ error: "Shop not found." });
  }

  // Reject duplicate product IDs and invalid quantities.
  const seen = new Set();
  for (const item of items) {
    if (
      !item ||
      !Number.isSafeInteger(item.productId) ||
      item.productId < 1 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10000 ||
      seen.has(item.productId)
    ) {
      return res.status(400).json({
        error: "Invalid or duplicate product in order."
      });
    }
    seen.add(item.productId);
  }

  try {
    const placeOrder = db.transaction(() => {
      const orderItems = [];
      let total = 0;

      for (const item of items) {
        const product = db.prepare(`
          SELECT id, name, mrp, discount, stock
          FROM products
          WHERE id = ? AND shop_id = ?
        `).get(item.productId, shopId);

        if (!product) {
          throw new Error("A product was not found in this shop.");
        }

        if (product.stock < item.quantity) {
          throw new Error(
            `Insufficient stock for ${product.name}.`
          );
        }

        const price = Math.round(
          product.mrp * (1 - product.discount / 100) * 100
        ) / 100;

        orderItems.push({
          productId: product.id,
          name: product.name,
          quantity: item.quantity,
          unitPrice: price,
          subtotal: Math.round(
            price * item.quantity * 100
          ) / 100
        });

        total += price * item.quantity;

        const updated = db.prepare(`
          UPDATE products
          SET stock = stock - ?
          WHERE id = ? AND shop_id = ? AND stock >= ?
        `).run(
          item.quantity,
          product.id,
          shopId,
          item.quantity
        );

        if (updated.changes !== 1) {
          throw new Error(
            `Stock changed for ${product.name}. Please retry.`
          );
        }
      }

      total = Math.round(total * 100) / 100;

      const result = db.prepare(`
        INSERT INTO orders (
          shop_id, customer_name, phone, address,
          items_json, total_amount, status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'Pending')
      `).run(
        shopId,
        customerName.trim(),
        phone.trim(),
        address.trim(),
        JSON.stringify(orderItems),
        total
      );

      return {
        orderId: result.lastInsertRowid,
        totalAmount: total,
        status: "Pending"
      };
    });

    const order = placeOrder();
    res.status(201).json({
      message: "Order placed successfully.",
      ...order
    });
  } catch (error) {
    if (
      error.message.startsWith("Insufficient stock") ||
      error.message.startsWith("A product") ||
      error.message.startsWith("Stock changed")
    ) {
      return res.status(409).json({ error: error.message });
    }

    console.error(error);
    res.status(500).json({ error: "Could not place order." });
  }
});

// List orders belonging to the logged-in shopkeeper.
app.get("/api/orders", requireLogin, (req, res) => {
  const orders = db.prepare(`
    SELECT id, customer_name, phone, address,
           items_json, total_amount, status, created_at
    FROM orders
    WHERE shop_id = ?
    ORDER BY id DESC
  `).all(req.session.shopId);

  res.json(orders.map(order => ({
    id: order.id,
    customerName: order.customer_name,
    phone: order.phone,
    address: order.address,
    items: JSON.parse(order.items_json),
    totalAmount: order.total_amount,
    status: order.status,
    createdAt: order.created_at
  })));
});

// Update an order's status for this shop only.
app.patch("/api/orders/:id/status", requireLogin, (req, res) => {
  const { status } = req.body;
  const orderId = Number(req.params.id);

  if (
    !Number.isSafeInteger(orderId) ||
    orderId < 1 ||
    !ORDER_STATUSES.includes(status)
  ) {
    return res.status(400).json({
      error: "Invalid order ID or status."
    });
  }

  try {
    const updateStatus = db.transaction(() => {
      const order = db.prepare(`
        SELECT id, items_json, status
        FROM orders
        WHERE id = ? AND shop_id = ?
      `).get(orderId, req.session.shopId);

      if (!order) {
        return { error: "Order not found.", code: 404 };
      }

      if (order.status === "Cancelled") {
        return {
          error: "Cancelled orders cannot be reopened.",
          code: 409
        };
      }

      if (order.status === "Delivered" &&
          status !== "Delivered") {
        return {
          error: "Delivered orders cannot be changed.",
          code: 409
        };
      }

      // Restore inventory once, if the order is cancelled.
      if (status === "Cancelled") {
        const items = JSON.parse(order.items_json);

        for (const item of items) {
          db.prepare(`
            UPDATE products
            SET stock = stock + ?
            WHERE id = ? AND shop_id = ?
          `).run(
            item.quantity,
            item.productId,
            req.session.shopId
          );
        }
      }

      db.prepare(`
        UPDATE orders
        SET status = ?
        WHERE id = ? AND shop_id = ?
      `).run(status, orderId, req.session.shopId);

      return { id: orderId, status };
    });

    const result = updateStatus();

    if (result.error) {
      return res.status(result.code).json({
        error: result.error
      });
    }

    res.json({
      message: "Order status updated.",
      ...result
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not update order status."
    });
  }
});
/* ================================
   CUSTOMER PUBLIC APIs
================================ */

// Get all registered shops
app.get("/api/shops", (req, res) => {
  try {
    const shops = db.prepare(`
      SELECT shop_id, shop_name
      FROM shops
      ORDER BY shop_name COLLATE NOCASE
    `).all();

    res.json(shops);
  } catch (error) {
    console.error("Error fetching shops:", error);
    res.status(500).json({
      error: "Could not load shops."
    });
  }
});

// Get products for the selected shop
app.get("/api/customer/shops/:shopId/products", (req, res) => {
  try {
    const shopId = req.params.shopId;

    const shop = db.prepare(`
      SELECT shop_id, shop_name
      FROM shops
      WHERE shop_id = ?
    `).get(shopId);

    if (!shop) {
      return res.status(404).json({
        error: "Shop not found."
      });
    }

    const products = db.prepare(`
      SELECT id, name, mrp, discount, stock, image_path
      FROM products
      WHERE shop_id = ? AND stock > 0
      ORDER BY name COLLATE NOCASE
    `).all(shopId);

    res.json({
      shop,
      products: products.map(product => ({
        ...product,
        sellingPrice: Math.round(
          product.mrp * (1 - product.discount / 100) * 100
        ) / 100
      }))
    });
  } catch (error) {
    console.error("Error fetching customer products:", error);
    res.status(500).json({
      error: "Could not load products."
    });
  }
});
// Logout
app.post("/api/logout", requireLogin, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Logout failed." });
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out." });
  });
});

const port = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error("Add SESSION_SECRET to your .env file.");
}

app.listen(port, () => {
  console.log(`Shop website running at http://localhost:${port}`);
});
