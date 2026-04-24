// ─── Directories Routes ───────────────────────────────────────────────────────
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path  = require("path");
const fs    = require("fs");
const prisma = require("../db");
const { authenticate } = require("../middleware/auth");
const { resolvePath, ensureDir, sanitizePath } = require("../utils/storage");

const router = express.Router();

// ── POST /dirs/create ─────────────────────────────────────────────────────────
// Create a directory (and all parent dirs) at the given virtual path
router.post("/create", authenticate, async (req, res, next) => {
  const { path: rawPath } = req.body;

  if (!rawPath || rawPath.trim() === "/" || rawPath.trim() === "") {
    return res.status(400).json({ error: "Provide a non-root path to create, e.g. /documents/reports" });
  }

  const virtualPath = sanitizePath(rawPath);
  const appId       = req.app_ctx.id;

  try {
    // Prevent duplicate
    const exists = await prisma.directory.findUnique({
      where: { appId_path: { appId, path: virtualPath } },
    });

    if (exists) {
      return res.status(409).json({ error: "Directory already exists.", path: virtualPath });
    }

    // Create on disk
    const realPath = resolvePath(appId, virtualPath);
    ensureDir(realPath);

    // Register all ancestor dirs in DB (ensures they are discoverable)
    const parts = virtualPath.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const ancestorPath = "/" + parts.slice(0, i + 1).join("/");
      const alreadyExists = await prisma.directory.findUnique({
        where: { appId_path: { appId, path: ancestorPath } },
      });
      if (!alreadyExists) {
        await prisma.directory.create({
          data: { id: uuidv4(), appId, path: ancestorPath },
        });
      }
    }

    const record = await prisma.directory.findUnique({
      where: { appId_path: { appId, path: virtualPath } },
    });

    return res.status(201).json({
      message: "Directory created.",
      directory: {
        id:         record.id,
        path:       record.path,
        created_at: record.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /dirs ─────────────────────────────────────────────────────────────────
// List contents of a directory (files + subdirs).
// Query: ?path=/some/dir  (defaults to root "/")
router.get("/", authenticate, async (req, res, next) => {
  const rawPath     = req.query.path || "/";
  const virtualPath = sanitizePath(rawPath);
  const appId       = req.app_ctx.id;

  try {
    // If not root, verify directory exists
    if (virtualPath !== "/") {
      const dirExists = await prisma.directory.findUnique({
        where: { appId_path: { appId, path: virtualPath } },
      });
      if (!dirExists) {
        return res.status(404).json({ error: "Directory not found.", path: virtualPath });
      }
    }

    // Get immediate subdirectories
    const allDirs = await prisma.directory.findMany({
      where: { appId },
      orderBy: { path: "asc" },
      select: { path: true },
    });

    const subdirs = allDirs
      .map((d) => d.path)
      .filter((p) => {
        if (virtualPath === "/") {
          // Only top-level dirs (one segment)
          return p.split("/").filter(Boolean).length === 1;
        } else {
          // Direct children of virtualPath
          const prefix = virtualPath + "/";
          if (!p.startsWith(prefix)) return false;
          const remainder = p.slice(prefix.length);
          return remainder.length > 0 && !remainder.includes("/");
        }
      })
      .map((p) => ({ type: "directory", name: path.basename(p), path: p }));

    // Get files in this directory
    const files = await prisma.file.findMany({
      where: { appId, dirPath: virtualPath },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, fullPath: true, size: true, mimeType: true, createdAt: true },
    });

    const fileItems = files.map((f) => ({
      type:       "file",
      id:         f.id,
      name:       f.name,
      path:       f.fullPath,
      size_bytes: f.size,
      size:       formatBytes(f.size),
      mime_type:  f.mimeType,
      created_at: f.createdAt,
    }));

    return res.json({
      path:  virtualPath,
      total: subdirs.length + fileItems.length,
      items: [...subdirs, ...fileItems],
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /dirs/tree ────────────────────────────────────────────────────────────
// Full recursive tree of the entire app's storage
router.get("/tree", authenticate, async (req, res, next) => {
  const appId = req.app_ctx.id;

  try {
    const allDirs = await prisma.directory.findMany({
      where: { appId },
      orderBy: { path: "asc" },
      select: { path: true },
    });

    const allFiles = await prisma.file.findMany({
      where: { appId },
      orderBy: { fullPath: "asc" },
      select: { name: true, fullPath: true, dirPath: true, size: true, mimeType: true, createdAt: true },
    });

    const dirPaths = allDirs.map((d) => d.path);

    function buildTree(currentPath) {
      const depth     = currentPath === "/" ? 0 : currentPath.split("/").filter(Boolean).length;
      const childDirs = dirPaths.filter((p) => {
        const parts = p.split("/").filter(Boolean);
        if (parts.length !== depth + 1) return false;
        return currentPath === "/" || p.startsWith(currentPath + "/");
      });

      const filesHere = allFiles
        .filter((f) => f.dirPath === currentPath)
        .map((f) => ({
          type:       "file",
          name:       f.name,
          path:       f.fullPath,
          size:       formatBytes(f.size),
          size_bytes: f.size,
          mime_type:  f.mimeType,
          created_at: f.createdAt,
        }));

      return {
        type:     "directory",
        path:     currentPath,
        name:     currentPath === "/" ? "(root)" : path.basename(currentPath),
        children: [
          ...childDirs.map((d) => buildTree(d)),
          ...filesHere,
        ],
      };
    }

    return res.json(buildTree("/"));
  } catch (err) {
    next(err);
  }
});

// ── DELETE /dirs ──────────────────────────────────────────────────────────────
// Delete a directory and ALL its contents (recursive). Requires confirm flag.
router.delete("/", authenticate, async (req, res, next) => {
  const { path: rawPath, confirm } = req.body;
  if (!rawPath) return res.status(400).json({ error: "Provide a path to delete." });

  const virtualPath = sanitizePath(rawPath);
  const appId       = req.app_ctx.id;

  if (virtualPath === "/") {
    return res.status(400).json({ error: "Cannot delete root directory." });
  }
  if (confirm !== "DELETE_DIRECTORY") {
    return res.status(400).json({
      error: 'Set body { "confirm": "DELETE_DIRECTORY" } to confirm recursive deletion.',
    });
  }

  try {
    const dirExists = await prisma.directory.findUnique({
      where: { appId_path: { appId, path: virtualPath } },
    });
    if (!dirExists) {
      return res.status(404).json({ error: "Directory not found.", path: virtualPath });
    }

    // Find all files in this dir and its subdirs
    const filesToDelete = await prisma.file.findMany({
      where: {
        appId,
        OR: [
          { dirPath: virtualPath },
          { dirPath: { startsWith: virtualPath + "/" } },
        ],
      },
    });

    // Reclaim storage
    const reclaimedBytes = filesToDelete.reduce((sum, f) => sum + f.size, 0);

    // Delete physical files
    for (const f of filesToDelete) {
      try {
        const realPath = resolvePath(appId, f.fullPath);
        if (fs.existsSync(realPath)) fs.unlinkSync(realPath);
      } catch (_) {}
    }

    // Delete physical directory
    const realDirPath = resolvePath(appId, virtualPath);
    if (fs.existsSync(realDirPath)) fs.rmSync(realDirPath, { recursive: true, force: true });

    // Delete DB records
    await prisma.file.deleteMany({
      where: {
        appId,
        OR: [
          { dirPath: virtualPath },
          { dirPath: { startsWith: virtualPath + "/" } },
        ],
      },
    });
    await prisma.directory.deleteMany({
      where: {
        appId,
        OR: [
          { path: virtualPath },
          { path: { startsWith: virtualPath + "/" } },
        ],
      },
    });

    // Update storage counter
    if (reclaimedBytes > 0) {
      await prisma.$executeRaw`UPDATE apps SET storage_used = GREATEST(0, storage_used - ${reclaimedBytes}) WHERE id = ${appId}`;
    }

    return res.json({
      message:           "Directory and all contents deleted.",
      path:              virtualPath,
      files_deleted:     filesToDelete.length,
      storage_reclaimed: formatBytes(reclaimedBytes),
    });
  } catch (err) {
    next(err);
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

module.exports = router;
