// ─── Files Routes ─────────────────────────────────────────────────────────────
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { v4: uuidv4 } = require("uuid");
const mime    = require("mime-types");
const prisma  = require("../db");
const { authenticate } = require("../middleware/auth");
const {
  resolvePath,
  ensureDir,
  sanitizePath,
  formatBytes,
} = require("../utils/storage");

const router = express.Router();

// ── Multer setup (memory storage, we stream to disk ourselves) ────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB per file max
});

// ── Helper: write file to disk and register in DB ─────────────────────────────
async function saveFile(appId, virtualDir, originalName, buffer, mimeType) {
  const safeDir  = sanitizePath(virtualDir);
  const realDir  = resolvePath(appId, safeDir);
  ensureDir(realDir);

  // Build unique filename if a file with that name already exists
  const safeName     = path.basename(originalName).replace(/[^a-zA-Z0-9._\-]/g, "_");
  const realFilePath = path.join(realDir, safeName);
  const virtualPath  = path.posix.join(safeDir, safeName);
  const fileSize     = buffer.length;
  const detectedMime = mimeType || mime.lookup(safeName) || "application/octet-stream";

  // Check no duplicate virtual path for this app
  const duplicate = await prisma.file.findUnique({
    where: { appId_fullPath: { appId, fullPath: virtualPath } },
  });

  if (duplicate) {
    throw Object.assign(
      new Error(`A file already exists at ${virtualPath}. Delete it first.`),
      { code: "DUPLICATE_FILE", status: 409 }
    );
  }

  // Write to disk
  fs.writeFileSync(realFilePath, buffer);

  const id = uuidv4();
  await prisma.file.create({
    data: { id, appId, name: safeName, dirPath: safeDir, fullPath: virtualPath, size: fileSize, mimeType: detectedMime },
  });

  // Update app storage_used
  await prisma.app.update({
    where: { id: appId },
    data: { storageUsed: { increment: fileSize } },
  });

  return { id, name: safeName, path: virtualPath, dir: safeDir, size: fileSize, mime_type: detectedMime };
}

// ── POST /files/upload ────────────────────────────────────────────────────────
// Upload a single file.
// Form fields: file (required), path (optional, defaults to root "/")
router.post("/upload", authenticate, upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided. Use form-data with field name 'file'." });
  }

  const appCtx      = req.app_ctx;
  const virtualDir  = req.body.path || "/";
  const fileSize    = req.file.size;

  if (fileSize > appCtx.storageAvailable) {
    return res.status(413).json({
      error:             "Not enough storage.",
      storage_available: formatBytes(appCtx.storageAvailable),
      file_size:         formatBytes(fileSize),
    });
  }

  try {
    const saved = await saveFile(appCtx.id, virtualDir, req.file.originalname, req.file.buffer, req.file.mimetype);
    return res.status(201).json({
      message: "File uploaded successfully.",
      file: {
        id:         saved.id,
        name:       saved.name,
        path:       saved.path,
        directory:  saved.dir,
        size:       formatBytes(saved.size),
        size_bytes: saved.size,
        mime_type:  saved.mime_type,
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /files/batch-upload ──────────────────────────────────────────────────
// Upload multiple files at once.
// Form fields: files[] (required), path (optional)
router.post("/batch-upload", authenticate, upload.array("files[]", 100), async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files provided. Use form-data with field name 'files[]'." });
  }

  const appCtx     = req.app_ctx;
  const virtualDir = req.body.path || "/";
  const totalSize  = req.files.reduce((sum, f) => sum + f.size, 0);

  if (totalSize > appCtx.storageAvailable) {
    return res.status(413).json({
      error:             "Not enough storage for this batch.",
      storage_available: formatBytes(appCtx.storageAvailable),
      batch_total_size:  formatBytes(totalSize),
    });
  }

  const results   = [];
  const failures  = [];

  for (const file of req.files) {
    try {
      const saved = await saveFile(appCtx.id, virtualDir, file.originalname, file.buffer, file.mimetype);
      results.push({
        status:     "uploaded",
        id:         saved.id,
        name:       saved.name,
        path:       saved.path,
        size:       formatBytes(saved.size),
        size_bytes: saved.size,
        mime_type:  saved.mime_type,
      });
    } catch (err) {
      failures.push({ name: file.originalname, error: err.message });
    }
  }

  return res.status(207).json({
    message:        `${results.length} uploaded, ${failures.length} failed.`,
    uploaded:       results,
    failed:         failures,
    total_uploaded: results.length,
    total_failed:   failures.length,
  });
});

// ── GET /files/download ───────────────────────────────────────────────────────
// Download or stream a file.
// Query: ?path=/some/dir/file.pdf
router.get("/download", authenticate, async (req, res, next) => {
  const rawPath = req.query.path;
  if (!rawPath) return res.status(400).json({ error: "Query param 'path' is required." });

  const virtualPath = sanitizePath(rawPath);
  const appId       = req.app_ctx.id;

  try {
    const fileRecord = await prisma.file.findUnique({
      where: { appId_fullPath: { appId, fullPath: virtualPath } },
    });

    if (!fileRecord) {
      return res.status(404).json({ error: "File not found.", path: virtualPath });
    }

    const realPath = resolvePath(appId, virtualPath);
    if (!fs.existsSync(realPath)) {
      return res.status(410).json({ error: "File record exists but physical file is missing. It may have been deleted externally." });
    }

    res.setHeader("Content-Type", fileRecord.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileRecord.name}"`);
    res.setHeader("Content-Length", fileRecord.size);
    res.setHeader("X-File-Id", fileRecord.id);

    return fs.createReadStream(realPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

// ── GET /files/preview ────────────────────────────────────────────────────────
// PUBLIC, token-less preview of IMAGE files so they can be embedded directly in
// a website, e.g. <img src="https://host/files/preview?path=/img/logo.png">.
// An <img> tag cannot send an Authorization header, so this route requires none.
// Only image/* files are ever served. Optionally scope to a specific app with
// ?app=<appId> (recommended when multiple apps share path names).
router.get("/preview", async (req, res, next) => {
  const isImage = (m) => typeof m === "string" && m.startsWith("image/");
  const appId   = req.query.app || null;

  // Look up a single file by virtual path, optionally scoped to an app.
  async function findByPath(virtualPath) {
    if (appId) {
      return prisma.file.findUnique({
        where: { appId_fullPath: { appId, fullPath: virtualPath } },
      });
    }
    return prisma.file.findFirst({ where: { fullPath: virtualPath } });
  }

  try {
    const rawPath = req.query.path;
    if (!rawPath) {
      return res.status(400).json({ error: "Query param 'path' is required." });
    }

    const virtualPath = sanitizePath(rawPath);
    const file        = await findByPath(virtualPath);

    if (!file) {
      return res.status(404).json({ error: "File not found.", path: virtualPath });
    }
    if (!isImage(file.mimeType)) {
      return res.status(415).json({ error: "Only image files can be previewed.", path: virtualPath, mime_type: file.mimeType });
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

// ── GET /files/stream ─────────────────────────────────────────────────────────
// PUBLIC, token-less streaming of VIDEO/AUDIO files WITH HTTP Range support, so
// they can be embedded directly, e.g.
//   <video controls src="https://host/files/stream?path=/dir/clip.mp4"></video>
// A <video>/<audio> tag cannot send an Authorization header, so (like /preview)
// this route requires none. Range support (206 Partial Content) is what enables
// seeking and reliable playback on Safari/iOS — without it the scrubber won't
// work and some browsers refuse to start. Only video/* and audio/* are served.
// Optionally scope to an app with ?app=<appId> (recommended across apps).
router.get("/stream", async (req, res, next) => {
  const isStreamable = (m) =>
    typeof m === "string" && (m.startsWith("video/") || m.startsWith("audio/"));
  const appId = req.query.app || null;

  const rawPath = req.query.path;
  if (!rawPath) {
    return res.status(400).json({ error: "Query param 'path' is required." });
  }

  const virtualPath = sanitizePath(rawPath);

  try {
    const file = appId
      ? await prisma.file.findUnique({ where: { appId_fullPath: { appId, fullPath: virtualPath } } })
      : await prisma.file.findFirst({ where: { fullPath: virtualPath } });

    if (!file) {
      return res.status(404).json({ error: "File not found.", path: virtualPath });
    }
    if (!isStreamable(file.mimeType)) {
      return res.status(415).json({
        error: "Only video/audio files can be streamed. Use /files/preview for images or /files/download for other types.",
        path: virtualPath,
        mime_type: file.mimeType,
      });
    }

    const realPath = resolvePath(file.appId, file.fullPath);
    if (!fs.existsSync(realPath)) {
      return res.status(410).json({ error: "Media record exists but physical file is missing." });
    }

    const total = fs.statSync(realPath).size;
    const range = req.headers.range;

    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400");

    // No Range header → serve the whole file (200). Browsers still buffer/play,
    // but seeking is what the 206 path below makes work.
    if (!range) {
      res.setHeader("Content-Length", total);
      return fs.createReadStream(realPath).pipe(res);
    }

    // Parse "bytes=start-end" (either side may be empty).
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (match[1] === "" && match[2] === "")) {
      res.setHeader("Content-Range", `bytes */${total}`);
      return res.status(416).json({ error: "Malformed Range header." });
    }

    let start = match[1] === "" ? undefined : parseInt(match[1], 10);
    let end   = match[2] === "" ? undefined : parseInt(match[2], 10);

    if (start === undefined) {
      // Suffix range "bytes=-N" → last N bytes.
      start = Math.max(0, total - end);
      end = total - 1;
    } else if (end === undefined) {
      // Open-ended "bytes=N-" → from N to the end.
      end = total - 1;
    } else {
      // Clamp an explicit end that runs past EOF.
      if (end >= total) end = total - 1;
    }

    if (start > end || start >= total) {
      res.setHeader("Content-Range", `bytes */${total}`);
      return res.status(416).json({ error: "Requested range not satisfiable." });
    }

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);

    return fs.createReadStream(realPath, { start, end }).pipe(res);
  } catch (err) {
    next(err);
  }
});

// ── GET /files/info ───────────────────────────────────────────────────────────
// Get metadata for a single file.
// Query: ?path=/some/dir/file.pdf
router.get("/info", authenticate, async (req, res, next) => {
  const rawPath = req.query.path;
  if (!rawPath) return res.status(400).json({ error: "Query param 'path' is required." });

  const virtualPath = sanitizePath(rawPath);
  const appId       = req.app_ctx.id;

  try {
    const fileRecord = await prisma.file.findUnique({
      where: { appId_fullPath: { appId, fullPath: virtualPath } },
    });

    if (!fileRecord) {
      return res.status(404).json({ error: "File not found.", path: virtualPath });
    }

    return res.json({
      id:         fileRecord.id,
      name:       fileRecord.name,
      path:       fileRecord.fullPath,
      directory:  fileRecord.dirPath,
      size:       formatBytes(fileRecord.size),
      size_bytes: fileRecord.size,
      mime_type:  fileRecord.mimeType,
      created_at: fileRecord.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /files ────────────────────────────────────────────────────────────────
// List all files for the app (paginated).
// Query: ?dir=/some/dir  ?page=1  ?limit=50  ?search=report
router.get("/", authenticate, async (req, res, next) => {
  const appId  = req.app_ctx.id;
  const dir    = req.query.dir    ? sanitizePath(req.query.dir) : null;
  const search = req.query.search || null;
  const page   = Math.max(1, parseInt(req.query.page  || "1",  10));
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
  const offset = (page - 1) * limit;

  try {
    const where = {
      appId,
      ...(dir    ? { dirPath: dir } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    };

    const [total, files] = await Promise.all([
      prisma.file.count({ where }),
      prisma.file.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
    ]);

    return res.json({
      page,
      limit,
      total,
      total_pages:  Math.ceil(total / limit),
      files: files.map((f) => ({
        id:         f.id,
        name:       f.name,
        path:       f.fullPath,
        directory:  f.dirPath,
        size:       formatBytes(f.size),
        size_bytes: f.size,
        mime_type:  f.mimeType,
        created_at: f.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /files ─────────────────────────────────────────────────────────────
// Delete a file permanently.
// Body: { path: "/some/dir/file.pdf" }
router.delete("/", authenticate, async (req, res, next) => {
  const rawPath = req.body.path;
  if (!rawPath) return res.status(400).json({ error: "Provide body: { path: '/path/to/file.ext' }" });

  const virtualPath = sanitizePath(rawPath);
  const appId       = req.app_ctx.id;

  try {
    const fileRecord = await prisma.file.findUnique({
      where: { appId_fullPath: { appId, fullPath: virtualPath } },
    });

    if (!fileRecord) {
      return res.status(404).json({ error: "File not found.", path: virtualPath });
    }

    // Delete from disk
    try {
      const realPath = resolvePath(appId, virtualPath);
      if (fs.existsSync(realPath)) fs.unlinkSync(realPath);
    } catch (_) {}

    // Delete from DB
    await prisma.file.delete({ where: { id: fileRecord.id } });

    // Reclaim storage
    await prisma.$executeRaw`UPDATE apps SET storage_used = GREATEST(0, storage_used - ${fileRecord.size}) WHERE id = ${appId}`;

    return res.json({
      message:           "File deleted.",
      file:              fileRecord.name,
      path:              virtualPath,
      storage_reclaimed: formatBytes(fileRecord.size),
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /files/batch ───────────────────────────────────────────────────────
// Batch delete multiple files.
// Body: { paths: ["/a/file1.pdf", "/b/file2.jpg"] }
router.delete("/batch", authenticate, async (req, res, next) => {
  const { paths } = req.body;
  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "Provide body: { paths: ['/path1', '/path2'] }" });
  }

  const appId        = req.app_ctx.id;
  const deleted      = [];
  const failed       = [];
  let reclaimedBytes = 0;

  try {
    for (const rawPath of paths) {
      const virtualPath = sanitizePath(rawPath);
      const fileRecord  = await prisma.file.findUnique({
        where: { appId_fullPath: { appId, fullPath: virtualPath } },
      });

      if (!fileRecord) {
        failed.push({ path: virtualPath, error: "File not found." });
        continue;
      }

      try {
        const realPath = resolvePath(appId, virtualPath);
        if (fs.existsSync(realPath)) fs.unlinkSync(realPath);
      } catch (_) {}

      await prisma.file.delete({ where: { id: fileRecord.id } });
      reclaimedBytes += fileRecord.size;
      deleted.push({ path: virtualPath, name: fileRecord.name });
    }

    if (reclaimedBytes > 0) {
      await prisma.$executeRaw`UPDATE apps SET storage_used = GREATEST(0, storage_used - ${reclaimedBytes}) WHERE id = ${appId}`;
    }

    return res.status(207).json({
      message:           `${deleted.length} deleted, ${failed.length} failed.`,
      deleted,
      failed,
      storage_reclaimed: formatBytes(reclaimedBytes),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
