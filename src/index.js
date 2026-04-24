// ─── FileStore API: Entry Point ──────────────────────────────────────────────
require("dotenv").config();
const express = require("express");
const prisma  = require("./db");

const appsRouter  = require("./routes/apps");
const dirsRouter  = require("./routes/dirs");
const filesRouter = require("./routes/files");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Global Middleware ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/apps",  appsRouter);
app.use("/dirs",  dirsRouter);
app.use("/files", filesRouter);

// ── Root: API Info ───────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    name:    "FileStore API",
    version: "1.0.0",
    status:  "running",
    plans: {
      basic:      "10 GB",
      pro:        "100 GB",
      enterprise: "300 GB",
    },
    endpoints: {
      "POST   /apps/create":         "Create a new app and receive an access_token",
      "GET    /apps/me":             "Get your app info + storage stats",
      "DELETE /apps/me":             "Delete app and ALL data (irreversible)",

      "POST   /dirs/create":         "Create a directory (body: { path })",
      "GET    /dirs?path=/":         "List contents of a directory",
      "GET    /dirs/tree":           "Full recursive tree of your storage",
      "DELETE /dirs":                "Delete a directory and all its contents",

      "POST   /files/upload":        "Upload a single file (multipart form-data)",
      "POST   /files/batch-upload":  "Upload multiple files at once",
      "GET    /files":               "List all files (supports ?dir, ?search, ?page, ?limit)",
      "GET    /files/info?path=":    "Get metadata for a specific file",
      "GET    /files/download?path=":"Download / stream a file",
      "DELETE /files":               "Delete a single file (body: { path })",
      "DELETE /files/batch":         "Delete multiple files (body: { paths: [] })",
    },
    auth: "All endpoints except POST /apps/create require: Authorization: Bearer <access_token>",
  });
});

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found. GET / for API reference." });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Maximum 5 GB per file." });
  }
  res.status(500).json({ error: "Internal server error." });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  FileStore API running on http://localhost:${PORT}`);
  console.log(`  GET http://localhost:${PORT}/ for full endpoint reference\n`);
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
