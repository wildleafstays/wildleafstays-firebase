const express = require("express");
const { requireAdmin } = require("./auth");
const { getPropertyBundle, readInventoryForDates, buildBlankInventory, stayDates } = require("./inventory");

module.exports = function adminRoutes({ db, admin, ADMIN_SETUP_KEY }) {
  const router = express.Router();

  router.post("/setup", async (req, res) => {
    try {
      if (!setupKeyMatches(req, ADMIN_SETUP_KEY)) {
        return res.status(401).json({ error: "Invalid setup key" });
      }

      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      const displayName = String(req.body.displayName || "Wildleaf Admin").trim();

      if (!email || password.length < 8) {
        return res.status(400).json({ error: "Email and 8 character password are required" });
      }

      let user;
      try {
        user = await admin.auth().getUserByEmail(email);
        user = await admin.auth().updateUser(user.uid, { password, displayName });
      } catch {
        user = await admin.auth().createUser({ email, password, displayName });
      }

      await db.collection("adminUsers").doc(user.uid).set({
        email,
        displayName,
        role: "owner",
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true, uid: user.uid, email });
    } catch (err) {
      console.error("POST /api/admin/setup", err);
      res.status(500).json({ error: "Failed to set up admin" });
    }
  });

  router.use(async (req, res, next) => {
    const auth = await requireAdmin(req, res, admin, db);
    if (!auth) return;
    req.adminUser = auth;
    next();
  });

  router.get("/properties", async (req, res) => {
    const snap = await db.collection("properties").orderBy("name").get();
    res.json({ properties: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  });

  router.post("/properties", async (req, res) => {
    try {
      const input = normalizeProperty(req.body);
      const propertyRef = input.id
        ? db.collection("properties").doc(input.id)
        : db.collection("properties").doc(slugify(input.name));

      await propertyRef.set({
        ...input,
        id: propertyRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true, propertyId: propertyRef.id });
    } catch (err) {
      console.error("POST /api/admin/properties", err);
      res.status(400).json({ error: err.message || "Failed to save property" });
    }
  });

  router.put("/properties/:propertyId", async (req, res) => {
    try {
      const input = normalizeProperty(req.body, { partial: true });
      await db.collection("properties").doc(req.params.propertyId).set({
        ...input,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/admin/properties/:propertyId", err);
      res.status(400).json({ error: err.message || "Failed to update property" });
    }
  });

  router.delete("/properties/:propertyId", async (req, res) => {
    try {
      await db.collection("properties").doc(req.params.propertyId).set({
        status: "deleted",
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/admin/properties/:propertyId", err);
      res.status(500).json({ error: "Failed to delete property" });
    }
  });

  router.get("/properties/:propertyId/roomCategories", async (req, res) => {
    const snap = await db.collection("properties").doc(req.params.propertyId)
      .collection("roomCategories").orderBy("name").get();
    res.json({ roomCategories: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  });

  router.post("/properties/:propertyId/roomCategories", async (req, res) => {
    try {
      const input = normalizeRoomCategory(req.body);
      const roomRef = input.id
        ? db.collection("properties").doc(req.params.propertyId).collection("roomCategories").doc(input.id)
        : db.collection("properties").doc(req.params.propertyId).collection("roomCategories").doc(slugify(input.name));

      await roomRef.set({
        ...input,
        id: roomRef.id,
        active: input.active !== false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.json({ success: true, roomCategoryId: roomRef.id });
    } catch (err) {
      console.error("POST /api/admin/properties/:propertyId/roomCategories", err);
      res.status(400).json({ error: err.message || "Failed to save room category" });
    }
  });

  router.put("/properties/:propertyId/roomCategories/:roomCategoryId", async (req, res) => {
    try {
      const input = normalizeRoomCategory(req.body, { partial: true });
      await db.collection("properties").doc(req.params.propertyId)
        .collection("roomCategories").doc(req.params.roomCategoryId).set({
          ...input,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/admin/properties/:propertyId/roomCategories/:roomCategoryId", err);
      res.status(400).json({ error: err.message || "Failed to update room category" });
    }
  });

  router.delete("/properties/:propertyId/roomCategories/:roomCategoryId", async (req, res) => {
    try {
      await db.collection("properties").doc(req.params.propertyId)
        .collection("roomCategories").doc(req.params.roomCategoryId).set({
          active: false,
          deletedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/admin/properties/:propertyId/roomCategories/:roomCategoryId", err);
      res.status(500).json({ error: "Failed to delete room category" });
    }
  });

  router.get("/properties/:propertyId/inventory", async (req, res) => {
    try {
      const { start, end } = req.query;
      const dates = stayDates(start, end);
      if (!dates.length) return res.status(400).json({ error: "Valid start and end dates are required" });

      const bundle = await getPropertyBundle(db, req.params.propertyId);
      if (!bundle) return res.status(404).json({ error: "Property not found" });

      const days = await db.runTransaction(async transaction => {
        return readInventoryForDates(transaction, bundle.propertyRef, dates, bundle.roomCategories);
      });

      res.json({
        roomCategories: Object.values(bundle.roomCategories),
        days: days.map(day => ({ date: day.date, ...day.data }))
      });
    } catch (err) {
      console.error("GET /api/admin/properties/:propertyId/inventory", err);
      res.status(500).json({ error: "Failed to load inventory" });
    }
  });

  router.put("/properties/:propertyId/inventory", async (req, res) => {
    try {
      const { start, end, roomCategoryId, price, availableRooms, manuallyClosed, ratePlans = {} } = req.body;
      const dates = stayDates(start, end);
      if (!dates.length || !roomCategoryId) {
        return res.status(400).json({ error: "Dates and room category are required" });
      }

      const bundle = await getPropertyBundle(db, req.params.propertyId);
      if (!bundle) return res.status(404).json({ error: "Property not found" });
      const room = bundle.roomCategories[roomCategoryId];
      if (!room) return res.status(404).json({ error: "Room category not found" });

      await db.runTransaction(async transaction => {
        const docs = await readInventoryForDates(transaction, bundle.propertyRef, dates, bundle.roomCategories);
        docs.forEach(day => {
          const data = day.data || buildBlankInventory(day.date, bundle.roomCategories);
          const current = data.roomCategories?.[roomCategoryId] || {};
          const totalRooms = Number(current.totalRooms || room.totalRooms || 0);
          const bookedRooms = Number(current.bookedRooms || 0);
          const maxAvailable = Math.max(totalRooms - bookedRooms, 0);
          const nextAvailable = availableRooms === "" || availableRooms === undefined
            ? Number(current.availableRooms ?? maxAvailable)
            : Math.min(Number(availableRooms || 0), maxAvailable);

          data.roomCategories = data.roomCategories || {};
          data.roomCategories[roomCategoryId] = {
            ...current,
            totalRooms,
            bookedRooms,
            availableRooms: manuallyClosed ? 0 : nextAvailable,
            price: price === "" || price === undefined ? Number(current.price || room.basePrice || 0) : Number(price),
            ratePlans: {
              EP: numberOrFallback(ratePlans.EP, price === "" || price === undefined ? Number(current.price || room.basePrice || 0) : Number(price)),
              CP: numberOrFallback(ratePlans.CP, current.ratePlans?.CP || room.cpRate || 0),
              MAP: numberOrFallback(ratePlans.MAP, current.ratePlans?.MAP || room.mapRate || 0),
              AP: numberOrFallback(ratePlans.AP, current.ratePlans?.AP || room.apRate || 0)
            },
            manuallyClosed: Boolean(manuallyClosed)
          };

          transaction.set(day.ref, {
            ...data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        });
      });

      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/admin/properties/:propertyId/inventory", err);
      res.status(400).json({ error: err.message || "Failed to update inventory" });
    }
  });

  router.get("/bookings", async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 200);
    let query = db.collection("bookings").orderBy("createdAt", "desc").limit(limit);
    if (req.query.propertyId) query = query.where("propertyId", "==", String(req.query.propertyId));
    const snap = await query.get();
    res.json({ bookings: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  });

  router.get("/homepage", async (req, res) => {
    const snap = await db.collection("homepageSections").orderBy("order").get();
    res.json({ sections: snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  });

  router.put("/homepage/:sectionId", async (req, res) => {
    try {
      await db.collection("homepageSections").doc(req.params.sectionId).set({
        ...req.body,
        order: Number(req.body.order || 0),
        active: req.body.active !== false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      res.json({ success: true });
    } catch (err) {
      console.error("PUT /api/admin/homepage/:sectionId", err);
      res.status(400).json({ error: "Failed to save homepage section" });
    }
  });

  return router;
};

function setupKeyMatches(req, secret) {
  const given = String(req.headers["x-setup-key"] || req.body.setupKey || "");
  const expected = secret?.value ? secret.value() : process.env.ADMIN_SETUP_KEY;
  return Boolean(given && expected && given === expected);
}

function normalizeProperty(body, options = {}) {
  const property = {};
  if (body.id) property.id = slugify(body.id);
  if (body.name !== undefined) property.name = String(body.name).trim();
  if (body.destination !== undefined) {
    property.destination = String(body.destination).trim();
    property.destinationKey = property.destination.toLowerCase();
  }
  if (body.address !== undefined) property.address = String(body.address).trim();
  if (body.description !== undefined) property.description = String(body.description).trim();
  if (body.locationText !== undefined) property.locationText = String(body.locationText || "").trim();
  if (body.neighbourhood !== undefined) property.neighbourhood = String(body.neighbourhood || "").trim();
  if (body.mapUrl !== undefined) property.mapUrl = String(body.mapUrl || "").trim();
  if (body.houseRules !== undefined) property.houseRules = String(body.houseRules || "").trim();
  if (body.status !== undefined) property.status = body.status === "draft" ? "draft" : "active";
  if (body.sellAsFullVilla !== undefined) property.sellAsFullVilla = Boolean(body.sellAsFullVilla);
  if (body.fullVillaPrice !== undefined) property.fullVillaPrice = Number(body.fullVillaPrice || 0);
  if (body.gstPercent !== undefined) property.gstPercent = Number(body.gstPercent || 0);
  if (body.maxGuests !== undefined) property.maxGuests = Number(body.maxGuests || 0);
  if (body.infantMaxAge !== undefined) property.infantMaxAge = Number(body.infantMaxAge || 2);
  if (Array.isArray(body.amenities)) property.amenities = body.amenities.map(String).filter(Boolean);
  if (typeof body.amenities === "string") property.amenities = splitCsv(body.amenities);
  if (Array.isArray(body.facilities)) property.facilities = body.facilities.map(String).filter(Boolean);
  if (typeof body.facilities === "string") property.facilities = splitCsv(body.facilities);
  if (Array.isArray(body.photos)) property.photos = body.photos.map(String).filter(Boolean);
  if (typeof body.photos === "string") property.photos = splitCsv(body.photos);

  if (!options.partial) {
    if (!property.name) throw new Error("Property name is required");
    if (!property.destination) throw new Error("Destination is required");
    property.status = property.status || "active";
    property.sellAsFullVilla = Boolean(property.sellAsFullVilla);
    property.fullVillaPrice = 0;
    property.infantMaxAge = Number(property.infantMaxAge || 2);
    property.amenities = property.amenities || [];
    property.facilities = property.facilities || [];
    property.photos = property.photos || [];
  }

  return property;
}

function normalizeRoomCategory(body, options = {}) {
  const room = {};
  if (body.id) room.id = slugify(body.id);
  if (body.name !== undefined) room.name = String(body.name).trim();
  if (body.description !== undefined) room.description = String(body.description).trim();
  if (body.totalRooms !== undefined) room.totalRooms = Number(body.totalRooms || 0);
  if (body.basePrice !== undefined) room.basePrice = Number(body.basePrice || 0);
  if (body.cpRate !== undefined) room.cpRate = Number(body.cpRate || 0);
  if (body.mapRate !== undefined) room.mapRate = Number(body.mapRate || 0);
  if (body.apRate !== undefined) room.apRate = Number(body.apRate || 0);
  if (body.gstPercent !== undefined) room.gstPercent = Number(body.gstPercent || 0);
  if (body.maxGuests !== undefined) room.maxGuests = Number(body.maxGuests || 0);
  if (body.includedGuests !== undefined) room.includedGuests = Number(body.includedGuests || 0);
  if (body.extraAdultRate !== undefined) room.extraAdultRate = Number(body.extraAdultRate || 0);
  if (body.extraKidRate !== undefined) room.extraKidRate = Number(body.extraKidRate || 0);
  if (body.viewType !== undefined) room.viewType = String(body.viewType || "").trim();
  if (body.bedType !== undefined) room.bedType = String(body.bedType || "").trim();
  if (body.sizeText !== undefined) room.sizeText = String(body.sizeText || "").trim();
  if (body.active !== undefined) room.active = Boolean(body.active);
  if (Array.isArray(body.photos)) room.photos = body.photos.map(String).filter(Boolean);
  if (typeof body.photos === "string") room.photos = splitCsv(body.photos);
  if (Array.isArray(body.amenities)) room.amenities = body.amenities.map(String).filter(Boolean);
  if (typeof body.amenities === "string") room.amenities = splitCsv(body.amenities);

  if (!options.partial) {
    if (!room.name) throw new Error("Room category name is required");
    if (!room.totalRooms || room.totalRooms < 1) throw new Error("Total rooms must be at least 1");
    if (!room.basePrice || room.basePrice < 1) throw new Error("Room price is required");
    room.maxGuests = Number(room.maxGuests || 2);
    room.includedGuests = Number(room.includedGuests || room.maxGuests);
    room.extraAdultRate = Number(room.extraAdultRate || 0);
    room.extraKidRate = Number(room.extraKidRate || 0);
    room.active = room.active !== false;
    room.photos = room.photos || [];
    room.amenities = room.amenities || [];
  }

  return room;
}

function numberOrFallback(value, fallback) {
  if (value === "" || value === undefined || value === null) return Number(fallback || 0);
  return Number(value || 0);
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
