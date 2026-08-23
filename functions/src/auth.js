async function requireAdmin(req, res, admin, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    res.status(401).json({ error: "Admin login required" });
    return null;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const adminDoc = await db.collection("adminUsers").doc(decoded.uid).get();

    if (!adminDoc.exists || adminDoc.data().active !== true) {
      res.status(403).json({ error: "Admin access denied" });
      return null;
    }

    return { uid: decoded.uid, email: decoded.email || adminDoc.data().email || "" };
  } catch (err) {
    res.status(401).json({ error: "Invalid admin token" });
    return null;
  }
}

module.exports = {
  requireAdmin
};
