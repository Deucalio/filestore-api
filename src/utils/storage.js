// ─── Storage Utilities ────────────────────────────────────────────────────────
const fs    = require("fs");
const path  = require("path");
const mime  = require("mime-types");

const STORAGE_ROOT = path.resolve(
  process.env.STORAGE_ROOT || path.join(__dirname, "../../storage")
);

/** Resolve a virtual user path to a real FS path scoped to the app */
function resolvePath(appId, virtualPath) {
  // Normalise and strip leading slash so we stay inside app root
  const clean = path.normalize(virtualPath || "/").replace(/^\/+/, "");
  const resolved = path.join(STORAGE_ROOT, appId, clean);

  // Security: ensure we never escape the app's sandbox
  const appRoot = path.join(STORAGE_ROOT, appId);
  if (!resolved.startsWith(appRoot)) {
    throw new Error("Path traversal detected.");
  }
  return resolved;
}

/** Ensure a directory exists (recursive) */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/** Pretty-print bytes */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/** Recursively get total size of a directory */
function dirSize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

/** Sanitize a virtual path (no .. traversal, always starts with /) */
function sanitizePath(p) {
  if (!p || p.trim() === "") return "/";
  const normalized = path.posix.normalize("/" + p);
  if (!normalized.startsWith("/")) return "/";
  return normalized;
}

module.exports = {
  STORAGE_ROOT,
  resolvePath,
  ensureDir,
  formatBytes,
  dirSize,
  sanitizePath,
};
