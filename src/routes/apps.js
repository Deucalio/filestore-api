// ─── Apps Routes ─────────────────────────────────────────────────────────────
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const prisma = require("../db");
const { authenticate, PLAN_LIMITS } = require("../middleware/auth");
const { formatBytes, ensureDir, STORAGE_ROOT } = require("../utils/storage");
const path = require("path");

const router = express.Router();

// ── POST /apps/create ─────────────────────────────────────────────────────────
// Create a new app and receive an access token
router.post("/create", async (req, res, next) => {
  const { name, plan } = req.body;

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return res.status(400).json({ error: "App name must be at least 2 characters." });
  }

  const validPlans = ["basic", "pro", "enterprise"];
  if (!plan || !validPlans.includes(plan.toLowerCase())) {
    return res.status(400).json({
      error: "Invalid plan. Choose from: basic, pro, enterprise.",
      plans: {
        basic:      "10 GB",
        pro:        "100 GB",
        enterprise: "300 GB",
      },
    });
  }

  const id           = uuidv4();
  const access_token = `fst_${uuidv4().replace(/-/g, "")}`;
  const normalPlan   = plan.toLowerCase();

  try {
    await prisma.app.create({
      data: { id, name: name.trim(), plan: normalPlan, accessToken: access_token },
    });

    // Create app's root storage directory on disk
    ensureDir(path.join(STORAGE_ROOT, id));

    return res.status(201).json({
      message: "App created successfully. Keep your access_token safe. It cannot be recovered.",
      app: {
        id,
        name: name.trim(),
        plan: normalPlan,
        storage_limit:   formatBytes(PLAN_LIMITS[normalPlan]),
        storage_used:    "0 B",
        access_token,
        created_at:      new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /apps/me ──────────────────────────────────────────────────────────────
// Get current app info + storage stats
router.get("/me", authenticate, (req, res) => {
  const app = req.app_ctx;
  return res.json({
    id:                      app.id,
    name:                    app.name,
    plan:                    app.plan,
    storage_limit:           formatBytes(app.storageLimit),
    storage_limit_bytes:     app.storageLimit,
    storage_used:            formatBytes(app.storageUsed),
    storage_used_bytes:      app.storageUsed,
    storage_available:       formatBytes(app.storageAvailable),
    storage_available_bytes: app.storageAvailable,
    usage_percent:           ((app.storageUsed / app.storageLimit) * 100).toFixed(2) + "%",
    created_at:              app.createdAt,
  });
});

// ── DELETE /apps/me ───────────────────────────────────────────────────────────
// Delete app and ALL its data (irreversible)
router.delete("/me", authenticate, async (req, res, next) => {
  const { confirm } = req.body;
  if (confirm !== "DELETE_MY_APP") {
    return res.status(400).json({
      error: 'Set body { "confirm": "DELETE_MY_APP" } to confirm permanent deletion.',
    });
  }

  const appId = req.app_ctx.id;
  const fs    = require("fs");

  // Remove files from disk
  const appDir = path.join(STORAGE_ROOT, appId);
  if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });

  try {
    await prisma.file.deleteMany({ where: { appId } });
    await prisma.directory.deleteMany({ where: { appId } });
    await prisma.app.delete({ where: { id: appId } });

    return res.json({ message: "App and all associated data permanently deleted." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
