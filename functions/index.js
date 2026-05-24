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

function slugify(value) {
  return String(value || "wildleaf")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "wildleaf";
}

function parseYmd(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const dates = [];
  const startDate = parseYmd(start);
  const endDate = parseYmd(end || start);
  if (!startDate || !endDate) return dates;

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(formatYmd(d));
  }
  return dates;
}

function stayNights(checkIn, checkOut) {
  const dates = [];
  const startDate = parseYmd(checkIn);
  const endDate = parseYmd(checkOut);
  if (!startDate || !endDate || startDate >= endDate) return dates;

  for (let d = new Date(startDate); d < endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(formatYmd(d));
  }
  return dates;
}

function physicalRoomId(roomCategoryId, roomName) {
  return `${roomCategoryId}__${slugify(roomName)}`;
}

async function listPhysicalRooms(hotelDoc) {
  const roomsSnap = await hotelDoc.ref.collection("rooms").get();
  const rooms = [];

  roomsSnap.forEach(doc => {
    const room = doc.data();
    const categoryId = room.legacyId || doc.id;
    const maxRooms = Number(room.max_rooms || room.rooms || 1);
    const names = Array.isArray(room.roomNames) && room.roomNames.length
      ? room.roomNames
      : Array.from({ length: maxRooms }, (_, i) => `${room.category || room.room_name || "Room"} ${i + 1}`);

    names.slice(0, maxRooms).forEach((name, index) => {
      rooms.push({
        room_id: physicalRoomId(categoryId, name),
        room_name: name,
        room_category_id: categoryId,
        category: room.category || room.room_name || "Room",
        sort: index
      });
    });
  });

  return rooms;
}

async function bookingsForHotel(hotelId) {
  const snap = await db.collection("bookings")
    .where("hotel_id", "==", String(hotelId))
    .get();

  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function activeBooking(booking) {
  return !["cancelled", "canceled"].includes(String(booking.status || "").toLowerCase());
}

function bookingOverlaps(booking, checkIn, checkOut) {
  const wanted = new Set(stayNights(checkIn, checkOut));
  return stayNights(booking.check_in, booking.check_out).some(date => wanted.has(date));
}

async function allocateRoomsForBooking(hotelDoc, requestedRooms, checkIn, checkOut, excludeBookingId = "") {
  const allRooms = await listPhysicalRooms(hotelDoc);
  const bookings = (await bookingsForHotel(hotelDoc.data().legacyId || hotelDoc.id))
    .filter(b => activeBooking(b) && String(b.id) !== String(excludeBookingId) && bookingOverlaps(b, checkIn, checkOut));

  const bookedRoomIds = new Set();
  bookings.forEach(booking => {
    (booking.rooms || []).forEach(room => bookedRoomIds.add(String(room.room_id)));
  });

  const available = allRooms.filter(room => !bookedRoomIds.has(String(room.room_id)));
  const allocated = [];

  for (const request of requestedRooms || []) {
    const categoryId = String(request.roomCategoryId || request.room_category_id || request.roomId || request.id || "");
    const count = Math.max(Number(request.rooms || request.count || 1), 1);
    const matches = available.filter(room => String(room.room_category_id) === categoryId && !allocated.some(a => a.room_id === room.room_id));

    if (matches.length < count) {
      throw new Error(`Not enough rooms available for ${categoryId}`);
    }

    allocated.push(...matches.slice(0, count));
  }

  return allocated;
}

function bookingBalance(total, advance) {
  return Math.max(money(total) - money(advance), 0);
}

function publicHotel(doc) {
  const data = doc.data();
  return {
    id: data.legacyId || doc.id,
    ...data,
    main_image: data.main_image || data.image || (data.images || [])[0] || null
  };
}

function hotelCard(hotel) {
  return {
    title: hotel.name,
    image: hotel.main_image || hotel.image || (hotel.images || [])[0] || "",
    price: hotel.price_per_night || hotel.rate || "",
    max_guests: hotel.max_guests || "",
    amenities: hotel.amenities || [],
    filter_value: hotel.city || hotel.legacyId || hotel.id,
    city: hotel.city || hotel.location || ""
  };
}

function defaultHeroImage() {
  return "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1600&q=80";
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

async function findRoomDoc(roomId) {
  const hotels = await db.collection("hotels").get();
  for (const hotel of hotels.docs) {
    const direct = await hotel.ref.collection("rooms").doc(String(roomId)).get();
    if (direct.exists) return { hotelDoc: hotel, roomDoc: direct };

    const snap = await hotel.ref
      .collection("rooms")
      .where("legacyId", "==", Number(roomId))
      .limit(1)
      .get();
    if (!snap.empty) return { hotelDoc: hotel, roomDoc: snap.docs[0] };
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

app.get("/api/branding", async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("branding").get();
    res.json({
      site_title: "Wildleaf Stays",
      logo_url: "",
      hero_message: "Find peaceful stays close to nature",
      hero_offers: [],
      ...(doc.exists ? doc.data() : {})
    });
  } catch (err) {
    console.error("GET /api/branding", err);
    res.status(500).json({ error: "Failed to fetch branding" });
  }
});

app.get("/api/header-menu", async (req, res) => {
  try {
    const snap = await db.collection("headerMenu").orderBy("sort_order", "asc").get();
    if (snap.empty) {
      return res.json([
        { label: "Home", url: "/" },
        { label: "Villas", url: "/full-villa.html" }
      ]);
    }

    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) {
    console.error("GET /api/header-menu", err);
    res.status(500).json({ error: "Failed to fetch header menu" });
  }
});

app.get("/api/collage", async (req, res) => {
  try {
    const snap = await db.collection("collage").orderBy("sort_order", "asc").get();
    if (snap.empty) return res.json([{ image_url: defaultHeroImage() }]);
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) {
    console.error("GET /api/collage", err);
    res.status(500).json({ error: "Failed to fetch collage" });
  }
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

app.post("/api/hotels", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Hotel name required" });

    let id = slugify(name);
    const existing = await db.collection("hotels").doc(id).get();
    if (existing.exists) id = `${id}-${Date.now().toString(36)}`;

    const hotel = {
      name,
      city: req.body.city || "",
      location: req.body.location || req.body.city || "",
      address: req.body.address || "",
      description: req.body.description || "",
      full_villa: Number(req.body.full_villa || 0),
      is_full_villa: Number(req.body.full_villa || 0) === 1,
      images: [],
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection("hotels").doc(id).set(hotel);
    res.json({ id, ...hotel });
  } catch (err) {
    console.error("POST /api/hotels", err);
    res.status(500).json({ error: "Failed to create hotel" });
  }
});

app.get("/api/homepage/render", async (req, res) => {
  try {
    const hotelsSnap = await db.collection("hotels").get();
    const hotels = hotelsSnap.docs.map(doc => ({ id: doc.id, ...publicHotel(doc) }));
    const cities = [...new Set(hotels.map(hotel => hotel.city).filter(Boolean))];

    const sections = [];

    if (hotels.length) {
      sections.push({
        title: "Featured Stays",
        filter_type: "hotel",
        card_style: "style1",
        show_price: true,
        show_occupancy: true,
        show_amenities: true,
        items: hotels.map(hotel => ({
          ...hotelCard(hotel),
          filter_value: hotel.legacyId || hotel.id
        }))
      });
    }

    if (cities.length) {
      sections.push({
        title: "Explore By Location",
        filter_type: "city",
        card_style: "style2",
        show_price: false,
        show_occupancy: false,
        show_amenities: false,
        items: cities.map(city => {
          const hotel = hotels.find(h => h.city === city) || {};
          return {
            title: city,
            image: hotel.main_image || hotel.image || defaultHeroImage(),
            filter_value: city,
            city
          };
        })
      });
    }

    res.json(sections);
  } catch (err) {
    console.error("GET /api/homepage/render", err);
    res.status(500).json({ error: "Failed to render homepage" });
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

app.put("/api/hotels/:id", requireAdmin, async (req, res) => {
  try {
    const hotelDoc = await getDocByIdOrLegacy("hotels", req.params.id);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const data = { ...req.body };
    data.full_villa = Number(data.full_villa || 0);
    data.is_full_villa = data.full_villa === 1;
    data.location = data.location || data.city || data.address || "";
    data.updated_at = admin.firestore.FieldValue.serverTimestamp();

    await hotelDoc.ref.set(data, { merge: true });
    res.json({ success: true, id: hotelDoc.id });
  } catch (err) {
    console.error("PUT /api/hotels/:id", err);
    res.status(500).json({ error: "Failed to update hotel" });
  }
});

app.delete("/api/hotels/:id", requireAdmin, async (req, res) => {
  try {
    const hotelDoc = await getDocByIdOrLegacy("hotels", req.params.id);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const rooms = await hotelDoc.ref.collection("rooms").get();
    const batch = db.batch();
    rooms.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(hotelDoc.ref);
    await batch.commit();

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/hotels/:id", err);
    res.status(500).json({ error: "Failed to delete hotel" });
  }
});

app.post("/api/hotels/:hotelId/rooms", requireAdmin, async (req, res) => {
  try {
    const hotelDoc = await getDocByIdOrLegacy("hotels", req.params.hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const category = String(req.body.category || "").trim();
    if (!category) return res.status(400).json({ error: "Room category required" });

    let id = slugify(category);
    const existing = await hotelDoc.ref.collection("rooms").doc(id).get();
    if (existing.exists) id = `${id}-${Date.now().toString(36)}`;

    const room = {
      ...req.body,
      category,
      price: money(req.body.price),
      price_per_night: money(req.body.price),
      rate: money(req.body.price),
      gst: Number(req.body.gst || 0),
      max_rooms: Number(req.body.max_rooms || 1),
      available_rooms: Number(req.body.max_rooms || 1),
      max_guests: Number(req.body.max_guests || 1),
      roomNames: Array.isArray(req.body.roomNames) ? req.body.roomNames : [],
      images: [],
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await hotelDoc.ref.collection("rooms").doc(id).set(room);
    res.json({ success: true, id, roomCategoryId: id });
  } catch (err) {
    console.error("POST /api/hotels/:hotelId/rooms", err);
    res.status(500).json({ error: "Failed to create room" });
  }
});

app.put("/api/rooms/:id", requireAdmin, async (req, res) => {
  try {
    const found = await findRoomDoc(req.params.id);
    if (!found) return res.status(404).json({ error: "Room not found" });

    const data = {
      ...req.body,
      price: money(req.body.price),
      price_per_night: money(req.body.price),
      rate: money(req.body.price),
      gst: Number(req.body.gst || 0),
      max_rooms: Number(req.body.max_rooms || 1),
      available_rooms: Number(req.body.max_rooms || 1),
      max_guests: Number(req.body.max_guests || 1),
      roomNames: Array.isArray(req.body.roomNames) ? req.body.roomNames : [],
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await found.roomDoc.ref.set(data, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/rooms/:id", err);
    res.status(500).json({ error: "Failed to update room" });
  }
});

app.delete("/api/rooms/:id", requireAdmin, async (req, res) => {
  try {
    const found = await findRoomDoc(req.params.id);
    if (!found) return res.status(404).json({ error: "Room not found" });
    await found.roomDoc.ref.delete();
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/rooms/:id", err);
    res.status(500).json({ error: "Failed to delete room" });
  }
});

app.get("/api/rooms/by-category/:id", requireAdmin, async (req, res) => {
  try {
    const found = await findRoomDoc(req.params.id);
    if (!found) return res.json([]);
    res.json(found.roomDoc.data().roomNames || []);
  } catch (err) {
    console.error("GET /api/rooms/by-category/:id", err);
    res.status(500).json({ error: "Failed to fetch room names" });
  }
});

app.get("/api/rooms/:id/images", requireAdmin, async (req, res) => {
  try {
    const found = await findRoomDoc(req.params.id);
    if (!found) return res.json([]);
    res.json(found.roomDoc.data().images || []);
  } catch (err) {
    console.error("GET /api/rooms/:id/images", err);
    res.status(500).json({ error: "Failed to fetch room images" });
  }
});

app.get("/api/inventory", async (req, res) => {
  try {
    const hotelDoc = await getDocByIdOrLegacy("hotels", req.query.hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const dates = dateRange(req.query.start, req.query.end);
    const rooms = await hotelDoc.ref.collection("rooms").get();
    const inventory = [];
    let villaPrice = 0;
    let gstPercent = 0;
    let villaAvailable = true;

    for (const doc of rooms.docs) {
      const room = doc.data();
      const maxRooms = Number(room.max_rooms || room.rooms || 1);
      const baseRate = money(room.rate || room.price || room.price_per_night);
      const roomId = room.legacyId || doc.id;
      const targetDates = dates.length ? dates : [null];
      if (!gstPercent && room.gst) gstPercent = Number(room.gst);

      for (const date of targetDates) {
        let override = {};
        if (date) {
          const overrideDoc = await hotelDoc.ref
            .collection("rooms")
            .doc(doc.id)
            .collection("inventory")
            .doc(date)
            .get();
          override = overrideDoc.exists ? overrideDoc.data() : {};
        }

        const availableRooms = override.available_rooms ?? room.available_rooms ?? maxRooms;
        const effectiveRate = override.rate ?? baseRate;
        if (date === dates[0] || (!dates.length && date === null)) {
          villaPrice += money(effectiveRate) * maxRooms;
        }
        if (Number(availableRooms) < maxRooms || override.villa_booked) {
          villaAvailable = false;
        }

        inventory.push({
          roomId,
          room_id: roomId,
          room_category_id: roomId,
          category: room.category || room.room_name || "Room",
          max_rooms: maxRooms,
          rooms: maxRooms,
          date,
          available_rooms: Number(availableRooms),
          rate: override.rate ?? null,
          base_price: baseRate,
          villa_booked: override.villa_booked ? 1 : 0
        });
      }
    }

    res.json({
      success: true,
      inventory,
      villa_available: villaAvailable,
      villa_price: Math.round(villaPrice),
      gst_percent: gstPercent
    });
  } catch (err) {
    console.error("GET /api/inventory", err);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});

app.post("/api/inventory/update", requireAdmin, async (req, res) => {
  try {
    const { hotelId, roomCategoryId, date } = req.body;
    if (!hotelId || !roomCategoryId || !date) {
      return res.status(400).json({ error: "hotelId, roomCategoryId and date are required" });
    }

    const hotelDoc = await getDocByIdOrLegacy("hotels", hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const roomId = String(roomCategoryId);
    let roomDoc = await hotelDoc.ref.collection("rooms").doc(roomId).get();
    if (!roomDoc.exists) {
      const snap = await hotelDoc.ref
        .collection("rooms")
        .where("legacyId", "==", Number(roomCategoryId))
        .limit(1)
        .get();
      if (!snap.empty) roomDoc = snap.docs[0];
    }
    if (!roomDoc.exists) return res.status(404).json({ error: "Room not found" });

    const room = roomDoc.data();
    const maxRooms = Number(room.max_rooms || 1);
    const update = {
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    if (Object.prototype.hasOwnProperty.call(req.body, "availableRooms")) {
      const available = Number(req.body.availableRooms);
      if (Number.isNaN(available)) return res.status(400).json({ error: "Invalid availableRooms" });
      update.available_rooms = Math.min(Math.max(available, 0), maxRooms);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "rate")) {
      update.rate = req.body.rate === null ? null : money(req.body.rate);
    }

    await roomDoc.ref.collection("inventory").doc(String(date).slice(0, 10)).set(update, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/inventory/update", err);
    res.status(500).json({ error: "Failed to update inventory" });
  }
});

app.get("/api/calendar", async (req, res) => {
  try {
    const hotelDoc = await getDocByIdOrLegacy("hotels", req.query.hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const days = Math.min(Math.max(Number(req.query.days || 14), 1), 45);
    const from = String(req.query.from || formatYmd(new Date())).slice(0, 10);
    const fromDate = parseYmd(from);
    if (!fromDate) return res.status(400).json({ error: "Invalid from date" });
    const dates = dateRange(from, formatYmd(new Date(fromDate.getTime() + (days - 1) * 86400000)));
    const rooms = await listPhysicalRooms(hotelDoc);
    const bookings = (await bookingsForHotel(hotelDoc.data().legacyId || hotelDoc.id))
      .filter(activeBooking);

    const rows = [];
    for (const room of rooms) {
      for (const date of dates) {
        const booking = bookings.find(b =>
          (b.rooms || []).some(r => String(r.room_id) === String(room.room_id)) &&
          stayNights(b.check_in, b.check_out).includes(date)
        );

        rows.push({
          cal_date: date,
          room_id: room.room_id,
          room_name: room.room_name,
          room_category_id: room.room_category_id,
          category: room.category,
          booking_id: booking ? booking.id : null,
          guest_name: booking ? booking.guest_name : null,
          status: booking ? booking.status : null,
          hotel_payment_status: booking ? booking.hotel_payment_status : null
        });
      }
    }

    res.json(rows);
  } catch (err) {
    console.error("GET /api/calendar", err);
    res.status(500).json({ error: "Failed to fetch calendar" });
  }
});

app.get("/api/rooms/available", async (req, res) => {
  try {
    const { hotelId, checkIn, checkOut, excludeBookingId } = req.query;
    const hotelDoc = await getDocByIdOrLegacy("hotels", hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const rooms = await listPhysicalRooms(hotelDoc);
    const bookings = (await bookingsForHotel(hotelDoc.data().legacyId || hotelDoc.id))
      .filter(b => activeBooking(b) && String(b.id) !== String(excludeBookingId || "") && bookingOverlaps(b, checkIn, checkOut));

    const bookedRoomIds = new Set();
    bookings.forEach(booking => {
      (booking.rooms || []).forEach(room => bookedRoomIds.add(String(room.room_id)));
    });

    res.json(rooms.filter(room => !bookedRoomIds.has(String(room.room_id))));
  } catch (err) {
    console.error("GET /api/rooms/available", err);
    res.status(500).json({ error: "Failed to fetch available rooms" });
  }
});

app.post("/api/calendar/bookings", requireAdmin, async (req, res) => {
  try {
    const { hotelId, checkIn, checkOut, guestName, phone, rooms = [] } = req.body;
    if (!hotelId || !checkIn || !checkOut || !guestName || !phone || !rooms.length) {
      return res.status(400).json({ error: "Missing booking fields" });
    }

    const hotelDoc = await getDocByIdOrLegacy("hotels", hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    const total = money(req.body.total_amount);
    const advance = money(req.body.advance_amount);
    const booking = {
      booking_reference: bookingRef(),
      hotel_id: hotelDoc.data().legacyId || hotelDoc.id,
      hotel_name: hotelDoc.data().name || "",
      check_in: checkIn,
      check_out: checkOut,
      guest_name: guestName,
      guest_phone: phone,
      rooms,
      rooms_booked: rooms.length,
      room_names: rooms.map(room => room.room_name).join(", "),
      total_amount: total,
      advance_amount: advance,
      balance_amount: bookingBalance(total, advance),
      status: "confirmed",
      payment_status: req.body.paymentStatus || req.body.hotel_payment_status || "unpaid",
      hotel_payment_status: req.body.hotel_payment_status || req.body.paymentStatus || "unpaid",
      notes: req.body.notes || "",
      source: "admin",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    const doc = await db.collection("bookings").add(booking);
    res.json({ success: true, id: doc.id, bookingId: doc.id });
  } catch (err) {
    console.error("POST /api/calendar/bookings", err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

app.get("/api/bookings/:id", requireAdmin, async (req, res) => {
  try {
    const doc = await db.collection("bookings").doc(String(req.params.id)).get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error("GET /api/bookings/:id", err);
    res.status(500).json({ error: "Failed to fetch booking" });
  }
});

app.put("/api/calendar/bookings/:id", requireAdmin, async (req, res) => {
  try {
    const ref = db.collection("bookings").doc(String(req.params.id));
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });

    const total = money(req.body.total_amount);
    const advance = money(req.body.advance_amount);
    const rooms = Array.isArray(req.body.rooms) ? req.body.rooms : [];

    await ref.update({
      guest_name: req.body.guest_name || "",
      guest_phone: req.body.guest_phone || "",
      check_in: req.body.check_in,
      check_out: req.body.check_out,
      notes: req.body.notes || "",
      total_amount: total,
      advance_amount: advance,
      balance_amount: bookingBalance(total, advance),
      hotel_payment_status: req.body.hotel_payment_status || "unpaid",
      rooms,
      rooms_booked: rooms.length,
      room_names: rooms.map(room => room.room_name).filter(Boolean).join(", "),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/calendar/bookings/:id", err);
    res.status(500).json({ error: "Failed to update booking" });
  }
});

app.put("/api/bookings/:id/payment", requireAdmin, async (req, res) => {
  try {
    const total = money(req.body.total_amount);
    const advance = money(req.body.advance_amount);
    await db.collection("bookings").doc(String(req.params.id)).update({
      total_amount: total,
      advance_amount: advance,
      balance_amount: bookingBalance(total, advance),
      hotel_payment_status: advance >= total ? "paid" : advance > 0 ? "partial" : "unpaid",
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/bookings/:id/payment", err);
    res.status(500).json({ error: "Failed to update payment" });
  }
});

app.post("/api/bookings/:id/cancel", requireAdmin, async (req, res) => {
  try {
    await db.collection("bookings").doc(String(req.params.id)).update({
      status: "cancelled",
      cancelled_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/bookings/:id/cancel", err);
    res.status(500).json({ error: "Failed to cancel booking" });
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

    const hotelDoc = await getDocByIdOrLegacy("hotels", hotelId);
    if (!hotelDoc) return res.status(404).json({ error: "Hotel not found" });

    let allocatedRooms = [];
    try {
      allocatedRooms = isFullVilla === true
        ? await listPhysicalRooms(hotelDoc)
        : await allocateRoomsForBooking(hotelDoc, rooms, checkIn, checkOut);
    } catch (availabilityError) {
      return res.status(409).json({ error: availabilityError.message || "Selected rooms are no longer available" });
    }

    const baseAmount = money((total * 100) / (100 + Number(gstPercent || 0)));
    const gstAmount = money(total - baseAmount);
    const ref = bookingRef();

    const booking = {
      booking_reference: ref,
      hotel_id: hotelDoc.data().legacyId || hotelDoc.id,
      hotel_name: hotelDoc.data().name || "",
      check_in: checkIn,
      check_out: checkOut,
      adults: Number(adults || 1),
      kids: Number(kids || 0),
      rooms: allocatedRooms,
      rooms_booked: allocatedRooms.length,
      room_names: allocatedRooms.map(room => room.room_name).join(", "),
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
    const expectedSetupKey = String(secretValue(ADMIN_SETUP_KEY, "ADMIN_SETUP_KEY") || "").trim();
    if (String(setupKey || "").trim() !== expectedSetupKey) {
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

app.post("/api/admin/seed-initial", async (req, res) => {
  try {
    const setupKey = String(req.headers["x-setup-key"] || req.body.setupKey || "").trim();
    const expectedSetupKey = String(secretValue(ADMIN_SETUP_KEY, "ADMIN_SETUP_KEY") || "").trim();
    if (!setupKey || setupKey !== expectedSetupKey) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const hotelsRef = db.collection("hotels");
    const existing = await hotelsRef.limit(1).get();
    if (!existing.empty) return res.json({ success: true, skipped: true });

    const sampleHotels = [
      {
        id: "wildleaf-mussoorie",
        name: "Wildleaf Nature Stay",
        city: "Mussoorie",
        location: "Mussoorie",
        description: "A calm hillside stay for families and couples.",
        price_per_night: 4500,
        max_guests: 4,
        amenities: ["Mountain view", "Parking", "Breakfast"],
        main_image: defaultHeroImage(),
        image: defaultHeroImage(),
        images: [{ image_url: defaultHeroImage() }],
        is_full_villa: false
      },
      {
        id: "wildleaf-villa-dehradun",
        name: "Wildleaf Private Villa",
        city: "Dehradun",
        location: "Dehradun",
        description: "A private villa stay with open spaces and quiet evenings.",
        price_per_night: 12000,
        max_guests: 10,
        amenities: ["Full villa", "Kitchen", "Lawn"],
        main_image: defaultHeroImage(),
        image: defaultHeroImage(),
        images: [{ image_url: defaultHeroImage() }],
        is_full_villa: true
      }
    ];

    const batch = db.batch();
    for (const hotel of sampleHotels) {
      const { id, ...data } = hotel;
      const hotelRef = hotelsRef.doc(id);
      batch.set(hotelRef, {
        ...data,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      batch.set(hotelRef.collection("rooms").doc("standard-room"), {
        category: hotel.is_full_villa ? "Full Villa" : "Standard Room",
        room_name: hotel.is_full_villa ? "Full Villa" : "Standard Room",
        price_per_night: hotel.price_per_night,
        rate: hotel.price_per_night,
        max_rooms: hotel.is_full_villa ? 1 : 5,
        available_rooms: hotel.is_full_villa ? 1 : 5,
        max_guests: hotel.max_guests,
        amenities: hotel.amenities,
        main_image: hotel.main_image,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    batch.set(db.collection("settings").doc("branding"), {
      site_title: "Wildleaf Stays",
      logo_url: "",
      hero_message: "Find peaceful stays close to nature",
      hero_offers: ["Test booking is enabled with Razorpay test mode"]
    });

    await batch.commit();
    res.json({ success: true, hotels: sampleHotels.length });
  } catch (err) {
    console.error("POST /api/admin/seed-initial", err);
    res.status(500).json({ error: "Failed to seed initial data" });
  }
});

app.get("/api/bookings", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("bookings").get();
    let bookings = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (req.query.hotelId) {
      bookings = bookings.filter(booking => String(booking.hotel_id) === String(req.query.hotelId));
    }

    if (req.query.status) {
      bookings = bookings.filter(booking => String(booking.status) === String(req.query.status));
    }

    bookings.sort((a, b) => {
      const aTime = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
      const bTime = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
      return bTime - aTime;
    });

    const hotelsSnap = await db.collection("hotels").get();
    const hotelNames = new Map(hotelsSnap.docs.map(doc => [
      String(doc.data().legacyId || doc.id),
      doc.data().name || ""
    ]));

    res.json(bookings.map(booking => {
      const rooms = booking.rooms || [];
      return {
        ...booking,
        hotel_name: booking.hotel_name || hotelNames.get(String(booking.hotel_id)) || "",
        room_names: booking.room_names || rooms.map(room => room.room_name).filter(Boolean).join(", "),
        rooms_booked: booking.rooms_booked ?? rooms.length,
        booking_type: booking.is_full_villa ? "Full Villa" : "Rooms"
      };
    }));
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
