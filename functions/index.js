const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Razorpay = require("razorpay");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

admin.initializeApp();

const db = admin.firestore();
const app = express();

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const JWT_SECRET = defineSecret("JWT_SECRET");
const ADMIN_SETUP_KEY = defineSecret("ADMIN_SETUP_KEY");

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

function secretValue(secret, envName) {
  try {
    return secret.value() || process.env[envName] || "";
  } catch {
    return process.env[envName] || "";
  }
}

function bookingRef() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `WL-${year}-${rand}`;
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function publicHotel(doc) {
  const data = doc.data();
  return {
    id: data.legacyId || doc.id,
    ...data,
    main_image: data.main_image || data.image || (data.images || [])[0] || null
  };
}

async function getDocByIdOrLegacy(collection, id) {
  const direct = await db.collection(collection).doc(String(id)).get();
  if (direct.exists) return direct;

  const numeric = Number(id);
  if (!Number.isNaN(numeric)) {
    const snap = await db.collection(collection).where("legacyId", "==", numeric).limit(1).get();
    if (!snap.empty) return snap.docs[0];
  }

  return null;
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const jwtSecret = secretValue(JWT_SECRET, "JWT_SECRET");

  if (!token || !jwtSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.admin = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

app.get(["/health", "/api/health"], (req, res) => {
  res.json({ ok: true, backend: "firebase" });
});

app.get("/api/hotels", async (req, res) => {
  try {
    let query = db.collection("hotels");
    if (req.query.city) query = query.where("city", "==", String(req.query.city));
    if (req.query.architecture) query = query.where("architecture", "==", String(req.query.architecture));
    if (req.query.full_villa === "1") query = query.where("is_full_villa", "==", true);

    const snap = await query.get();
    res.json(snap.docs.map(publicHotel));
  } catch (err) {
    console.error("GET /api/hotels", err);
    res.status(500).json({ error: "Failed to fetch hotels" });
  }
});

app.get("/api/hotels/:id", async (req, res) => {
  try {
    const hotelDoc = await getDocByIdOrLegacy("hotels", req.params.id);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const hotel = publicHotel(hotelDoc);
    const rooms = await hotelDoc.ref.collection("rooms").get();
    hotel.rooms = rooms.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    hotel.images = hotel.images || [];

    res.json(hotel);
  } catch (err) {
    console.error("GET /api/hotels/:id", err);
    res.status(500).json({ error: "Failed to fetch hotel" });
  }
});

app.get("/api/inventory", async (req, res) => {
  try {
    const hotelDoc = await getDocByIdOrLegacy("hotels", req.query.hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const rooms = await hotelDoc.ref.collection("rooms").get();
    const inventory = rooms.docs.map(doc => {
      const room = doc.data();
      return {
        roomId: room.legacyId || doc.id,
        room_id: room.legacyId || doc.id,
        category: room.category || room.room_name || "Room",
        rate: money(room.rate || room.price || room.price_per_night),
        rooms: Number(room.max_rooms || room.rooms || 1),
        available_rooms: Number(room.available_rooms || room.max_rooms || room.rooms || 1)
      };
    });

    res.json({ success: true, inventory });
  } catch (err) {
    console.error("GET /api/inventory", err);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

app.post("/api/bookings/create-pending", async (req, res) => {
  try {
    const {
      hotelId,
      checkIn,
      checkOut,
      adults,
      kids,
      rooms = [],
      isFullVilla = false,
      totalAmount,
      gstPercent = 0,
      guest_name,
      guest_phone,
      guest_email
    } = req.body;

    if (!hotelId || !checkIn || !checkOut || !guest_name || !guest_phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const total = money(totalAmount);
    if (total <= 0) return res.status(400).json({ error: "Invalid total amount" });

    const baseAmount = money((total * 100) / (100 + Number(gstPercent || 0)));
    const gstAmount = money(total - baseAmount);
    const ref = bookingRef();

    const booking = {
      booking_reference: ref,
      hotel_id: hotelId,
      check_in: checkIn,
      check_out: checkOut,
      adults: Number(adults || 1),
      kids: Number(kids || 0),
      rooms: isFullVilla ? [] : rooms,
      is_full_villa: isFullVilla === true,
      base_amount: baseAmount,
      gst_percent: Number(gstPercent || 0),
      gst_amount: gstAmount,
      total_amount: total,
      guest_name,
      guest_phone,
      guest_email: guest_email || null,
      status: "pending",
      payment_status: "pending",
      hotel_payment_status: "unpaid",
      source: "website",
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };

    const doc = await db.collection("bookings").add(booking);

    res.json({
      success: true,
      bookingId: doc.id,
      bookingReference: ref,
      baseAmount,
      gstPercent,
      gstAmount,
      totalAmount: total
    });
  } catch (err) {
    console.error("POST /api/bookings/create-pending", err);
    res.status(500).json({ error: "Failed to create pending booking" });
  }
});

app.post("/api/payments/create-order", async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: "bookingId required" });

    const bookingDoc = await db.collection("bookings").doc(String(bookingId)).get();
    if (!bookingDoc.exists || bookingDoc.data().status !== "pending") {
      return res.status(400).json({ error: "Invalid or confirmed booking" });
    }

    const keyId = secretValue(RAZORPAY_KEY_ID, "RAZORPAY_KEY_ID");
    const keySecret = secretValue(RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) return res.status(500).json({ error: "Razorpay is not configured" });

    const booking = bookingDoc.data();
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await razorpay.orders.create({
      amount: Math.round(Number(booking.total_amount) * 100),
      currency: "INR",
      receipt: booking.booking_reference,
      payment_capture: 1
    });

    await bookingDoc.ref.update({
      razorpay_order_id: order.id,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: booking.total_amount,
      razorpayKey: keyId,
      bookingReference: booking.booking_reference,
      bookingId
    });
  } catch (err) {
    console.error("POST /api/payments/create-order", err);
    res.status(500).json({ error: "Failed to create Razorpay order" });
  }
});

app.post("/api/payments/verify", async (req, res) => {
  try {
    const {
      bookingId,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = req.body;

    const keySecret = secretValue(RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET");
    if (!bookingId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing payment fields" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const bookingRef = db.collection("bookings").doc(String(bookingId));
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists || bookingDoc.data().status !== "pending") {
      return res.status(400).json({ error: "Invalid booking" });
    }

    const booking = bookingDoc.data();
    await bookingRef.update({
      status: "confirmed",
      payment_status: "paid",
      hotel_payment_status: "paid",
      advance_amount: booking.total_amount,
      balance_amount: 0,
      razorpay_payment_id,
      razorpay_order_id,
      confirmed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      bookingReference: booking.booking_reference
    });
  } catch (err) {
    console.error("POST /api/payments/verify", err);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const snap = await db.collection("admins").where("email", "==", email).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: "Invalid credentials" });

    const adminDoc = snap.docs[0];
    const adminUser = adminDoc.data();
    const ok = await bcrypt.compare(password, adminUser.password_hash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const jwtSecret = secretValue(JWT_SECRET, "JWT_SECRET");
    const token = jwt.sign(
      { adminId: adminDoc.id, email: adminUser.email },
      jwtSecret,
      { expiresIn: "12h" }
    );

    res.json({
      success: true,
      token,
      admin: { id: adminDoc.id, email: adminUser.email }
    });
  } catch (err) {
    console.error("POST /api/admin/login", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/admin/create-admin", async (req, res) => {
  try {
    const { email, password, setupKey } = req.body;
    if (!email || !password || !setupKey) return res.status(400).json({ error: "Missing fields" });
    if (setupKey !== secretValue(ADMIN_SETUP_KEY, "ADMIN_SETUP_KEY")) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const existing = await db.collection("admins").where("email", "==", email).limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: "Admin already exists" });

    const password_hash = await bcrypt.hash(password, 10);
    await db.collection("admins").add({
      email,
      password_hash,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/admin/create-admin", err);
    res.status(500).json({ error: "Admin creation failed" });
  }
});

app.get("/api/bookings", requireAdmin, async (req, res) => {
  try {
    let query = db.collection("bookings").orderBy("created_at", "desc");
    if (req.query.status) query = query.where("status", "==", String(req.query.status));

    const snap = await query.get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) {
    console.error("GET /api/bookings", err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

app.use("/api", (req, res) => {
  res.status(501).json({
    error: "This Firebase endpoint is not migrated yet",
    path: req.originalUrl
  });
});

exports.api = onRequest(
  {
    region: "asia-south1",
    secrets: [
      RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET,
      JWT_SECRET,
      ADMIN_SETUP_KEY
    ]
  },
  app
);

