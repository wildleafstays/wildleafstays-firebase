const express = require("express");
const {
  getPropertyBundle,
  readInventoryForDates,
  villaAvailable,
  roomAvailable,
  quoteRooms,
  quoteVilla,
  applyRoomBooking,
  applyVillaBooking,
  releaseBooking,
  stayDates
} = require("./inventory");

module.exports = function bookingRoutes({ db, admin }) {
  const router = express.Router();

  router.post("/hold", async (req, res) => {
    try {
      const bookingInput = normalizeBookingInput(req.body);
      const dates = stayDates(bookingInput.checkIn, bookingInput.checkOut);
      if (dates.length === 0) return res.status(400).json({ error: "Invalid dates" });

      const bundle = await getPropertyBundle(db, bookingInput.propertyId);
      if (!bundle) return res.status(404).json({ error: "Property not found" });

      const quote = bookingInput.bookingType === "fullVilla"
        ? quoteVilla(bundle.property, dates)
        : quoteRooms(bundle.roomCategories, bookingInput.rooms, dates);

      if (quote.totalAmount <= 0) {
        return res.status(400).json({ error: "Invalid booking amount" });
      }

      const bookingRef = db.collection("bookings").doc();
      await bookingRef.set({
        ...bookingInput,
        propertyName: bundle.property.name,
        destination: bundle.property.destination,
        bookingStatus: "payment_pending",
        paymentStatus: "unpaid",
        quote,
        totalAmount: quote.totalAmount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.json({ success: true, bookingId: bookingRef.id, quote });
    } catch (err) {
      console.error("POST /api/bookings/hold", err);
      res.status(500).json({ error: "Failed to create booking hold" });
    }
  });

  router.post("/:bookingId/confirmWithoutPayment", async (req, res) => {
    try {
      const result = await confirmBookingTransaction({ db, admin, bookingId: req.params.bookingId });
      res.json(result);
    } catch (err) {
      console.error("POST /api/bookings/:bookingId/confirmWithoutPayment", err);
      res.status(409).json({ error: err.message || "Booking not available" });
    }
  });

  router.post("/:bookingId/cancel", async (req, res) => {
    try {
      const result = await db.runTransaction(async transaction => {
        const bookingRef = db.collection("bookings").doc(String(req.params.bookingId));
        const bookingSnap = await transaction.get(bookingRef);
        if (!bookingSnap.exists) throw new Error("Booking not found");

        const booking = { id: bookingSnap.id, ...bookingSnap.data() };
        if (booking.bookingStatus === "cancelled") {
          return { success: true, alreadyCancelled: true };
        }

        if (booking.bookingStatus === "confirmed") {
          const bundle = await getPropertyBundle(db, booking.propertyId);
          if (!bundle) throw new Error("Property not found");

          const dates = stayDates(booking.checkIn, booking.checkOut);
          const inventoryDocs = await readInventoryForDates(transaction, bundle.propertyRef, dates, bundle.roomCategories);

          inventoryDocs.forEach(day => {
            const updated = releaseBooking(day.data, booking);
            transaction.set(day.ref, {
              ...updated,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          });
        }

        transaction.update(bookingRef, {
          bookingStatus: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };
      });

      res.json(result);
    } catch (err) {
      console.error("POST /api/bookings/:bookingId/cancel", err);
      res.status(500).json({ error: "Failed to cancel booking" });
    }
  });

  return router;
};

function normalizeBookingInput(body) {
  return {
    propertyId: String(body.propertyId || ""),
    bookingType: body.bookingType === "fullVilla" ? "fullVilla" : "rooms",
    checkIn: String(body.checkIn || "").slice(0, 10),
    checkOut: String(body.checkOut || "").slice(0, 10),
    adults: Number(body.adults || 1),
    kids: Number(body.kids || 0),
    guest: {
      name: String(body.guest?.name || body.guestName || "").trim(),
      phone: String(body.guest?.phone || body.guestPhone || "").trim(),
      email: String(body.guest?.email || body.guestEmail || "").trim()
    },
    rooms: Array.isArray(body.rooms)
      ? body.rooms.map(room => ({
          roomCategoryId: String(room.roomCategoryId || ""),
          quantity: Number(room.quantity || 1)
        })).filter(room => room.roomCategoryId && room.quantity > 0)
      : [],
    source: body.source || "website"
  };
}

async function confirmBookingTransaction({ db, admin, bookingId, payment = null }) {
  return db.runTransaction(async transaction => {
    const bookingRef = db.collection("bookings").doc(String(bookingId));
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) throw new Error("Booking not found");

    const booking = { id: bookingSnap.id, ...bookingSnap.data() };
    if (booking.bookingStatus === "confirmed") {
      return { success: true, bookingId, alreadyConfirmed: true };
    }
    if (booking.bookingStatus !== "payment_pending") {
      throw new Error("Booking cannot be confirmed");
    }

    const bundle = await getPropertyBundle(db, booking.propertyId);
    if (!bundle) throw new Error("Property not found");

    const dates = stayDates(booking.checkIn, booking.checkOut);
    const inventoryDocs = await readInventoryForDates(transaction, bundle.propertyRef, dates, bundle.roomCategories);

    if (booking.bookingType === "fullVilla") {
      for (const day of inventoryDocs) {
        if (!villaAvailable(day.data, bundle.roomCategories)) {
          throw new Error("Full villa is no longer available for selected dates");
        }
      }
    } else {
      for (const day of inventoryDocs) {
        for (const item of booking.rooms || []) {
          if (!roomAvailable(day.data, item.roomCategoryId, item.quantity)) {
            throw new Error("Selected rooms are no longer available");
          }
        }
      }
    }

    inventoryDocs.forEach(day => {
      const updated = booking.bookingType === "fullVilla"
        ? applyVillaBooking(day.data, booking.id)
        : applyRoomBooking(day.data, booking.rooms, booking.id);

      transaction.set(day.ref, {
        ...updated,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    transaction.update(bookingRef, {
      bookingStatus: "confirmed",
      paymentStatus: payment ? "paid" : booking.paymentStatus,
      payment,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, bookingId };
  });
}

module.exports.confirmBookingTransaction = confirmBookingTransaction;
