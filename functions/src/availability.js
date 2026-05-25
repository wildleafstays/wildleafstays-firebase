const express = require("express");
const {
  getPropertyBundle,
  readInventoryForDates,
  villaAvailable,
  quoteRooms,
  quoteVilla,
  stayDates
} = require("./inventory");

module.exports = function availabilityRoutes({ db, admin }) {
  const router = express.Router();

  router.get("/homepage", async (req, res) => {
    try {
      const snap = await db.collection("homepageSections").orderBy("order").get();

      res.json({ sections: snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(section => section.active !== false)
      });
    } catch (err) {
      console.error("GET /api/availability/homepage", err);
      res.status(500).json({ error: "Failed to load homepage settings" });
    }
  });

  router.get("/search", async (req, res) => {
    try {
      const { destination, checkIn, checkOut } = req.query;
      const dates = stayDates(checkIn, checkOut);
      if (!destination || dates.length === 0) {
        return res.status(400).json({ error: "destination, checkIn and checkOut are required" });
      }

      const snap = await db.collection("properties")
        .where("destinationKey", "==", String(destination).toLowerCase())
        .where("status", "==", "active")
        .get();

      const results = [];

      for (const propertyDoc of snap.docs) {
        const bundle = await getPropertyBundle(db, propertyDoc.id);
        if (!bundle) continue;

        const inventoryDocs = await db.runTransaction(async transaction => {
          return readInventoryForDates(transaction, bundle.propertyRef, dates, bundle.roomCategories);
        });

        const roomOptions = Object.entries(bundle.roomCategories).map(([roomCategoryId, room]) => {
          const minAvailable = Math.min(
            ...inventoryDocs.map(day => {
              if (day.data.villaBooked) return 0;
              return Number(day.data.roomCategories?.[roomCategoryId]?.availableRooms || 0);
            })
          );

          const quote = quoteRooms(bundle.roomCategories, [{ roomCategoryId, quantity: 1 }], dates, inventoryDocs);

          return {
            roomCategoryId,
            ...publicRoom(room),
            availableRooms: minAvailable,
            totalAmount: quote.totalAmount,
            quote
          };
        }).filter(room => room.availableRooms > 0);

        const canSellVilla = bundle.property.sellAsFullVilla === true &&
          inventoryDocs.every(day => villaAvailable(day.data, bundle.roomCategories));
        const villaQuote = quoteVilla(bundle.property, bundle.roomCategories, dates, inventoryDocs);

        if (roomOptions.length || canSellVilla) {
          results.push({
            property: publicProperty(bundle.property),
            roomOptions,
            villaOption: canSellVilla ? {
              available: true,
              price: villaQuote.nightlyTotal,
              maxGuests: bundle.property.maxGuestsVilla || null,
              quote: villaQuote,
              totalAmount: villaQuote.totalAmount
            } : {
              available: false
            }
          });
        }
      }

      res.json({ results });
    } catch (err) {
      console.error("GET /api/availability/search", err);
      res.status(500).json({ error: "Failed to search availability" });
    }
  });

  router.get("/property/:propertyId", async (req, res) => {
    try {
      const { checkIn, checkOut } = req.query;
      const dates = stayDates(checkIn, checkOut);
      if (dates.length === 0) {
        return res.status(400).json({ error: "Valid checkIn and checkOut are required" });
      }

      const bundle = await getPropertyBundle(db, req.params.propertyId);
      if (!bundle) return res.status(404).json({ error: "Property not found" });

      const inventoryDocs = await db.runTransaction(async transaction => {
        return readInventoryForDates(transaction, bundle.propertyRef, dates, bundle.roomCategories);
      });

      const roomOptions = Object.entries(bundle.roomCategories).map(([roomCategoryId, room]) => {
        const minAvailable = Math.min(
          ...inventoryDocs.map(day => {
            if (day.data.villaBooked) return 0;
            return Number(day.data.roomCategories?.[roomCategoryId]?.availableRooms || 0);
          })
        );

        return {
          roomCategoryId,
          ...publicRoom(room),
          availableRooms: minAvailable
        };
      });

      const canSellVilla = bundle.property.sellAsFullVilla === true &&
        inventoryDocs.every(day => villaAvailable(day.data, bundle.roomCategories));

      const villaQuote = quoteVilla(bundle.property, bundle.roomCategories, dates, inventoryDocs);

      res.json({
        property: publicProperty(bundle.property),
        roomOptions,
        villaOption: {
          enabled: bundle.property.sellAsFullVilla === true,
          available: canSellVilla,
          price: villaQuote.nightlyTotal,
          totalAmount: villaQuote.totalAmount,
          quote: canSellVilla ? villaQuote : null
        }
      });
    } catch (err) {
      console.error("GET /api/availability/property/:propertyId", err);
      res.status(500).json({ error: "Failed to load property availability" });
    }
  });

  router.post("/quote", async (req, res) => {
    try {
      const { propertyId, bookingType, checkIn, checkOut, rooms = [] } = req.body;
      const dates = stayDates(checkIn, checkOut);
      if (!propertyId || !bookingType || dates.length === 0) {
        return res.status(400).json({ error: "Missing quote fields" });
      }

      const bundle = await getPropertyBundle(db, propertyId);
      if (!bundle) return res.status(404).json({ error: "Property not found" });

      const inventoryDocs = await db.runTransaction(async transaction => {
        return readInventoryForDates(transaction, bundle.propertyRef, dates, bundle.roomCategories);
      });

      const quote = bookingType === "fullVilla"
        ? quoteVilla(bundle.property, bundle.roomCategories, dates, inventoryDocs)
        : quoteRooms(bundle.roomCategories, rooms, dates, inventoryDocs);

      res.json({ quote });
    } catch (err) {
      console.error("POST /api/availability/quote", err);
      res.status(400).json({ error: err.message || "Failed to calculate quote" });
    }
  });

  return router;
};

function publicProperty(property) {
  return {
    id: property.id,
    name: property.name,
    destination: property.destination,
    address: property.address,
    description: property.description,
    locationText: property.locationText || "",
    neighbourhood: property.neighbourhood || "",
    mapUrl: property.mapUrl || "",
    houseRules: property.houseRules || "",
    photos: property.photos || [],
    amenities: property.amenities || [],
    facilities: property.facilities || [],
    infantMaxAge: Number(property.infantMaxAge || 2),
    sellAsFullVilla: property.sellAsFullVilla === true
  };
}

function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    description: room.description || "",
    basePrice: Number(room.basePrice || 0),
    totalRooms: Number(room.totalRooms || 0),
    maxGuests: Number(room.maxGuests || room.maxGuestsPerRoom || 2),
    includedGuests: Number(room.includedGuests || room.maxGuests || room.maxGuestsPerRoom || 2),
    extraAdultRate: Number(room.extraAdultRate || 0),
    extraKidRate: Number(room.extraKidRate || 0),
    photos: room.photos || [],
    amenities: room.amenities || [],
    viewType: room.viewType || "",
    bedType: room.bedType || "",
    sizeText: room.sizeText || ""
  };
}
