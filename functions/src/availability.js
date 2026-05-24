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

          const quote = quoteRooms(bundle.roomCategories, [{ roomCategoryId, quantity: 1 }], dates);

          return {
            roomCategoryId,
            name: room.name,
            availableRooms: minAvailable,
            basePrice: room.basePrice,
            totalAmount: quote.totalAmount,
            gstPercent: room.gstPercent || 0,
            maxGuestsPerRoom: room.maxGuestsPerRoom || 2
          };
        }).filter(room => room.availableRooms > 0);

        const canSellVilla = bundle.property.sellAsFullVilla === true &&
          inventoryDocs.every(day => villaAvailable(day.data, bundle.roomCategories));

        if (roomOptions.length || canSellVilla) {
          results.push({
            property: publicProperty(bundle.property),
            roomOptions,
            villaOption: canSellVilla ? {
              available: true,
              price: bundle.property.fullVillaPrice,
              maxGuests: bundle.property.maxGuestsVilla || null,
              quote: quoteVilla(bundle.property, dates),
              totalAmount: quoteVilla(bundle.property, dates).totalAmount
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
          ...room,
          availableRooms: minAvailable
        };
      });

      const canSellVilla = bundle.property.sellAsFullVilla === true &&
        inventoryDocs.every(day => villaAvailable(day.data, bundle.roomCategories));

      res.json({
        property: publicProperty(bundle.property),
        roomOptions,
        villaOption: {
          enabled: bundle.property.sellAsFullVilla === true,
          available: canSellVilla,
          price: bundle.property.fullVillaPrice || 0,
          quote: canSellVilla ? quoteVilla(bundle.property, dates) : null
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

      const quote = bookingType === "fullVilla"
        ? quoteVilla(bundle.property, dates)
        : quoteRooms(bundle.roomCategories, rooms, dates);

      res.json({ quote });
    } catch (err) {
      console.error("POST /api/availability/quote", err);
      res.status(500).json({ error: "Failed to calculate quote" });
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
    photos: property.photos || [],
    amenities: property.amenities || [],
    sellAsFullVilla: property.sellAsFullVilla === true
  };
}
