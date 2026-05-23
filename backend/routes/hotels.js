const express = require("express");
const upload = require("../middleware/upload");
const adminAuth = require("../middleware/adminAuthMiddleware");

module.exports = function (db) {
  const router = express.Router();

  // ===============================
  // CREATE HOTEL (ADMIN ONLY)
  // ===============================
  router.post(
    "/",
    adminAuth,
    upload.single("image"),
    (req, res) => {
      const {
        name,
        location,
        description,
        price_per_night,
        max_guests
      } = req.body;

      if (!name || !location) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const imageUrl = req.file ? req.file.path : null; // Cloudinary URL

      db.query(
        `
        INSERT INTO hotels
          (name, location, description, price_per_night, max_guests, image)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          name,
          location,
          description || null,
          price_per_night || null,
          max_guests || null,
          imageUrl
        ],
        (err, result) => {
          if (err) {
            console.error("Create hotel error:", err.message);
            return res.status(500).json({ error: "Failed to create hotel" });
          }

          res.json({
            success: true,
            hotelId: result.insertId,
            image: imageUrl
          });
        }
      );
    }
  );

  // ===============================
  // GET ALL HOTELS (PUBLIC)
  // ===============================
  router.get("/", (req, res) => {
    db.query(
      `
      SELECT
        id,
        name,
        location,
        description,
        price_per_night,
        max_guests,
        image
      FROM hotels
      ORDER BY id DESC
      `,
      (err, rows) => {
        if (err) {
          console.error("Fetch hotels error:", err.message);
          return res.status(500).json({ error: "Failed to fetch hotels" });
        }

        res.json(rows);
      }
    );
  });

  return router;
};
