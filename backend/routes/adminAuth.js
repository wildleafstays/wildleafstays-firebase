const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");


module.exports = function (db) {
  const router = express.Router();

  // ===============================
  // REAL ADMIN CREATION (PROTECTED)
  // ===============================
  router.post("/create-admin", async (req, res) => {
    const { email, password, setupKey } = req.body;

    if (!email || !password || !setupKey) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // 🔒 Protect with ENV key
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    db.query(
      "SELECT id FROM admins WHERE email = ?",
      [email],
      async (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (rows.length > 0) {
          return res.status(409).json({ error: "Admin already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        db.query(
          "INSERT INTO admins (email, password_hash) VALUES (?, ?)",
          [email, hashedPassword],
          err2 => {
            if (err2) {
              return res.status(500).json({ error: err2.message });
            }

            res.json({ success: true });
          }
        );
      }
    );
  });

  // ===============================
// ADMIN LOGIN (JWT)
// ===============================
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  db.query(
    "SELECT * FROM admins WHERE email = ?",
    [email],
    async (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (rows.length === 0) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const admin = rows[0];

      // 🔐 Compare password with bcrypt hash
      const isMatch = await bcrypt.compare(
        password,
        admin.password_hash
      );

      if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // 🎟️ Generate JWT token
      const token = jwt.sign(
        { adminId: admin.id, email: admin.email },
        process.env.JWT_SECRET,
        { expiresIn: "12h" }
      );

      res.json({
        success: true,
        token,
        admin: {
          id: admin.id,
          email: admin.email
        }
      });
    }
  );
});

// ===============================
// CHANGE PASSWORD (LOGGED IN)
// ===============================
router.post("/change-password", require("../middleware/adminAuthMiddleware"), (req, res) => {
  const adminId = req.admin?.adminId || req.adminId; // fallback-safe
  const { currentPassword, newPassword } = req.body;

  if (!adminId) return res.status(401).json({ error: "Unauthorized" });
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Basic strength rule (you can tighten later)
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  db.query(
    "SELECT id, password_hash FROM admins WHERE id = ?",
    [adminId],
    async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ error: "Admin not found" });

      const admin = rows[0];

      const ok = await bcrypt.compare(currentPassword, admin.password_hash);
      if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

      const hashed = await bcrypt.hash(newPassword, 10);

      db.query(
        "UPDATE admins SET password_hash = ? WHERE id = ?",
        [hashed, adminId],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          // Industry standard: force logout after password change
          return res.json({ success: true, forceLogout: true });
        }
      );
    }
  );
});


// ===============================
// FORGOT PASSWORD (REQUEST LINK)
// ===============================
const nodemailer = require("nodemailer");

function getResetLink(token) {
  // Put your real domain later
  const base =
    process.env.ADMIN_RESET_URL_BASE ||
    "/admin"; // Live Server style
  return `${base}/reset-password.html?token=${encodeURIComponent(token)}`;
}

// Configure email (optional in dev)
async function sendResetEmail(toEmail, link) {
  if (!process.env.SMTP_HOST) {
    // Dev fallback: just log link
    console.log("🔗 Reset link (SMTP not configured):", link);
    return;
  }

  const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true, // 🔥 REQUIRED for port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});


  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: "Reset your Wildleaf Admin password",
    text: `Reset your password using this link (valid for 15 minutes): ${link}`,
  });
}

router.post("/forgot-password", (req, res) => {
  const { email } = req.body;

  // Always return same response (prevents email enumeration)
  const safeResponse = () =>
    res.json({ message: "If the email exists, a reset link has been sent." });

  if (!email) return safeResponse();

  db.query(
    "SELECT id, email FROM admins WHERE email = ?",
    [email],
    async (err, rows) => {
      if (err) {
        // Still safe response
        console.error("forgot-password error:", err.message);
        return safeResponse();
      }

      if (!rows.length) return safeResponse();

      const admin = rows[0];

      // 32 bytes → long random token
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      // expires in 15 minutes
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      db.query(
        `
        INSERT INTO admin_password_resets
          (admin_id, token_hash, expires_at, used)
        VALUES (?, ?, ?, 0)
        `,
        [admin.id, tokenHash, expiresAt],
        async (err2) => {
          if (err2) {
            console.error("reset insert error:", err2.message);
            return safeResponse();
          }

          const link = getResetLink(token);

          try {
            await sendResetEmail(admin.email, link);
          } catch (e) {
            console.error("email send error:", e.message);
            // Still safe response; do not leak internals
          }

          return safeResponse();
        }
      );
    }
  );
});


// ===============================
// RESET PASSWORD (USING TOKEN)
// ===============================
router.post("/reset-password", (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  // Find a valid reset request
  db.query(
    `
    SELECT r.id AS reset_id, r.admin_id
    FROM admin_password_resets r
    WHERE r.token_hash = ?
      AND r.used = 0
      AND r.expires_at > NOW()
    ORDER BY r.id DESC
    LIMIT 1
    `,
    [tokenHash],
    async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(400).json({ error: "Invalid or expired token" });

      const reset = rows[0];

      const hashed = await bcrypt.hash(newPassword, 10);

      // Update password + mark token used (simple 2 queries)
      db.query(
        "UPDATE admins SET password_hash = ? WHERE id = ?",
        [hashed, reset.admin_id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          db.query(
            "UPDATE admin_password_resets SET used = 1 WHERE id = ?",
            [reset.reset_id],
            (err3) => {
              if (err3) return res.status(500).json({ error: err3.message });
              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});


  return router;
};
