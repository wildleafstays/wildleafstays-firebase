const jwt = require("jsonwebtoken");

module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  // Expect: Authorization: Bearer <token>
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded; // attach admin info
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
