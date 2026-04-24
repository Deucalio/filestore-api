// ─── Auth Middleware ──────────────────────────────────────────────────────────
const prisma = require("../db");

const PLAN_LIMITS = {
  basic:      10  * 1024 * 1024 * 1024,  // 10 GB
  pro:        100 * 1024 * 1024 * 1024,  // 100 GB
  enterprise: 300 * 1024 * 1024 * 1024,  // 300 GB
};

async function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Missing Authorization header. Use: Authorization: Bearer <access_token>",
    });
  }

  try {
    const app = await prisma.app.findUnique({ where: { accessToken: token } });

    if (!app) {
      return res.status(401).json({ error: "Invalid access token." });
    }

    req.app_ctx = {
      ...app,
      storageLimit:     PLAN_LIMITS[app.plan],
      storageAvailable: PLAN_LIMITS[app.plan] - app.storageUsed,
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, PLAN_LIMITS };
