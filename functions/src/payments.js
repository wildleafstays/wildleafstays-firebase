const crypto = require("crypto");
const express = require("express");
const Razorpay = require("razorpay");
const { paise } = require("./money");
const { confirmBookingTransaction } = require("./bookings");

module.exports = function paymentRoutes({ db, admin, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET }) {
  const router = express.Router();

  router.post("/create-order", async (req, res) => {
    try {
      const bookingId = String(req.body.bookingId || "");
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) return res.status(404).json({ error: "Booking not found" });

      const booking = bookingSnap.data();
      if (booking.bookingStatus !== "payment_pending") {
        return res.status(400).json({ error: "Booking is not ready for payment" });
      }

      const razorpay = razorpayClient(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET);
      const order = await razorpay.orders.create({
        amount: paise(booking.totalAmount),
        currency: "INR",
        receipt: bookingId.slice(0, 40),
        notes: {
          bookingId,
          propertyId: booking.propertyId,
          bookingType: booking.bookingType
        }
      });

      await bookingRef.set({
        razorpayOrderId: order.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({
        success: true,
        bookingId,
        keyId: secretValue(RAZORPAY_KEY_ID, "RAZORPAY_KEY_ID"),
        orderId: order.id,
        amount: order.amount,
        currency: order.currency
      });
    } catch (err) {
      console.error("POST /api/payments/create-order", err);
      res.status(500).json({ error: "Failed to create Razorpay order" });
    }
  });

  router.post("/verify", async (req, res) => {
    const bookingId = String(req.body.bookingId || "");
    const orderId = String(req.body.razorpay_order_id || "");
    const paymentId = String(req.body.razorpay_payment_id || "");
    const signature = String(req.body.razorpay_signature || "");

    try {
      if (!bookingId || !orderId || !paymentId || !signature) {
        return res.status(400).json({ error: "Missing Razorpay verification fields" });
      }

      const expected = crypto
        .createHmac("sha256", secretValue(RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET"))
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      if (expected !== signature) {
        return res.status(400).json({ error: "Invalid payment signature" });
      }

      const payment = {
        provider: "razorpay",
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const result = await confirmBookingTransaction({ db, admin, bookingId, payment });

      await db.collection("payments").doc(paymentId).set({
        ...payment,
        bookingId,
        status: "paid",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true, bookingId, ...result });
    } catch (err) {
      console.error("POST /api/payments/verify", err);
      if (bookingId && paymentId) {
        await db.collection("bookings").doc(bookingId).set({
          paymentStatus: "paid_inventory_failed",
          paymentFailureReason: err.message || "Inventory unavailable after payment",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      res.status(409).json({ error: err.message || "Payment verified but booking could not be confirmed" });
    }
  });

  return router;
};

function razorpayClient(keyIdSecret, keySecretSecret) {
  return new Razorpay({
    key_id: secretValue(keyIdSecret, "RAZORPAY_KEY_ID"),
    key_secret: secretValue(keySecretSecret, "RAZORPAY_KEY_SECRET")
  });
}

function secretValue(secret, envName) {
  if (secret?.value) return secret.value();
  return process.env[envName];
}
