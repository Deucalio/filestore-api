// ─── Preview Routes ───────────────────────────────────────────────────────────
// Public, token-less preview of IMAGE files so they can be embedded directly in
// a website, e.g. <img src="https://host/preview/<fileId>">.
//
// Security model: there is intentionally no Authorization header (it can't be
// sent by an <img> tag). Instead a file's globally-unique UUID acts as an
// unguessable "capability" URL — only someone who knows the id can view it.
// Only files whose mime type is image/* are ever served here.
const express = require("express");
const fs      = require("fs");
const prisma  = require("../db");
const { resolvePath, formatBytes } = require("../utils/storage");

const router = express.Router();

const isImage = (mimeType) => typeof mimeType === "string" && mimeType.startsWith("image/");

/** Build an absolute preview URL for a file id from the current request */
function previewUrl(req, id) {
  return `${req.protocol}://${req.get("host")}/preview/${id}`;
}

// ── GET /preview ──────────────────────────────────────────────────────────────
// Preview MULTIPLE files at once. Returns JSON with a direct, embeddable preview
// URL for each image so a site can render several <img> tags.
// Query: ?ids=id1,id2,id3   (comma-separated file ids)
router.get("/", async (req, res, next) => {
  const raw = req.query.ids;
  if (!raw) {
    return res.status(400).json({
      error: "Query param 'ids' is required, e.g. /preview?ids=<id1>,<id2>",
    });
  }

  const ids = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return res.status(400).json({ error: "No valid file ids provided." });
  }

  try {
    const files = await prisma.file.findMany({ where: { id: { in: ids } } });
    const byId  = new Map(files.map((f) => [f.id, f]));

    const previews = [];
    const failed   = [];

    for (const id of ids) {
      const f = byId.get(id);
      if (!f) {
        failed.push({ id, error: "File not found." });
        continue;
      }
      if (!isImage(f.mimeType)) {
        failed.push({ id, error: "Not an image. Only image files can be previewed.", mime_type: f.mimeType });
        continue;
      }
      previews.push({
        id:         f.id,
        name:       f.name,
        url:        previewUrl(req, f.id),
        mime_type:  f.mimeType,
        size:       formatBytes(f.size),
        size_bytes: f.size,
      });
    }

    return res.json({
      total:    previews.length,
      failed:   failed.length,
      previews,
      errors:   failed,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /preview/:id ──────────────────────────────────────────────────────────
// Preview a SINGLE image file. Streams the raw image bytes inline so it can be
// used directly as the source of an <img> tag. No token required.
router.get("/:id", async (req, res, next) => {
  const { id } = req.params;

  try {
    const file = await prisma.file.findUnique({ where: { id } });

    if (!file) {
      return res.status(404).json({ error: "File not found.", id });
    }

    if (!isImage(file.mimeType)) {
      return res.status(415).json({
        error:     "Only image files can be previewed.",
        id,
        mime_type: file.mimeType,
      });
    }

    const realPath = resolvePath(file.appId, file.fullPath);
    if (!fs.existsSync(realPath)) {
      return res.status(410).json({ error: "Image record exists but physical file is missing." });
    }

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${file.name}"`);
    res.setHeader("Content-Length", file.size);
    res.setHeader("Cache-Control", "public, max-age=86400");

    return fs.createReadStream(realPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
