process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION");
  console.error(err.stack || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("🔥 UNHANDLED PROMISE REJECTION");
  console.error(reason);
});

require("dotenv").config();


// =======================
//   IMPORTS & SETUP
// =======================
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const upload = require("./middleware/upload");

const path = require("path");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const adminAuthMiddleware = require("./middleware/adminAuthMiddleware");



// ✅ CREATE APP FIRST
const app = express();

// =======================
//   CORS (PRODUCTION SAFE)
// =======================

const allowedOrigins = [
  "https://www.wildleafstays.com",
  "https://wildleafstays.com"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// IMPORTANT — let cors handle preflight automatically
app.options("*", cors());



// =======================
//   MIDDLEWARES
// =======================
app.use(express.json());


// =======================
//   HEALTH CHECK (RAILWAY)
// =======================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// =======================
//   STATIC FILES (VPS SAFE)
// =======================



// admin panel
app.use("/admin", express.static(path.join(__dirname, "../admin")));

// guest frontend (ROOT)
app.use(express.static(path.join(__dirname, "../frontend")));


// =======================
//   DEFAULT ROUTE
// =======================
app.get("/", (req, res) => {
  res.status(200).send("Wildleaf backend running");
});




function bool(v) {
  if (v === true || v === "true" || v === 1 || v === "1") return 1;
  return 0;
}

const calendarSQL = `
WITH calendar_days AS (
  SELECT DATE_ADD(?, INTERVAL seq DAY) AS cal_date
  FROM seq_0_to_365
  WHERE DATE_ADD(?, INTERVAL seq DAY) < DATE_ADD(?, INTERVAL 31 DAY)
),

-- ==========================
-- NORMAL ROOM BOOKINGS
-- ==========================
room_bookings AS (
  SELECT
    cd.cal_date,
    r.id AS room_id,
    r.room_name,
    rc.category AS room_category,
    b.id AS booking_id,
    b.guest_name,
    b.status,
    b.hotel_payment_status
  FROM calendar_days cd
  CROSS JOIN rooms r
  JOIN room_categories rc ON rc.id = r.room_category_id
  LEFT JOIN (
    SELECT
      br.room_id,
      b.id,
      b.guest_name,
      b.status,
      b.hotel_payment_status,
      DATE_ADD(b.check_in, INTERVAL seq DAY) AS book_date
    FROM bookings b
    JOIN booking_rooms br ON br.booking_id = b.id
    JOIN seq_0_to_365 s
      ON DATE_ADD(b.check_in, INTERVAL s.seq DAY) < b.check_out
    WHERE b.status IN ('pending','confirmed','checked_in')
  ) b
    ON b.room_id = r.id
   AND b.book_date = cd.cal_date
  WHERE r.hotel_id = ?
  AND r.is_active = 1
  AND NOT EXISTS (
    SELECT 1
    FROM bookings vb
    WHERE vb.hotel_id = r.hotel_id
      AND vb.notes = 'FULL_VILLA'
      AND vb.status IN ('pending','confirmed','checked_in')
      AND cd.cal_date BETWEEN vb.check_in
                          AND DATE_SUB(vb.check_out, INTERVAL 1 DAY)
  )

),

-- ==========================
-- FULL VILLA BOOKINGS
-- ==========================
villa_bookings AS (
  SELECT
    cd.cal_date,
    r.id AS room_id,
    r.room_name,
    rc.category AS room_category,
    b.id AS booking_id,
    b.guest_name,
    b.status,
    b.hotel_payment_status
  FROM bookings b
  JOIN calendar_days cd
    ON cd.cal_date BETWEEN b.check_in AND DATE_SUB(b.check_out, INTERVAL 1 DAY)
  JOIN rooms r
    ON r.hotel_id = b.hotel_id
  JOIN room_categories rc
    ON rc.id = r.room_category_id
  WHERE b.notes = 'FULL_VILLA'
    AND b.status IN ('pending','confirmed','checked_in')
    AND b.hotel_id = ?
    AND r.is_active = 1
)

SELECT * FROM room_bookings
UNION ALL
SELECT * FROM villa_bookings
ORDER BY room_name, cal_date;
`;


// =======================
//   Helpers
// =======================

function generateBookingRef() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `WL-${year}-${rand}`;
}




// =======================
//   MYSQL CONNECTION (RAILWAY SAFE)
// =======================

const MYSQL_HOST =
  process.env.MYSQL_HOST || process.env.MYSQLHOST;

const MYSQL_PORT =
  process.env.MYSQL_PORT || process.env.MYSQLPORT || 3306;

const MYSQL_USER =
  process.env.MYSQL_USER || process.env.MYSQLUSER;

const MYSQL_PASSWORD =
  process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD;

const MYSQL_DATABASE =
  process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE;

console.log("🔍 MYSQL ENV CHECK", {
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_DATABASE
});

const db = mysql.createPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});


// Test connection ONCE
db.getConnection((err, conn) => {
  if (err) {
    console.error("❌ DB connection failed:", err.message);
  } else {
    console.log("✅ MySQL connected successfully");
    conn.release();
  }
});



const adminAuth = require("./routes/adminAuth");
app.use("/api/admin", adminAuth(db));


async function findFreeRoomForDates(conn, hotelId, roomCategoryId, checkIn, checkOut) {
  const [[room]] = await conn.query(
    `
    SELECT r.id
    FROM rooms r
    WHERE r.hotel_id = ?
      AND r.room_category_id = ?
      AND r.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM booking_rooms br
        JOIN bookings b ON b.id = br.booking_id
        WHERE br.room_id = r.id
          AND b.status IN ('pending','confirmed','checked_in')
          AND b.check_in < ?
          AND b.check_out > ?
      )
    LIMIT 1
    `,
    [hotelId, roomCategoryId, checkOut, checkIn]
  );

  return room ? room.id : null;
}





// ====================================================
//                Razorpay Initialize
// ====================================================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});



// ====================================================
//                BRANDING
// ====================================================

// Upload Logo
app.post("/api/branding/logo", upload.single("logo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No logo uploaded" });

  const logoUrl = req.file.path;

  db.query(
    "UPDATE branding SET logo_url=? WHERE id=1",
    [logoUrl],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true, logo_url: logoUrl });
    }
  );
});

// Update Site Title
app.post("/api/branding/title", (req, res) => {
  const { site_title } = req.body;

  db.query(
    "UPDATE branding SET site_title=? WHERE id=1",
    [site_title],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});

// Get Branding (title + logo)
app.get("/api/branding", (req, res) => {
  db.query(
    "SELECT site_title, logo_url FROM branding WHERE id=1",
    (err, rows) => {
      if (err) return res.status(500).json({ error: err });

      const row = rows[0] || {};

      if (row.logo_url && row.logo_url.startsWith("/")) {
        row.logo_url = `${process.env.PUBLIC_BASE_URL}${row.logo_url}`;
      }

      res.json(row);
    }
  );
});


// ====================================================
//            HOMEPAGE SECTIONS CONFIG (UPDATED)
// ====================================================

// Fetch all homepage sections
app.get("/api/homepage/sections", (req, res) => {
  db.query(
    `SELECT 
        id, 
        title, 
        filter_type, 
        card_style,
        show_price,
        show_occupancy,
        show_amenities
     FROM homepage_sections
     ORDER BY id ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err });
      res.json(rows);
    }
  );
});

// Add a new homepage section
app.post("/api/homepage/sections", (req, res) => {
  const {
    title,
    filter_type,
    card_style,
    show_price,
    show_occupancy,
    show_amenities
  } = req.body;

  const sql = `
    INSERT INTO homepage_sections
    (title, filter_type, card_style, show_price, show_occupancy, show_amenities)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      title,
      filter_type,
      card_style,
      show_price ? 1 : 0,
      show_occupancy ? 1 : 0,
      show_amenities ? 1 : 0
    ],
    (err, result) => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true, id: result.insertId });
    }
  );
});

//==========================
// Delete homepage section
//==========================

app.delete("/api/homepage/sections/:id", (req, res) => {
  db.query(
    "DELETE FROM homepage_sections WHERE id=?",
    [req.params.id],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});




// ====================================================
//                HOMEPAGE COLLAGE
// ====================================================

// Upload Collage Image
app.post("/api/collage/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const imageUrl = req.file.path; // ✅ Cloudinary URL from middleware

    db.query(
      "INSERT INTO collage_images (image_url) VALUES (?)",
      [imageUrl],
      err => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, image_url: imageUrl });
      }
    );

  } catch (err) {
    console.error("Collage upload failed:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});
// Get All Collage Images
app.get("/api/collage", (req, res) => {
  db.query("SELECT * FROM collage_images ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    res.json(rows);
  });
});

// Delete Collage Image
app.delete("/api/collage/:id", (req, res) => {
  db.query("DELETE FROM collage_images WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: err });
    res.json({ success: true });
  });
});




// =====================================================
// CREATE HOTEL (FIXED & ALIGNED WITH UPDATE)
// =====================================================
app.post("/api/hotels", (req, res) => {
  const data = req.body;

  const fields = {
    full_villa: bool(data.full_villa),
    rule_smoking: bool(data.rule_smoking),
    rule_pets: bool(data.rule_pets),
    rule_parties: bool(data.rule_parties),

    kitchen_available: bool(data.kitchen_available),
    restaurant_available: bool(data.restaurant_available),
    room_service: bool(data.room_service),

    parking_available: bool(data.parking_available),
    power_backup: bool(data.power_backup),

    inhouse_chef: bool(data.inhouse_chef),
    cafe_available: bool(data.cafe_available),
    outdoor_dining: bool(data.outdoor_dining),
    bbq_available: bool(data.bbq_available),

    cctv: bool(data.cctv),
    fire_extinguishers: bool(data.fire_extinguishers),
    first_aid: bool(data.first_aid),
    security_guard: bool(data.security_guard),
    emergency_exit: bool(data.emergency_exit),

    covered_parking: bool(data.covered_parking),
    valet_service: bool(data.valet_service),
    ev_charging: bool(data.ev_charging),
    taxi_on_call: bool(data.taxi_on_call),

    hot_water: bool(data.hot_water),
    solar_water_heating: bool(data.solar_water_heating),
    heating_available: bool(data.heating_available),

    lawn_garden: bool(data.lawn_garden),
    terrace: bool(data.terrace),
    private_villa_mode: bool(data.private_villa_mode),

    mountain_view: bool(data.mountain_view),
    valley_view: bool(data.valley_view),
    forest_view: bool(data.forest_view),
    outdoor_seating: bool(data.outdoor_seating),
    bonfire_area: bool(data.bonfire_area),
    swimming_pool: bool(data.swimming_pool),
    kids_play_area: bool(data.kids_play_area),

    loud_music_allowed: bool(data.loud_music_allowed),
    wheelchair_room: bool(data.wheelchair_room),
    wheelchair_entrance: bool(data.wheelchair_entrance),
    elevator: bool(data.elevator),
  };

  const attractions = Array.isArray(data.nearby_attractions)
    ? JSON.stringify(data.nearby_attractions)
    : null;

  const sql = `
  INSERT INTO hotels SET
    name=?,
    address=?,
    city=?,
    description=?,
    architecture=?,
    full_villa=?,
    villa_tagline=?,
    tagline=?,
    check_in_time=?,
    check_out_time=?,
    max_guests=?,
    bathrooms=?,
    rule_smoking=?,
    rule_pets=?,
    rule_parties=?,
    kitchen_available=?,
    restaurant_available=?,
    room_service=?,
    breakfast_included=?,
    nearby_attractions=?,
    parking_available=?,
    power_backup=?,
    inhouse_chef=?,
    cafe_available=?,
    outdoor_dining=?,
    bbq_available=?,
    cctv=?,
    fire_extinguishers=?,
    first_aid=?,
    security_guard=?,
    emergency_exit=?,
    covered_parking=?,
    valet_service=?,
    ev_charging=?,
    taxi_on_call=?,
    hot_water=?,
    solar_water_heating=?,
    water_purifier=?,
    heating_available=?,
    lawn_garden=?,
    terrace=?,
    private_villa_mode=?,
    mountain_view=?,
    valley_view=?,
    forest_view=?,
    outdoor_seating=?,
    bonfire_area=?,
    swimming_pool=?,
    kids_play_area=?,
    loud_music_allowed=?,
    wheelchair_room=?,
    wheelchair_entrance=?,
    elevator=?
`;


  const values = [
    data.name, data.address, data.city, data.description,

    data.architecture, fields.full_villa, data.villa_tagline, data.tagline,
    data.check_in_time, data.check_out_time, data.max_guests, data.bathrooms,

    fields.rule_smoking, fields.rule_pets, fields.rule_parties,

    fields.kitchen_available, fields.restaurant_available, fields.room_service,
    data.breakfast_included,

    attractions, fields.parking_available, fields.power_backup,

    fields.inhouse_chef, fields.cafe_available, fields.outdoor_dining, fields.bbq_available,

    fields.cctv, fields.fire_extinguishers, fields.first_aid, fields.security_guard, fields.emergency_exit,

    fields.covered_parking, fields.valet_service, fields.ev_charging, fields.taxi_on_call,

    fields.hot_water, fields.solar_water_heating, data.water_purifier, fields.heating_available,

    fields.lawn_garden, fields.terrace, fields.private_villa_mode,
    fields.mountain_view, fields.valley_view, fields.forest_view,
    fields.outdoor_seating, fields.bonfire_area, fields.swimming_pool, fields.kids_play_area,

    fields.loud_music_allowed, fields.wheelchair_room, fields.wheelchair_entrance, fields.elevator
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("CREATE HOTEL ERROR:", err);
      return res.status(500).json({ error: err.message });
    }


    res.json({ success: true, id: result.insertId });
  });
});

// =====================================================
// UPDATE HOTEL
// =====================================================
app.put("/api/hotels/:id", (req, res) => {
  const id = req.params.id;
  const data = req.body;

  const fields = {
    full_villa: bool(data.full_villa),
    rule_smoking: bool(data.rule_smoking),
    rule_pets: bool(data.rule_pets),
    rule_parties: bool(data.rule_parties),

    kitchen_available: bool(data.kitchen_available),
    restaurant_available: bool(data.restaurant_available),
    room_service: bool(data.room_service),

    parking_available: bool(data.parking_available),
    power_backup: bool(data.power_backup),

    inhouse_chef: bool(data.inhouse_chef),
    cafe_available: bool(data.cafe_available),
    outdoor_dining: bool(data.outdoor_dining),
    bbq_available: bool(data.bbq_available),

    cctv: bool(data.cctv),
    fire_extinguishers: bool(data.fire_extinguishers),
    first_aid: bool(data.first_aid),
    security_guard: bool(data.security_guard),
    emergency_exit: bool(data.emergency_exit),

    covered_parking: bool(data.covered_parking),
    valet_service: bool(data.valet_service),
    ev_charging: bool(data.ev_charging),
    taxi_on_call: bool(data.taxi_on_call),

    hot_water: bool(data.hot_water),
    solar_water_heating: bool(data.solar_water_heating),
    heating_available: bool(data.heating_available),

    lawn_garden: bool(data.lawn_garden),
    terrace: bool(data.terrace),
    private_villa_mode: bool(data.private_villa_mode),

    mountain_view: bool(data.mountain_view),
    valley_view: bool(data.valley_view),
    forest_view: bool(data.forest_view),
    outdoor_seating: bool(data.outdoor_seating),
    bonfire_area: bool(data.bonfire_area),
    swimming_pool: bool(data.swimming_pool),
    kids_play_area: bool(data.kids_play_area),

    loud_music_allowed: bool(data.loud_music_allowed),
    wheelchair_room: bool(data.wheelchair_room),
    wheelchair_entrance: bool(data.wheelchair_entrance),
    elevator: bool(data.elevator),
  };

  let attractions = null;
  if (Array.isArray(data.nearby_attractions)) {
    attractions = JSON.stringify(data.nearby_attractions);
  }

  const sql = `
    UPDATE hotels SET
      name=?, address=?, city=?, description=?,
      
      architecture=?, full_villa=?, villa_tagline=?, tagline=?,
      check_in_time=?, check_out_time=?, max_guests=?, bathrooms=?,

      rule_smoking=?, rule_pets=?, rule_parties=?,

      kitchen_available=?, restaurant_available=?, room_service=?,
      breakfast_included=?,

      nearby_attractions=?, parking_available=?, power_backup=?,

      inhouse_chef=?, cafe_available=?, outdoor_dining=?, bbq_available=?,

      cctv=?, fire_extinguishers=?, first_aid=?, security_guard=?, emergency_exit=?,

      covered_parking=?, valet_service=?, ev_charging=?, taxi_on_call=?,

      hot_water=?, solar_water_heating=?, water_purifier=?, heating_available=?,

      lawn_garden=?, terrace=?, private_villa_mode=?,
      mountain_view=?, valley_view=?, forest_view=?,
      outdoor_seating=?, bonfire_area=?, swimming_pool=?, kids_play_area=?,

      loud_music_allowed=?, wheelchair_room=?, wheelchair_entrance=?, elevator=?
    WHERE id=?
  `;

  db.query(
    sql,
    [
      data.name, data.address, data.city, data.description,
     
      data.architecture, fields.full_villa, data.villa_tagline, data.tagline,
      data.check_in_time, data.check_out_time, data.max_guests, data.bathrooms,

      fields.rule_smoking, fields.rule_pets, fields.rule_parties,

      fields.kitchen_available, fields.restaurant_available, fields.room_service,
      data.breakfast_included,

      attractions, fields.parking_available, fields.power_backup,

      fields.inhouse_chef, fields.cafe_available, fields.outdoor_dining, fields.bbq_available,

      fields.cctv, fields.fire_extinguishers, fields.first_aid, fields.security_guard, fields.emergency_exit,

      fields.covered_parking, fields.valet_service, fields.ev_charging, fields.taxi_on_call,

      fields.hot_water, fields.solar_water_heating, data.water_purifier, fields.heating_available,

      fields.lawn_garden, fields.terrace, fields.private_villa_mode,
      fields.mountain_view, fields.valley_view, fields.forest_view,
      fields.outdoor_seating, fields.bonfire_area, fields.swimming_pool, fields.kids_play_area,

      fields.loud_music_allowed, fields.wheelchair_room, fields.wheelchair_entrance, fields.elevator,

      id
    ],
    (err) => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});


//====================================================================
// =====================Upload Hotel Image============================
//===================================================================

app.post("/api/hotels/:id/images", upload.single("image"), (req, res) => {
  const imageUrl = req.file.path; // ✅ Cloudinary URL

  db.query(
    "INSERT INTO hotel_images (hotel_id, image_url) VALUES (?, ?)",
    [req.params.id, imageUrl],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true, imageUrl });
    }
  );
});

//===================
// Delete Hotel Image
//===================
app.delete("/api/hotels/images/:imageId", (req, res) => {
  db.query("DELETE FROM hotel_images WHERE id=?", [req.params.imageId], err => {
    if (err) return res.status(500).json({ error: err });
    res.json({ success: true });
  });
});


//=========================
// Delete Hotel WITH CASCADE
//==========================


app.delete("/api/hotels/:id", (req, res) => {
  const hotelId = req.params.id;

  // Delete hotel images
  db.query("DELETE FROM hotel_images WHERE hotel_id=?", [hotelId], err => {
    if (err) return res.status(500).json({ error: err });

    // Get room IDs
    db.query("SELECT id FROM room_categories WHERE hotel_id=?", [hotelId], (err, rooms) => {
      if (err) return res.status(500).json({ error: err });

      const roomIds = rooms.map(r => r.id);

      if (roomIds.length > 0) {
        db.query("DELETE FROM room_images WHERE room_id IN (?)", [roomIds], err => {
          if (err) return res.status(500).json({ error: err });

          db.query("DELETE FROM room_categories WHERE hotel_id=?", [hotelId], err => {
            if (err) return res.status(500).json({ error: err });

            db.query("DELETE FROM room_inventory WHERE hotel_id=?", [hotelId], err => {
              if (err) return res.status(500).json({ error: err });

              db.query("DELETE FROM hotels WHERE id=?", [hotelId], err => {
                if (err) return res.status(500).json({ error: err });
                res.json({ success: true });
              });
            });
          });
        });
      } else {
        db.query("DELETE FROM hotels WHERE id=?", [hotelId], err => {
          if (err) return res.status(500).json({ error: err });
          res.json({ success: true });
        });
      }
    });
  });
});

// =======================================
// GET SINGLE HOTEL BY ID (REQUIRED BY ADMIN)
// =======================================

app.get("/api/hotels/:id", (req, res) => {
  const hotelId = req.params.id;

  db.query("SELECT * FROM hotels WHERE id=?", [hotelId], (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    if (!rows.length) return res.status(404).json({ error: "Hotel not found" });

    const hotel = rows[0];

    // Load hotel gallery images
    db.query("SELECT * FROM hotel_images WHERE hotel_id=?", [hotelId], (err, imgs) => {
      hotel.images = (imgs || []).map(img => ({
  ...img,
  image_url: img.image_url.startsWith("http")
    ? img.image_url
    : `${process.env.PUBLIC_BASE_URL}${img.image_url}`
}));

      // Load room categories with MAIN IMAGE
      const roomSql = `
        SELECT rc.*,
          (SELECT image_url 
           FROM room_images 
           WHERE room_id = rc.id AND is_main = 1 
           LIMIT 1) AS main_image
        FROM room_categories rc
        WHERE rc.hotel_id = ?`;

      db.query(roomSql, [hotelId], (err, rooms) => {
        hotel.rooms = (rooms || []).map(r => ({
  ...r,
  main_image: r.main_image
    ? (r.main_image.startsWith("http")
        ? r.main_image
        : `${process.env.PUBLIC_BASE_URL}${r.main_image}`)
    : null
}));

        res.json(hotel);
      });
    });
  });
});



// =======================================
// GET PHYSICAL ROOMS FOR A CATEGORY (ADMIN DISPLAY)
// =======================================
app.get("/api/rooms/by-category/:categoryId", (req, res) => {
  const categoryId = req.params.categoryId;

  db.query(
    `
    SELECT room_name
    FROM rooms
    WHERE room_category_id = ?
      AND is_active = 1
    ORDER BY room_name
    `,
    [categoryId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // return only names as array
      res.json(rows.map(r => r.room_name));
    }
  );
});

// ====================================================
// ADD ROOM CATEGORY + AUTO CREATE ROOMS (SAFE)
// ====================================================
app.post("/api/hotels/:hotelId/rooms", async (req, res) => {

console.log(
  "[ROOM-CREATE] HIT",
  "hotelId =", req.params.hotelId
);

  const conn = await db.promise().getConnection();

  const {
    category,
    description = null,
    price = Number(req.body.price) || 0,
    gst = Number(req.body.gst) || 0,
    max_rooms,
    max_guests = 0,
    base_included_adults = 0,
    kid_chargeable_age = 0,
    extra_adult_price = 0,
    extra_kid_price = 0,
    beds = 0,
    bathrooms = 0,
    room_size = null,
    bed_size = null,
    view_type = null,
    roomNames = []
  } = req.body;


console.log("[ROOM-CREATE] BODY:", {
  category,
  max_rooms,
  price,
  gst,
  roomNamesType: Array.isArray(req.body.roomNames)
    ? "array"
    : typeof req.body.roomNames
});


  // 🛑 HARD VALIDATION
  const maxRooms = Number(max_rooms);
  if (!category || !Number.isInteger(maxRooms) || maxRooms <= 0) {
    return res.status(400).json({ error: "Invalid category or max_rooms" });
  }

  try {
    await conn.beginTransaction();

    // 1️⃣ Create room category (FULL SCHEMA)
    const [result] = await conn.query(
      `
      INSERT INTO room_categories
      (
        hotel_id,
        category,
        description,
        price,
        gst,
        max_rooms,
        max_guests,
        base_included_adults,
        kid_chargeable_age,
        extra_adult_price,
        extra_kid_price,
        beds,
        bathrooms,
        room_size,
        bed_size,
        view_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.params.hotelId,
        category,
        description,
        price,
        gst,
        maxRooms,
        max_guests,
        base_included_adults,
        kid_chargeable_age,
        extra_adult_price,
        extra_kid_price,
        beds,
        bathrooms,
        room_size,
        bed_size,
        view_type
      ]
    );

    const roomCategoryId = result.insertId;

    // 2️⃣ Generate room names (SAFE)
    const finalRoomNames =
      Array.isArray(roomNames) && roomNames.length > 0
        ? roomNames
        : [...Array(maxRooms)].map((_, i) =>
            `${category.substring(0, 1).toUpperCase()}-${i + 1}`
          );

    // 3️⃣ Create physical rooms
    const values = finalRoomNames.map(name => [
      req.params.hotelId,
      roomCategoryId,
      name,
      1
    ]);

    await conn.query(
      `
      INSERT INTO rooms
      (hotel_id, room_category_id, room_name, is_active)
      VALUES ?
      `,
      [values]
    );

    await conn.commit();

    res.json({
      success: true,
      roomCategoryId,
      roomsCreated: finalRoomNames.length
    });

  } catch (err) {
    await conn.rollback();
    console.error("ROOM CATEGORY CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create room category" });
  }finally {
    conn.release(); // ✅ REQUIRED
  }
});




// ====================================================
// UPDATE ROOM CATEGORY (WITH PHYSICAL ROOM SYNC)
// ====================================================
app.put("/api/rooms/:id", async (req, res) => {
  const id = req.params.id;
  const data = req.body;

  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `
      UPDATE room_categories SET
        category=?,
        description=?,
        price=?,
        gst=?,
        max_rooms=?,
        max_guests=?,
        base_included_adults=?,
        kid_chargeable_age=?,
        extra_adult_price=?,
        extra_kid_price=?,
        beds=?,
        bathrooms=?,
        room_size=?,
        bed_size=?,
        view_type=?
      WHERE id=?
      `,
      [
        data.category,
        data.description,
        data.price,
        data.gst,
        data.max_rooms,
        data.max_guests,
        data.base_included_adults,
        data.kid_chargeable_age,
        data.extra_adult_price,
        data.extra_kid_price,
        data.beds,
        data.bathrooms,
        data.room_size,
        data.bed_size,
        data.view_type,
        id
      ]
    );

    // --------------------------------------------------
    // 2️⃣ PHYSICAL ROOMS SYNC (ADD + REMOVE)
    // --------------------------------------------------

    const roomNames = Array.isArray(data.roomNames)
      ? data.roomNames.map(r => r.trim()).filter(Boolean)
      : [];

    // Fetch category meta
    const [[cat]] = await conn.query(
      `SELECT hotel_id, max_rooms FROM room_categories WHERE id = ?`,
      [id]
    );

    if (!cat) {
      await conn.rollback();
      return res.status(404).json({ error: "Room category not found" });
    }

    const hotelId = cat.hotel_id;
    const maxRooms = Number(cat.max_rooms || 0);

    // Enforce max_rooms
    if (roomNames.length > maxRooms) {
      await conn.rollback();
      return res.status(400).json({
        error: `Maximum ${maxRooms} physical rooms allowed`
      });
    }

    // Fetch existing active physical rooms
    const [existingRooms] = await conn.query(
      `
      SELECT id, room_name
      FROM rooms
      WHERE room_category_id = ?
        AND is_active = 1
      `,
      [id]
    );

    const existingNames = existingRooms.map(r => r.room_name);

    // ➕ Rooms to add
    const toAdd = roomNames.filter(n => !existingNames.includes(n));

    // ➖ Rooms to deactivate
    const toRemove = existingRooms.filter(
      r => !roomNames.includes(r.room_name)
    );

    // Add new rooms
    if (toAdd.length > 0) {
      const values = toAdd.map(name => [
        hotelId,
        id,
        name,
        1
      ]);

      await conn.query(
        `
        INSERT INTO rooms
          (hotel_id, room_category_id, room_name, is_active)
        VALUES ?
        `,
        [values]
      );
    }

    // Soft delete removed rooms
    if (toRemove.length > 0) {
      const ids = toRemove.map(r => r.id);

      await conn.query(
        `
        UPDATE rooms
        SET is_active = 0
        WHERE id IN (?)
        `,
        [ids]
      );
    }

     await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("UPDATE ROOM CATEGORY ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});


// ====================================================
// CREATE PHYSICAL ROOMS (BULK) – REQUIRED FOR CALENDAR
// ====================================================
app.post("/api/rooms/create-bulk", async (req, res) => {
  const { hotelId, roomCategoryId, rooms } = req.body;

  if (!hotelId || !roomCategoryId || !Array.isArray(rooms)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (rooms.length === 0) return res.json({ success: true });

  const conn = await db.promise().getConnection();
  try {
    const values = rooms.map(name => [hotelId, roomCategoryId, name, 1]);

    await conn.query(
      `
      INSERT INTO rooms
        (hotel_id, room_category_id, room_name, is_active)
      VALUES ?
      `,
      [values]
    );

    res.json({ success: true, created: rooms.length });
  } catch (err) {
    console.error("ROOM BULK CREATE ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ====================================================
// Delete Rooms
// ====================================================

app.delete("/api/rooms/:id", async (req, res) => {
  const categoryId = req.params.id;
  const conn = await db.promise().getConnection();

  try {
    await conn.beginTransaction();

    await conn.query("DELETE FROM rooms WHERE room_category_id = ?", [categoryId]);
    await conn.query("DELETE FROM room_images WHERE room_id NOT IN (SELECT id FROM rooms)");
    await conn.query("DELETE FROM room_categories WHERE id = ?", [categoryId]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("DELETE ROOM CATEGORY ERROR:", err);
    res.status(500).json({ error: "Failed to delete room category" });
  } finally {
    conn.release();
  }
});

// ====================================================
// Rooms available
// ====================================================
app.get("/api/rooms/available", async (req, res) => {
  const { hotelId, checkIn, checkOut, excludeBookingId } = req.query;

  if (!hotelId || !checkIn || !checkOut) {
    return res.json([]);
  }

  try {
    const [rows] = await db.promise().query(
      `
      SELECT
        r.id AS room_id,
        r.room_name,
        r.room_category_id,
        rc.category AS category
      FROM rooms r
      JOIN room_categories rc ON rc.id = r.room_category_id
      WHERE r.hotel_id = ?
        AND r.is_active = 1
        AND NOT EXISTS (
          SELECT 1
          FROM booking_rooms br
          JOIN bookings b ON b.id = br.booking_id
          WHERE br.room_id = r.id
            AND b.status IN ('pending','confirmed','checked_in')
            AND b.check_in < ?
            AND b.check_out > ?
            AND ( ? IS NULL OR br.booking_id != ? )
        )
      ORDER BY rc.category, r.room_name
      `,
      [
        hotelId,
        checkOut,
        checkIn,
        excludeBookingId || null,
        excludeBookingId || null
      ]
    );

    res.json(rows);
  } catch (err) {
    console.error("Available rooms error:", err);
    res.status(500).json([]);
  }
});



// ====================================================
//                ROOM IMAGES
// ====================================================

// Helper: mark main image
function setMainImage(roomId, imageUrl, callback) {
  db.query("UPDATE room_images SET is_main=0 WHERE room_id=?", [roomId], err => {
    if (err) return callback(err);

    db.query(
      "UPDATE room_images SET is_main=1 WHERE room_id=? AND image_url=?",
      [roomId, imageUrl],
      callback
    );
  });
}


// Upload Room Image (Cloudinary, auto-set main if none exists)

app.post(
  "/api/rooms/:roomId/images",
  upload.single("image"),
  async (req, res) => {
    try {
      const roomId = req.params.roomId;

      if (!req.file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      const imageUrl = req.file.path; // Cloudinary URL

      db.query(
        "INSERT INTO room_images (room_id, image_url) VALUES (?, ?)",
        [roomId, imageUrl],
        err => {
          if (err) return res.status(500).json({ error: err });

          db.query(
            "SELECT id FROM room_images WHERE room_id=? AND is_main=1 LIMIT 1",
            [roomId],
            (err2, rows) => {
              if (err2) return res.status(500).json({ error: err2 });

              if (rows.length === 0) {
                setMainImage(roomId, imageUrl, err3 => {
                  if (err3) return res.status(500).json({ error: err3 });
                  res.json({ success: true, imageUrl, is_main: 1 });
                });
              } else {
                res.json({ success: true, imageUrl, is_main: 0 });
              }
            }
          );
        }
      );
    } catch (err) {
      console.error("Room image upload failed:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

//================
// Get room images
//================

app.get("/api/rooms/:roomId/images", (req, res) => {
  db.query(
    "SELECT * FROM room_images WHERE room_id=?",
    [req.params.roomId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err });
      res.json(rows);
    }
  );
});

// Delete room image
app.delete("/api/rooms/images/:imageId", (req, res) => {
  db.query("DELETE FROM room_images WHERE id=?", [req.params.imageId], err => {
    if (err) return res.status(500).json({ error: err });
    res.json({ success: true });
  });
});

// Manually set main image
app.post("/api/rooms/set-main-image", (req, res) => {
  const { roomId, imageUrl } = req.body;

  if (!roomId || !imageUrl) {
    return res.status(400).json({ error: "roomId and imageUrl required" });
  }

  setMainImage(roomId, imageUrl, err => {
    if (err) return res.status(500).json({ error: err });
    res.json({ success: true });
  });
});


// =================================================================
//     INVENTORY FETCH (CORRECT & SAFE)
// =================================================================
app.get("/api/inventory", async (req, res) => {
  const { hotelId, start, end } = req.query;
  const conn = db.promise();

  try {
    


    // --------------------------------------------------
    //  FETCH INVENTORY + RATE + VILLA LOCK
    // --------------------------------------------------
    const [results] = await conn.query(
  `
  SELECT 
    rc.id AS room_category_id,
    rc.category AS category,
    rc.max_rooms,
    rc.price AS base_price,
rc.gst,
    DATE_FORMAT(d.date, '%Y-%m-%d') AS date,
    ri.available_rooms,
    ri.rate,
    IF(vi.is_booked = 1, 1, 0) AS villa_booked
  FROM room_categories rc
  CROSS JOIN (
    SELECT DATE(
      STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
    ) AS date
    FROM seq_0_to_365
    WHERE DATE(
      STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
    ) < STR_TO_DATE(?, '%Y-%m-%d')
  ) d
  LEFT JOIN room_inventory ri
    ON rc.id = ri.room_category_id
   AND rc.hotel_id = ri.hotel_id
   AND d.date = ri.date
  LEFT JOIN villa_inventory vi
    ON vi.hotel_id = rc.hotel_id
   AND vi.date = d.date
  WHERE rc.hotel_id = ?
  ORDER BY rc.id, d.date
  `,
  [start, start, end, hotelId]
);

// ------------------------------
// 🏡 VILLA PRICE FROM INVENTORY
// ------------------------------
let villa_base_price = 0;
let gst_percent = 0;

const categoryMap = {};

results.forEach(r => {
  if (r.date !== start) return;

  if (!categoryMap[r.room_category_id]) {
    categoryMap[r.room_category_id] = {
      rooms: r.max_rooms,
      rate: 0,
      gst: r.gst || 0
    };
  }

  categoryMap[r.room_category_id].rate =
    r.rate !== null && r.rate !== undefined
      ? Number(r.rate)
      : Number(r.base_price);
});


Object.values(categoryMap).forEach(cat => {
  villa_base_price += cat.rate * cat.rooms;
  if (!gst_percent && cat.gst) gst_percent = Number(cat.gst);
});


villa_base_price = Math.round(villa_base_price);




// ==================================================
// 🏡 VILLA AVAILABILITY CHECK (SINGLE SOURCE OF TRUTH)
// ==================================================

// 1️⃣ Check if villa is manually booked
const [[villaBlocked]] = await conn.query(
  `
  SELECT 1
  FROM villa_inventory
  WHERE hotel_id = ?
    AND date >= ?
AND date < ?
    AND is_booked = 1
  LIMIT 1
  `,
  [hotelId, start, end]
);

// 2️⃣ Check if ANY room is partially unavailable
const [[roomBlocked]] = await conn.query(
  `
  SELECT 1
  FROM room_inventory ri
  JOIN room_categories rc ON rc.id = ri.room_category_id
  WHERE ri.hotel_id = ?
    AND ri.date >= ?
    AND ri.date < ?
    AND ri.available_rooms < rc.max_rooms
  LIMIT 1
  `,
  [hotelId, start, end]
);


// 3️⃣ Final villa availability decision
const villa_available = !villaBlocked && !roomBlocked;

 // --------------------------------------------------
    // FINAL RESPONSE
    // --------------------------------------------------
    res.json({
  inventory: results,
  villa_available,

  // ✅ FINAL villa price (fallback-safe)
  villa_price: villa_base_price,

  // ✅ GST always from category
  gst_percent
});


  } catch (err) {
    console.error("INVENTORY FETCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// ====================================================
// BOOKINGS + INVENTORY (HOTEL + VILLA)
// ====================================================
app.post("/api/bookings/inventory", async (req, res) => {

  const {
    hotelId,
    checkIn,
    checkOut,
    adults,
    kids,
    rooms = [],
    guest_name,
    guest_phone,
    guest_email
  } = req.body;

  // ✅ Villa booking ONLY if explicitly requested
const isVillaBooking = req.body.isFullVilla === true;

  const conn = db.promise();

  try {
    await conn.beginTransaction();

    // Generate booking dates (checkout excluded)
    const [dates] = await conn.query(
      `
      SELECT DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) AS d
      FROM seq_0_to_365
      WHERE DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) < STR_TO_DATE(?, '%Y-%m-%d')
      `,
      [checkIn, checkIn, checkOut]
    );

    // ===============================
    // 🏡 FULL VILLA BOOKING
    // ===============================
    if (isVillaBooking) {

      await conn.query(
        `
        INSERT INTO bookings
        (
          hotel_id,
          room_category_id,
          check_in,
          check_out,
          rooms_booked,
          adults,
          kids,
          guest_name,
          guest_phone,
          guest_email,
          status,
          source
        )
        VALUES (?, NULL, ?, ?, 0, ?, ?, ?, ?, ?, 'confirmed', 'website')
        `,
        [
          hotelId,
          checkIn,
          checkOut,
          adults,
          kids,
          guest_name,
          guest_phone,
          guest_email
        ]
      );

      for (const { d } of dates) {

        // Lock villa
        await conn.query(
          `
          INSERT INTO villa_inventory (hotel_id, date, is_booked)
          VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE is_booked = 1
          `,
          [hotelId, d]
        );

        // Lock all rooms
        await conn.query(
          `
          INSERT INTO room_inventory (hotel_id, room_category_id, date, available_rooms)
          SELECT ?, rc.id, ?, 0
          FROM room_categories rc
          WHERE rc.hotel_id = ?
          ON DUPLICATE KEY UPDATE available_rooms = 0
          `,
          [hotelId, d, hotelId]
        );
      }
    }

    // ===============================
    // 🏨 HOTEL ROOM BOOKING
    // ===============================
    else {

 // 1️⃣ CREATE ONE BOOKING (MULTI-CATEGORY HEADER)
const [bookingResult] = await conn.query(
  `
  INSERT INTO bookings
  (
    hotel_id,
    room_category_id,
    check_in,
    check_out,
    rooms_booked,
    adults,
    kids,
    guest_name,
    guest_phone,
    guest_email,
    notes,
    status,
    source
  )
  VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 'confirmed', 'website')
  `,
  [
    hotelId,
    checkIn,
    checkOut,
    adults,
    kids,
    guest_name,
    guest_phone,
    guest_email
  ]
);


  const bookingId = bookingResult.insertId;

  // 2️⃣ LOOP OVER CATEGORIES
  for (const r of rooms) {

    const roomCategoryId = r.roomId;
    const roomsBooked = r.rooms;

    // 3️⃣ SAVE CATEGORY-WISE ROOMS
    await conn.query(
      `
      INSERT INTO booking_room_categories
        (booking_id, room_category_id, rooms_booked)
      VALUES (?, ?, ?)
      `,
      [bookingId, roomCategoryId, roomsBooked]
    );

   
  }
}


    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    await conn.rollback();
    console.error("BOOKING ERROR:", err);
    res.status(500).json({ error: "Booking failed" });
  }
});


// ============================================
// CANCEL BOOKING
// ============================================
app.post("/api/bookings/:id/cancel", async (req, res) => {

  const bookingId = req.params.id;
  const conn = db.promise();

  try {
    await conn.beginTransaction();

    const [[booking]] = await conn.query(
      `SELECT * FROM bookings WHERE id = ? AND status = 'confirmed'`,
      [bookingId]
    );

    if (!booking) {
      throw new Error("Booking not found or already cancelled");
    }

    await conn.query(
      `UPDATE bookings SET status='cancelled' WHERE id=?`,
      [bookingId]
    );

    // Generate dates
    const [dates] = await conn.query(
      `
      SELECT DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) AS d
      FROM seq_0_to_365
      WHERE DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) < STR_TO_DATE(?, '%Y-%m-%d')
      `,
      [booking.check_in, booking.check_in, booking.check_out]
    );

    // 🏨 Hotel booking restore
    if (booking.room_category_id) {

      for (const { d } of dates) {
        await conn.query(
          `
          UPDATE room_inventory ri
          JOIN room_categories rc ON rc.id = ri.room_category_id
          SET ri.available_rooms = LEAST(
            ri.available_rooms + ?,
            rc.max_rooms
          )
          WHERE ri.hotel_id = ?
            AND ri.room_category_id = ?
            AND ri.date = ?
          `,
          [
            booking.rooms_booked,
            booking.hotel_id,
            booking.room_category_id,
            d
          ]
        );
      }
    }

    // 🏡 Villa restore
    else {

      for (const { d } of dates) {
        await conn.query(
          `UPDATE villa_inventory SET is_booked = 0 WHERE hotel_id = ? AND date = ?`,
          [booking.hotel_id, d]
        );

        await conn.query(
          `
          UPDATE room_inventory ri
          JOIN room_categories rc ON rc.id = ri.room_category_id
          SET ri.available_rooms = rc.max_rooms
          WHERE ri.hotel_id = ? AND ri.date = ?
          `,
          [booking.hotel_id, d]
        );
      }
    }

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    await conn.rollback();
    console.error("CANCEL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================
// GET BOOKING ROOMS (FOR CALENDAR EDIT)
// ============================================
app.get("/api/calendar/booking-rooms/:id", async (req, res) => {
  const bookingId = req.params.id;

  try {
    const [rows] = await db.promise().query(
      `
      SELECT
        r.id AS room_id,
        r.room_name,
        r.room_category_id
      FROM booking_rooms br
      JOIN rooms r ON r.id = br.room_id
      WHERE br.booking_id = ?
      `,
      [bookingId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch booking rooms" });
  }
});

// =================================================================
//      MANUAL INVENTORY UPDATE (PROTECTED — FINAL)
// =================================================================
app.post("/api/inventory/update", async (req, res) => {
  const { hotelId, roomCategoryId, date, availableRooms, rate } = req.body;
  const conn = db.promise();

  try {
    // 1️⃣ GET MAX ROOMS
    const [[room]] = await conn.query(
      `SELECT max_rooms FROM room_categories WHERE id = ?`,
      [roomCategoryId]
    );

    if (!room) {
      return res.status(404).json({ error: "Room category not found" });
    }

    const maxRooms = Number(room.max_rooms || 0);

  // 2️⃣ PHYSICAL ROOM LOCKS FOR DATE (FINAL SOURCE OF TRUTH)
const [[row]] = await conn.query(
  `
  SELECT COUNT(br.room_id) AS booked
  FROM booking_rooms br
  JOIN bookings b ON b.id = br.booking_id
  JOIN rooms r ON r.id = br.room_id
  WHERE r.hotel_id = ?
    AND r.room_category_id = ?
    AND b.status IN ('confirmed','checked_in')
    AND DATE(?) BETWEEN DATE(b.check_in)
                    AND DATE_SUB(DATE(b.check_out), INTERVAL 1 DAY)
  `,
  [hotelId, roomCategoryId, date]
);

const bookedRooms = Number(row.booked || 0);
const allowedAvailable = maxRooms - bookedRooms;


    // 3️⃣ BLOCK OVERWRITE
    if (
      availableRooms !== null &&
      availableRooms !== undefined &&
      Number(availableRooms) > allowedAvailable
    ) {
      return res.status(400).json({
        error: "Inventory locked by confirmed bookings"
      });
    }

    // 4️⃣ FETCH EXISTING INVENTORY
    const [[existing]] = await conn.query(
      `
      SELECT available_rooms
      FROM room_inventory
      WHERE hotel_id = ?
        AND room_category_id = ?
        AND date = ?
      `,
      [hotelId, roomCategoryId, date]
    );

    const finalAvailableRooms =
      availableRooms !== null && availableRooms !== undefined
        ? Number(availableRooms)
        : existing
          ? Number(existing.available_rooms)
          : maxRooms;

    // 5️⃣ SAFE UPSERT
    await conn.query(
      `
      INSERT INTO room_inventory
        (hotel_id, room_category_id, date, available_rooms, rate)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        available_rooms = VALUES(available_rooms),
        rate = IF(VALUES(rate) IS NULL, rate, VALUES(rate))
      `,
      [
        hotelId,
        roomCategoryId,
        date,
        finalAvailableRooms,
        rate ?? null
      ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Inventory update failed:", err);
    res.status(500).json({ error: "Inventory update failed" });
  }
});

// ====================================================
//      HOMEPAGE DYNAMIC SECTIONS RENDER API (FIXED)
// ====================================================
app.get("/api/homepage/render", (req, res) => {

  const getSections = "SELECT * FROM homepage_sections ORDER BY sort_order ASC";

  db.query(getSections, (err, sections) => {
    if (err) return res.status(500).json({ error: err });
    if (sections.length === 0) return res.json([]);

    // Fetch ALL hotels (NO villa_price!)
    const getHotels = `
      SELECT 
        h.id,
        h.name,
        h.city,
        h.architecture,
        h.full_villa,
        h.villa_tagline,
        (SELECT image_url FROM hotel_images WHERE hotel_id = h.id LIMIT 1) AS main_image
      FROM hotels h
    `;

    db.query(getHotels, (err2, hotels) => {
      if (err2) return res.status(500).json({ error: err2 });

      const finalData = [];

      sections.forEach(section => {
        let mappedItems = [];

        // ---------------- CITY FILTER ----------------
        if (section.filter_type === "city") {
          const uniqueCities = {};
          hotels.forEach(hotel => {
            if (!uniqueCities[hotel.city]) {
              uniqueCities[hotel.city] = {
                title: hotel.city,
                image: hotel.main_image,
                filter_value: hotel.city
              };
            }
          });
          mappedItems = Object.values(uniqueCities);
        }

        // ---------------- ARCHITECTURE FILTER ----------------
        else if (section.filter_type === "architecture") {
          const uniqueArch = {};
          hotels.forEach(hotel => {
            if (!uniqueArch[hotel.architecture]) {
              uniqueArch[hotel.architecture] = {
                title: hotel.architecture,
                image: hotel.main_image,
                filter_value: hotel.architecture
              };
            }
          });
          mappedItems = Object.values(uniqueArch);
        }

        // ---------------- FULL VILLA FILTER (CLEAN & WORKING) ----------------
        else if (section.filter_type === "full_villa") {
          mappedItems = hotels
            .filter(h => h.full_villa == 1)
            .map(h => ({
              id: h.id,
              title: h.name,
              city: h.city,
              image: h.main_image,
              tagline: h.villa_tagline,
              filter_value: h.id,
// 👇 REQUIRED FOR HOMEPAGE CARDS
      price: h.base_price || h.starting_price || null,
      max_guests: h.max_guests || null,
      amenities: [
        h.swimming_pool ? "Pool" : null,
        h.bonfire_area ? "Bonfire" : null,
        h.private_villa_mode ? "Private Villa" : null,
        h.mountain_view ? "Mountain View" : null
      ].filter(Boolean)
            }));
        }

        // push final section
        finalData.push({
  id: section.id,
  title: section.title,
  filter_type: section.filter_type,
  card_style: section.card_style,

  // 👇 THESE 3 LINES FIX EVERYTHING
  show_price: section.show_price,
  show_amenities: section.show_amenities,
  show_occupancy: section.show_occupancy,

  items: mappedItems
});

      });

      res.json(finalData);
    });
  });
});

//========================
// Update homepage section
//========================

app.put("/api/homepage/sections/:id", (req, res) => {
  const id = req.params.id;
  const {
    title,
    filter_type,
    card_style,
    show_price,
    show_occupancy,
    show_amenities
  } = req.body;

  const sql = `
    UPDATE homepage_sections
    SET title=?, filter_type=?, card_style=?, 
        show_price=?, show_occupancy=?, show_amenities=?
    WHERE id=?
  `;

  db.query(
    sql,
    [
      title,
      filter_type,
      card_style,
      show_price ? 1 : 0,
      show_occupancy ? 1 : 0,
      show_amenities ? 1 : 0,
      id
    ],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});



// ======================================================
// HOMEPAGE HERO SETTINGS
// ======================================================


app.get("/api/homepage/settings", (req, res) => {
  db.query(
    "SELECT hero_message, hero_offers FROM homepage_settings WHERE id = 1",
    (err, rows) => {
      if (err) return res.status(500).json({ error: err });

      if (!rows.length) {
        return res.json({
          hero_message: "",
          hero_offers: []
        });
      }

      let offers = [];

      try {
        offers = rows[0].hero_offers
          ? typeof rows[0].hero_offers === "string"
            ? JSON.parse(rows[0].hero_offers)
            : rows[0].hero_offers
          : [];
      } catch (e) {
        offers = [];
      }

      res.json({
        hero_message: rows[0].hero_message || "",
        hero_offers: offers
      });
    }
  );
});


// SAVE hero greeting + offers
app.post("/api/homepage/settings", (req, res) => {
  const { hero_message, hero_offers } = req.body;

  db.query(
    `
    UPDATE homepage_settings
    SET hero_message = ?, hero_offers = ?, updated_at = NOW()
    WHERE id = 1
    `,
    [
      hero_message || "",
      JSON.stringify(hero_offers || [])
    ],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});


//=======================================================
//==================HOTEL FILTER APIS====================
//=======================================================
app.get("/api/hotels", (req, res) => {
  const { city, architecture, full_villa } = req.query;

  // ---------------- FILTER BY CITY ----------------
  if (city) {
    db.query(
      `SELECT h.*,
        (SELECT image_url FROM hotel_images WHERE hotel_id = h.id LIMIT 1) AS main_image
       FROM hotels h
       WHERE h.city=?`,
      [city],
      (err, rows) => res.json(rows)
    );
    return;
  }

  // ---------------- FILTER BY ARCHITECTURE ----------------
  if (architecture) {
    db.query(
      `SELECT h.*,
        (SELECT image_url FROM hotel_images WHERE hotel_id = h.id LIMIT 1) AS main_image
       FROM hotels h
       WHERE h.architecture=?`,
      [architecture],
      (err, rows) => res.json(rows)
    );
    return;
  }

  // ---------------- FILTER BY FULL VILLA ----------------
  if (full_villa) {
    db.query(
      `SELECT h.*,
        (SELECT image_url FROM hotel_images WHERE hotel_id = h.id LIMIT 1) AS main_image
       FROM hotels h
       WHERE h.full_villa = 1`,
      [],
      (err, rows) => res.json(rows)
    );
    return;
  }

  // ---------------- DEFAULT: RETURN ALL HOTELS (WITH MAIN IMAGE) ----------------
  db.query(
    `SELECT h.id, h.name, h.city, h.full_villa, h.villa_tagline,
        (SELECT image_url FROM hotel_images WHERE hotel_id = h.id LIMIT 1) AS main_image
     FROM hotels h`,
    (err, rows) => res.json(rows)
  );
});

// ====================================================
// AUTO CALCULATE VILLA STATS FROM ROOMS
// ====================================================
app.get("/api/villa/:hotelId/stats", (req, res) => {
  const hotelId = req.params.hotelId;

  const sql = `
    SELECT
      SUM(price) AS base_price,
      SUM(base_included_adults) AS base_guests,
      SUM(max_guests) AS max_guests,
      AVG(extra_adult_price) AS extra_adult_price,
      AVG(extra_kid_price) AS extra_kid_price
    FROM room_categories
    WHERE hotel_id = ?
  `;

  db.query(sql, [hotelId], (err, rows) => {
    if (err) return res.status(500).json({ error: err });

    const r = rows[0];

    res.json({
      base_price: Number(r.base_price || 0),
      base_guests: Number(r.base_guests || 0),
      max_guests: Number(r.max_guests || 0),
      extra_adult_price: Number(r.extra_adult_price || 0),
      extra_kid_price: Number(r.extra_kid_price || 0)
    });
  });
});

// ====================================================
// Booking API (DATE-SAFE)
// ====================================================
app.get("/api/bookings", async (req, res) => {
  try {
    const { hotelId, status } = req.query;

    let where = "1=1";
    const params = [];

    if (hotelId) {
      where += " AND b.hotel_id = ?";
      params.push(hotelId);
    }

    if (status) {
      where += " AND b.status = ?";
      params.push(status);
    }

    const [rows] = await db.promise().query(
      `
      SELECT
        b.id,
        h.name AS hotel_name,

        -- 🔑 Booking type
        CASE
          WHEN b.notes = 'FULL_VILLA' THEN 'Full Villa'
          ELSE 'Rooms'
        END AS booking_type,

        -- 🛏️ Room names (physical rooms)
        GROUP_CONCAT(r.room_name ORDER BY r.room_name SEPARATOR ', ') AS room_names,

        -- 🔢 Rooms count
        COUNT(r.id) AS rooms_booked,

        -- 📅 Dates
        DATE_FORMAT(b.check_in, '%Y-%m-%d')  AS check_in,
        DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,

        -- 👤 Guest
        b.guest_name,
        b.guest_phone,

        -- 💰 Payment
        b.total_amount,
        b.advance_amount,
        b.balance_amount,
        b.hotel_payment_status,

        -- ℹ️ Meta
        b.status,
        b.source

      FROM bookings b
      LEFT JOIN hotels h ON h.id = b.hotel_id
      LEFT JOIN booking_rooms br ON br.booking_id = b.id
      LEFT JOIN rooms r ON r.id = br.room_id

      WHERE ${where}
      GROUP BY b.id
      ORDER BY b.created_at DESC
      `,
      params
    );

    res.json(rows);

  } catch (err) {
    console.error("❌ BOOKINGS FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});


//=============Restore Previous Selection==============

function restorePreviousSelection() {
  const raw = sessionStorage.getItem("pendingBooking");
  if (!raw) return;

  const booking = JSON.parse(raw);
  if (!Array.isArray(booking.rooms)) return;

  // Wait till rooms & inventory are loaded
  setTimeout(() => {
    booking.rooms.forEach(sel => {
      const roomCard = document.querySelector(
        `[data-room-id="${sel.roomId}"]`
      );
      if (!roomCard) return;

      // Click "+" button required number of times
      const plusBtn = roomCard.querySelector(".plus");
      for (let i = 0; i < sel.rooms; i++) {
        plusBtn.click();
      }

      // Fill adults/kids
      const rows = roomCard.querySelectorAll(".room-occupancy-row");
      rows.forEach((row, idx) => {
        row.querySelector(".adults").value = sel.adults;
        row.querySelector(".kids").value = sel.kids;
      });
    });

    updateCustomTotal();
  }, 400);
}

// ====================================================
// CREATE PENDING BOOKING (NO INVENTORY CHANGE)
// ====================================================
app.post("/api/bookings/create-pending", async (req, res) => {
  if (req.body.isFullVilla === true) {
  // villa booking → no room rows
  req.body.rooms = [];
}
const {
    hotelId,
    checkIn,
    checkOut,
    adults,
    kids,
    rooms,
    guest_name,
    guest_phone,
    guest_email
  } = req.body;


  if (!hotelId || !checkIn || !checkOut || !guest_name || !guest_phone) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const conn = db.promise();

  try {
    

 // ---------------------------------------
// 1️⃣ CALCULATE BASE AMOUNT (FINAL)
// ---------------------------------------
const { totalAmount, gstPercent = 0 } = req.body;

if (!totalAmount || totalAmount <= 0) {
  return res.status(400).json({ error: "Invalid total amount" });
}

const baseAmount = Math.round(
  (totalAmount * 100) / (100 + gstPercent)
);

const gstAmount = totalAmount - baseAmount;


// ---------------------------------------
// 3️⃣ CREATE PENDING BOOKING (MULTI-CATEGORY SAFE)
// ---------------------------------------
const bookingRef = generateBookingRef();
const isVilla = req.body.isFullVilla === true;

const [result] = await conn.query(
  `
  INSERT INTO bookings (
    booking_reference,
    hotel_id,
    room_category_id,
    check_in,
    check_out,
    rooms_booked,
    adults,
    kids,
    base_amount,
    gst_percent,
    gst_amount,
    total_amount,
    guest_name,
    guest_phone,
    guest_email,
    notes,
    status,
    payment_status,
    source
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', 'website')
  `,
  [
    bookingRef,
    hotelId,
    null,                 // room_category_id (NULL for multi-category)
    checkIn,
    checkOut,
    null,                 // rooms_booked (NULL for multi-category)
    adults,
    kids,
    baseAmount,
    gstPercent,
    gstAmount,
    totalAmount,
    guest_name,
    guest_phone,
    guest_email || null,
    isVilla ? 'FULL_VILLA' : null   // ✅ THIS IS THE KEY FIX
  ]
);


// ====================================================
// 🔗 MAP PENDING BOOKING → CATEGORIES (REAL MULTI-CATEGORY)
// ====================================================
const bookingId = result.insertId;

if (!isVilla && Array.isArray(rooms)) {
  for (const r of rooms) {
    await conn.query(
      `
      INSERT INTO booking_room_categories
        (booking_id, room_category_id, rooms_booked)
      VALUES (?, ?, ?)
      `,
      [bookingId, r.roomId, r.rooms]
    );
  }
}



    // ---------------------------------------
    // 4️⃣ RETURN FOR PAYMENT
    // ---------------------------------------
    res.json({
      success: true,
      bookingId: result.insertId,
      bookingReference: bookingRef,
      baseAmount,
      gstPercent,
      gstAmount,
      totalAmount
    });

  } catch (err) {
    console.error("CREATE PENDING BOOKING ERROR:", err);
    res.status(500).json({ error: "Failed to create pending booking" });
  }
});


// ============================================
// GET SINGLE BOOKING (FOR CALENDAR EDIT) ✅ FIXED
// ============================================
app.get("/api/bookings/:id", async (req, res) => {
  const bookingId = req.params.id;

  try {
    // 1️⃣ Get booking
    const [[booking]] = await db.promise().query(
  `
  SELECT
    *,
    DATE_FORMAT(check_in, '%Y-%m-%d')  AS check_in,
    DATE_FORMAT(check_out, '%Y-%m-%d') AS check_out
  FROM bookings
  WHERE id = ?
  `,
  [bookingId]
);


    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // 2️⃣ Get rooms linked to booking
    const [rooms] = await db.promise().query(
      `
      SELECT
        r.id AS room_id,
        r.room_name,
        r.room_category_id
      FROM booking_rooms br
      JOIN rooms r ON r.id = br.room_id
      WHERE br.booking_id = ?
      `,
      [bookingId]
    );

    // 3️⃣ Attach rooms
    booking.rooms = rooms;

    res.json(booking);

  } catch (err) {
    console.error("GET BOOKING ERROR:", err);
    res.status(500).json({ error: "Failed to fetch booking" });
  }
});


// ============================================
// UPDATE BOOKING PAYMENT (MANUAL ONLY)
// ============================================
app.put("/api/bookings/:id/payment", async (req, res) => {
  const bookingId = req.params.id;
  const { total_amount, advance_amount } = req.body;

  try {
    const [[booking]] = await db.promise().query(
      `SELECT source FROM bookings WHERE id = ?`,
      [bookingId]
    );

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // 🔒 BLOCK WEBSITE BOOKINGS
    if (booking.source === "website") {
      return res.status(403).json({
        error: "Website booking payment cannot be edited"
      });
    }

    const total = Number(total_amount || 0);
    const advance = Number(advance_amount || 0);
    const balance = Math.max(total - advance, 0);

    let hotelPaymentStatus = "unpaid";
    if (advance >= total && total > 0) {
      hotelPaymentStatus = "paid";
    } else if (advance > 0) {
      hotelPaymentStatus = "partial";
    }

    await db.promise().query(
      `
      UPDATE bookings
      SET
        total_amount = ?,
        advance_amount = ?,
        balance_amount = ?,
        hotel_payment_status = ?
      WHERE id = ?
      `,
      [
        total,
        advance,
        balance,
        hotelPaymentStatus,
        bookingId
      ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("PAYMENT UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update payment" });
  }
});

//======================================================
// Razorpay Payments Create Order
// =====================================================

app.post("/api/payments/create-order", async (req, res) => {
  const { bookingId } = req.body;
  if (!bookingId) return res.status(400).json({ error: "bookingId required" });

  const conn = db.promise();

  try {
    const [[booking]] = await conn.query(
      `SELECT id, booking_reference, total_amount
       FROM bookings
       WHERE id=? AND status='pending'`,
      [bookingId]
    );

    if (!booking) {
      return res.status(400).json({ error: "Invalid or confirmed booking" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(booking.total_amount * 100),
      currency: "INR",
      receipt: booking.booking_reference,
      payment_capture: 1
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: booking.total_amount,
      razorpayKey: razorpay.key_id,
      bookingReference: booking.booking_reference,
bookingId: booking.id  
    });

  } catch (err) {
    console.error("Create Razorpay order error:", err);
    res.status(500).json({ error: "Failed to create Razorpay order" });
  }
});


// ====================================================
// Razorpay Payment Verification (FIXED & SAFE)
// ====================================================
app.post("/api/payments/verify", async (req, res) => {
  const {
    bookingId,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature
  } = req.body;

   const conn = await db.promise().getConnection(); // ✅ FIX

  try {
    await conn.beginTransaction();

    // 1️⃣ Fetch pending booking
    const [[booking]] = await conn.query(
      `
      SELECT *
      FROM bookings
      WHERE id = ? AND status = 'pending'
      `,
      [bookingId]
    );

    if (!booking) {
      await conn.rollback();
      return res.status(400).json({ error: "Invalid booking" });
    }

    // ✅ Villa booking decided ONLY by explicit flag
    const isVillaBooking = booking.notes === "FULL_VILLA";

    // 2️⃣ Verify Razorpay signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", razorpay.key_secret)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await conn.rollback();
      return res.status(400).json({ error: "Payment verification failed" });
    }

    // 3️⃣ Confirm booking
   await conn.query(
  `
  UPDATE bookings
  SET
    status = 'confirmed',
    hotel_payment_status = 'paid',
    advance_amount = total_amount,
    balance_amount = 0,
    razorpay_payment_id = ?,
    razorpay_order_id = ?
  WHERE id = ?
  `,
  [
    razorpay_payment_id,
    razorpay_order_id,
    bookingId
  ]
);


    // 4️⃣ Generate booking dates (checkout excluded)
    const [dates] = await conn.query(
      `
      SELECT DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) AS d
      FROM seq_0_to_365
      WHERE DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) < STR_TO_DATE(?, '%Y-%m-%d')
      `,
      [booking.check_in, booking.check_in, booking.check_out]
    );

    // ==================================================
    // 🛏️ ASSIGN PHYSICAL ROOMS — ONCE PER BOOKING
    // ==================================================
    if (!isVillaBooking) {

      const [categories] = await conn.query(
        `
        SELECT room_category_id, rooms_booked
        FROM booking_room_categories
        WHERE booking_id = ?
        `,
        [booking.id]
      );

      for (const c of categories) {
        for (let i = 0; i < c.rooms_booked; i++) {

          const freeRoomId = await findFreeRoomForDates(
            conn,
            booking.hotel_id,
            c.room_category_id,
            booking.check_in,
            booking.check_out
          );

          if (!freeRoomId) {
            throw new Error("No physical rooms available.");
          }

          await conn.query(
            `
            INSERT INTO booking_rooms (booking_id, room_id)
            VALUES (?, ?)
            `,
            [booking.id, freeRoomId]
          );
        }
      }
    }

    // ==================================================
    // 📦 REDUCE INVENTORY — PER DAY (CORRECT)
    // ==================================================
    for (const { d } of dates) {

      if (isVillaBooking) {

        // 🏡 FULL VILLA MODE
        await conn.query(
          `
          INSERT INTO villa_inventory (hotel_id, date, is_booked)
          VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE is_booked = 1
          `,
          [booking.hotel_id, d]
        );

        await conn.query(
          `
          UPDATE room_inventory
          SET available_rooms = 0
          WHERE hotel_id = ? AND date = ?
          `,
          [booking.hotel_id, d]
        );

      } else {

        const [categories] = await conn.query(
          `
          SELECT room_category_id, rooms_booked
          FROM booking_room_categories
          WHERE booking_id = ?
          `,
          [booking.id]
        );

        for (const c of categories) {

          // ensure inventory row exists
          await conn.query(
            `
            INSERT IGNORE INTO room_inventory
              (hotel_id, room_category_id, date, available_rooms)
            SELECT ?, rc.id, ?, rc.max_rooms
            FROM room_categories rc
            WHERE rc.id = ?
            `,
            [booking.hotel_id, d, c.room_category_id]
          );

          // reduce availability
          await conn.query(
            `
            UPDATE room_inventory
            SET available_rooms = GREATEST(available_rooms - ?, 0)
            WHERE hotel_id = ?
              AND room_category_id = ?
              AND date = ?
            `,
            [
              c.rooms_booked,
              booking.hotel_id,
              c.room_category_id,
              d
            ]
          );
        }
      }
    }

    await conn.commit();

    res.json({
      success: true,
      bookingReference: booking.booking_reference
    });

  } catch (err) {
    await conn.rollback();
    console.error("PAYMENT VERIFY ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }finally {
    conn.release(); // ✅ VERY IMPORTANT
  }
});


//=================Calendar Display==========
//=============================================
app.get("/api/calendar", async (req, res) => {
  try {
    const { hotelId, from } = req.query;

    const [rows] = await db
      .promise()
      .query(calendarSQL, [
  from,     // calendar_days start
  from,
  from,
  hotelId, // room bookings scope
  hotelId  // FULL_VILLA scope
]);




    res.json(rows);
  } catch (err) {
    console.error("CALENDAR ERROR:", err);
    res.status(500).json({ error: "Calendar load failed" });
  }
});



// ============================================
// CREATE BOOKING FROM CALENDAR (ADMIN – SAFE)
// ============================================
app.post("/api/calendar/bookings", async (req, res) => {
  const {
    hotelId,
    checkIn,
    checkOut,
    guestName,
    phone,
    paymentStatus,
    notes,
    rooms
  } = req.body;

  if (!hotelId || !checkIn || !checkOut || !guestName || !Array.isArray(rooms) || rooms.length === 0) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const conn = await db.promise().getConnection(); 

  try {
    await conn.beginTransaction();

    // 🔒 STEP 1: VERIFY ROOMS ARE FREE (CRITICAL)
    for (const r of rooms) {
      const [[conflict]] = await conn.query(
        `
        SELECT 1
        FROM booking_rooms br
        JOIN bookings b ON b.id = br.booking_id
        WHERE br.room_id = ?
          AND b.status IN ('pending','confirmed','checked_in')
          AND b.check_in < ?
          AND b.check_out > ?
        LIMIT 1
        `,
        [r.room_id, checkOut, checkIn]
      );

      if (conflict) {
        throw new Error(`Room already booked`);
      }
    }

    // 🧾 STEP 2: CREATE BOOKING  ✅ FIXED (AMOUNT SAFE)
// 🧾 STEP 2: CREATE BOOKING  ✅ FINAL FIX (NaN SAFE)
const rawTotal = req.body.total_amount;
const rawAdvance = req.body.advance_amount;

// Strip currency symbols, commas, spaces
const total = Number(
  String(rawTotal || "0").replace(/[^0-9.]/g, "")
);

const advance = Number(
  String(rawAdvance || "0").replace(/[^0-9.]/g, "")
);

const safeTotal = Number.isFinite(total) ? total : 0;
const safeAdvance = Number.isFinite(advance) ? advance : 0;

const balance = Math.max(safeTotal - safeAdvance, 0);


const [result] = await conn.query(
  `
  INSERT INTO bookings (
    hotel_id,
    check_in,
    check_out,
    guest_name,
    guest_phone,
    total_amount,
    advance_amount,
    balance_amount,
    hotel_payment_status,
    status,
    source,
    notes
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'manual', ?)
  `,
  [
  hotelId,
  checkIn,
  checkOut,
  guestName,
  phone,
  safeTotal,
  safeAdvance,
  balance,
  paymentStatus || "unpaid",
  notes || null
]
);

const bookingId = result.insertId;


    // 🔗 STEP 3: MAP PHYSICAL ROOMS
    for (const r of rooms) {
      await conn.query(
        `
        INSERT INTO booking_rooms (booking_id, room_id)
        VALUES (?, ?)
        `,
        [bookingId, r.room_id]
      );
    }

    // 📦 STEP 4: SAVE CATEGORY SUMMARY (OPTIONAL BUT SAFE)
    const categoryMap = {};
    rooms.forEach(r => {
      categoryMap[r.room_category_id] =
        (categoryMap[r.room_category_id] || 0) + 1;
    });

    for (const catId in categoryMap) {

      await conn.query(
        `
        INSERT INTO booking_room_categories
          (booking_id, room_category_id, rooms_booked)
        VALUES (?, ?, ?)
        `,
        [bookingId, catId, categoryMap[catId]]
      );
    }


// 5️⃣ REDUCE INVENTORY FOR MANUAL BOOKING
// ---------------------------------------
const [dates] = await conn.query(
  `
  SELECT DATE(
    STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
  ) AS d
  FROM seq_0_to_365
  WHERE DATE(
    STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
  ) < STR_TO_DATE(?, '%Y-%m-%d')
  `,
  [checkIn, checkIn, checkOut]
);

// Reduce inventory category-wise
for (const catId in categoryMap) {
  const roomsBooked = categoryMap[catId];

  for (const { d } of dates) {

    // Ensure inventory row exists
    await conn.query(
  `
  INSERT INTO room_inventory
    (hotel_id, room_category_id, date, available_rooms)
  SELECT
    ?, rc.id, ?, rc.max_rooms
  FROM room_categories rc
  WHERE rc.id = ?
  ON DUPLICATE KEY UPDATE
    available_rooms = available_rooms
  `,
  [hotelId, d, catId]
);

    // Reduce availability safely
    await conn.query(
      `
      UPDATE room_inventory
      SET available_rooms = GREATEST(available_rooms - ?, 0)
      WHERE hotel_id = ?
        AND room_category_id = ?
        AND date = ?
      `,
      [
        roomsBooked,
        hotelId,
        catId,
        d
      ]
    );
  }
}

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    await conn.rollback();
    console.error("CALENDAR BOOKING ERROR:", err.message);
    res.status(400).json({ error: err.message });
  }finally {
    conn.release();   // ✅ IMPORTANT (prevents pool from dying)
  }
});

// ============================================
// UPDATE BOOKING FROM CALENDAR (ADMIN – FIXED)
// ============================================
app.put("/api/calendar/bookings/:id", async (req, res) => {
  const bookingId = req.params.id;
  


  const {
    guest_name,
    guest_phone,
    check_in,
    check_out,
    notes,
    total_amount,
    advance_amount,
    hotel_payment_status,
    rooms // [{ room_id, room_category_id }]
  } = req.body;

  if (
    !guest_name ||
    !guest_phone ||
    !check_in ||
    !check_out ||
    !Array.isArray(rooms) ||
    rooms.length === 0
  ) {
    return res.status(400).json({ error: "Missing required fields" });
  }
const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    // 1️⃣ LOAD EXISTING BOOKING
    const [[booking]] = await conn.query(
      `SELECT * FROM bookings WHERE id = ?`,
      [bookingId]
    );

    if (!booking) throw new Error("Booking not found");
    if (booking.source === "website")
      throw new Error("Website bookings cannot be edited");

    // 2️⃣ LOAD OLD ROOMS
    const [oldRooms] = await conn.query(
      `
      SELECT r.room_category_id
      FROM booking_rooms br
      JOIN rooms r ON r.id = br.room_id
      WHERE br.booking_id = ?
      `,
      [bookingId]
    );

    // Count old rooms per category
    const oldCategoryMap = {};
    oldRooms.forEach(r => {
      oldCategoryMap[r.room_category_id] =
        (oldCategoryMap[r.room_category_id] || 0) + 1;
    });

    // 3️⃣ RESTORE OLD INVENTORY
    const [oldDates] = await conn.query(
      `
      SELECT DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) AS d
      FROM seq_0_to_365
      WHERE DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) < STR_TO_DATE(?, '%Y-%m-%d')
      `,
      [booking.check_in, booking.check_in, booking.check_out]
    );

    for (const catId in oldCategoryMap) {
      const roomsToRestore = oldCategoryMap[catId];

      for (const { d } of oldDates) {
        await conn.query(
          `
          UPDATE room_inventory ri
          JOIN room_categories rc ON rc.id = ri.room_category_id
          SET ri.available_rooms = LEAST(
            ri.available_rooms + ?, rc.max_rooms
          )
          WHERE ri.hotel_id = ?
            AND ri.room_category_id = ?
            AND ri.date = ?
          `,
          [
            roomsToRestore,
            booking.hotel_id,
            catId,
            d
          ]
        );
      }
    }

    // 4️⃣ REMOVE OLD ROOM LOCKS
    await conn.query(
      `DELETE FROM booking_rooms WHERE booking_id = ?`,
      [bookingId]
    );

    // 5️⃣ INSERT NEW ROOM LOCKS
    for (const r of rooms) {
      await conn.query(
        `
        INSERT INTO booking_rooms (booking_id, room_id)
        VALUES (?, ?)
        `,
        [bookingId, r.room_id]
      );
    }

    // 6️⃣ CALCULATE NEW CATEGORY COUNTS
    const newCategoryMap = {};
    rooms.forEach(r => {
      newCategoryMap[r.room_category_id] =
        (newCategoryMap[r.room_category_id] || 0) + 1;
    });

    // 7️⃣ APPLY NEW INVENTORY
    const [newDates] = await conn.query(
      `
      SELECT DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) AS d
      FROM seq_0_to_365
      WHERE DATE(
        STR_TO_DATE(?, '%Y-%m-%d') + INTERVAL seq DAY
      ) < STR_TO_DATE(?, '%Y-%m-%d')
      `,
      [check_in, check_in, check_out]
    );

    for (const catId in newCategoryMap) {
      const roomsBooked = newCategoryMap[catId];

      for (const { d } of newDates) {

        // Ensure inventory row exists
        await conn.query(
          `
          INSERT INTO room_inventory
            (hotel_id, room_category_id, date, available_rooms)
          SELECT
            ?, rc.id, ?, rc.max_rooms
          FROM room_categories rc
          WHERE rc.id = ?
          ON DUPLICATE KEY UPDATE
            available_rooms = available_rooms
          `,
          [booking.hotel_id, d, catId]
        );

        // Reduce inventory
        await conn.query(
          `
          UPDATE room_inventory
          SET available_rooms = GREATEST(available_rooms - ?, 0)
          WHERE hotel_id = ?
            AND room_category_id = ?
            AND date = ?
          `,
          [
            roomsBooked,
            booking.hotel_id,
            catId,
            d
          ]
        );
      }
    }

    // 8️⃣ PAYMENT CALC
    const total = Number(total_amount || 0);
    const advance = Number(advance_amount || 0);
    const balance = Math.max(total - advance, 0);

    let paymentStatus = hotel_payment_status || "unpaid";
    if (advance >= total && total > 0) paymentStatus = "paid";
    else if (advance > 0) paymentStatus = "partial";

    // 9️⃣ UPDATE BOOKING HEADER
    await conn.query(
      `
      UPDATE bookings SET
        guest_name = ?,
        guest_phone = ?,
        check_in = ?,
        check_out = ?,
        notes = ?,
        total_amount = ?,
        advance_amount = ?,
        balance_amount = ?,
        hotel_payment_status = ?
      WHERE id = ?
      `,
      [
        guest_name,
        guest_phone,
        check_in,
        check_out,
        notes || null,
        total,
        advance,
        balance,
        paymentStatus,
        bookingId
      ]
    );

    await conn.commit();
    res.json({ success: true });

  } catch (err) {
    await conn.rollback();
    console.error("BOOKING EDIT ERROR:", err.message);
    res.status(400).json({ error: err.message });
  }finally {
    conn.release();   // ✅ CRITICAL
  }
});

// ====================================================
//                Header Menu
// ====================================================

// PUBLIC – header
app.get("/api/header-menu", (req, res) => {
  db.query(
    `
    SELECT id, label, url, sort_order, is_active
FROM header_menu
ORDER BY sort_order ASC

    `,
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

// ADMIN – add menu
app.post("/api/admin/header-menu", adminAuthMiddleware, (req, res) => {
  const { label, url, sort_order } = req.body;

  // ✅ VALIDATION MUST BE HERE
  if (!label || !url) {
    return res.status(400).json({ error: "Label and URL are required" });
  }

  db.query(
    `
    INSERT INTO header_menu (label, url, sort_order)
    VALUES (?, ?, ?)
    `,
    [label, url, sort_order || 0],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});

// ADMIN – enable / disable / update
app.put("/api/admin/header-menu/:id", adminAuthMiddleware, (req, res) => {
  const { label, url, sort_order, is_active } = req.body;

  db.query(
    `
    UPDATE header_menu
    SET
      label = COALESCE(?, label),
      url = COALESCE(?, url),
      sort_order = COALESCE(?, sort_order),
      is_active = COALESCE(?, is_active)
    WHERE id = ?
    `,
    [label, url, sort_order, is_active, req.params.id],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});

// ADMIN – delete menu
app.delete("/api/admin/header-menu/:id", adminAuthMiddleware, (req, res) => {
  db.query(
    "DELETE FROM header_menu WHERE id = ?",
    [req.params.id],
    err => {
      if (err) return res.status(500).json({ error: err });
      res.json({ success: true });
    }
  );
});


// ====================================================
//                START SERVER
// ====================================================
const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received.');
  process.exit(0);
});


 
 