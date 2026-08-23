const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

admin.initializeApp();

const db = admin.firestore();
const app = express();

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const ADMIN_SETUP_KEY = defineSecret("ADMIN_SETUP_KEY");

const adminRoutes = require("./src/admin");
const availabilityRoutes = require("./src/availability");
const bookingRoutes = require("./src/bookings");
const paymentRoutes = require("./src/payments");

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "wildleafstays-clean-firebase" });
});

app.use("/api/admin", adminRoutes({ db, admin, ADMIN_SETUP_KEY }));
app.use("/api/availability", availabilityRoutes({ db, admin }));
app.use("/api/bookings", bookingRoutes({ db, admin }));
app.use("/api/payments", paymentRoutes({ db, admin, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET }));

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found", path: req.originalUrl });
});

exports.api = onRequest(
  {
    region: "asia-south1",
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, ADMIN_SETUP_KEY]
  },
  app
);
