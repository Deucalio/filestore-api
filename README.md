# FileStore API

A self-hosted, multi-tenant REST API for file management. Each application registers once, gets a unique `access_token`, and gains full control over its own isolated storage space with a plan-based quota.

---

## Stack

- **Runtime:** Node.js 22+
- **Framework:** Express.js
- **File handling:** Multer (memory → disk streaming)
- **Database:** PostgreSQL via Prisma 6
- **ORM:** Prisma Client
- **Storage:** Local filesystem, scoped per app

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/you/filestore-api.git
cd filestore-api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env: set PORT, STORAGE_ROOT, and DATABASE_URL
```

`.env` example:
```
PORT=3000
STORAGE_ROOT=./storage
DATABASE_URL=postgresql://user:password@localhost:5432/filestore
```

### 3. Generate Prisma client

```bash
npx prisma generate
```

### 4. Run database migrations

```bash
npx prisma migrate dev --name init
```

### 5. Run

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

The API will be live at `http://localhost:3000`

---

## Plans

| Plan       | Storage |
|------------|---------|
| basic      | 10 GB   |
| pro        | 100 GB  |
| enterprise | 300 GB  |

---

## Authentication

All endpoints require:

```
Authorization: Bearer <your_access_token>
```

**Exceptions (public, no token):**

- `POST /apps/create` — you need it to obtain a token in the first place.
- `GET /files/preview?path=...` — public **image** preview, so files can be embedded directly in `<img src="...">` tags (an `<img>` tag cannot send an `Authorization` header).
- `GET /files/stream?path=...` — public **video/audio** stream, so media can be embedded directly in `<video src="...">` / `<audio src="...">` tags (these tags also cannot send an `Authorization` header).

---

## Serving files: which route should I use?

There are three ways to get bytes back out, depending on the file and where it's going:

| You want to…                                   | Use                      | Auth?       | Notes                                                                 |
|------------------------------------------------|--------------------------|-------------|----------------------------------------------------------------------|
| Show an **image** in a web page (`<img src>`)  | `GET /files/preview`     | ❌ Public   | Returns raw image bytes inline. Image MIME types only.               |
| Play a **video/audio** file (`<video src>`)    | `GET /files/stream`      | ❌ Public   | Range-aware (`206`), so **seeking** works. Video/audio MIME only.    |
| Download **any** file (esp. private documents) | `GET /files/download`    | ✅ Bearer   | Forces a download (`Content-Disposition: attachment`). Token-secured.|

**Rules of thumb:**

- **Images → `/preview`**, video/audio → `/stream`. Both are public-by-path so a browser tag can load them with no token.
- **Everything sensitive (PDFs, CSVs, private docs) → `/download`**, which requires the Bearer token and is never publicly addressable.
- **One request = one file.** There is no endpoint that returns multiple images/videos' bytes in a single response — each `<img>`/`<video>` makes its own request, and the browser fires them in parallel automatically. To render a gallery, list the files first (`GET /files?dir=...`) then build one `/files/preview?path=` URL per `<img>`.

---

## API Reference

---

### Apps

#### `POST /apps/create`
Create a new app and receive your `access_token`.

**No auth required.**

**Request body:**
```json
{
  "name": "My App",
  "plan": "pro"
}
```

**Response `201`:**
```json
{
  "message": "App created successfully. Keep your access_token safe. It cannot be recovered.",
  "app": {
    "id": "36887574-66d6-4786-...",
    "name": "My App",
    "plan": "pro",
    "storage_limit": "100.00 GB",
    "storage_used": "0 B",
    "access_token": "fst_d39c8efd220444379d419dd1eff631d7",
    "created_at": "2026-04-22T11:30:54.148Z"
  }
}
```

> Store `access_token` somewhere safe. It is shown once and cannot be retrieved again.

---

#### `GET /apps/me`
Get your app info and storage stats.

**Response `200`:**
```json
{
  "id": "36887574-...",
  "name": "My App",
  "plan": "pro",
  "storage_limit": "100.00 GB",
  "storage_limit_bytes": 107374182400,
  "storage_used": "45.23 MB",
  "storage_used_bytes": 47448064,
  "storage_available": "99.96 GB",
  "storage_available_bytes": 107326734336,
  "usage_percent": "0.04%",
  "created_at": "2026-04-22 11:30:24"
}
```

---

#### `DELETE /apps/me`
Permanently delete your app and all of its files and directories. Irreversible.

**Request body:**
```json
{
  "confirm": "DELETE_MY_APP"
}
```

**Response `200`:**
```json
{
  "message": "App and all associated data permanently deleted."
}
```

---

### Directories

#### `POST /dirs/create`
Create a directory. Parent directories are created automatically.

**Request body:**
```json
{
  "path": "/documents/reports/2026"
}
```

**Response `201`:**
```json
{
  "message": "Directory created.",
  "directory": {
    "id": "4c32e280-...",
    "path": "/documents/reports/2026",
    "created_at": "2026-04-22 11:30:30"
  }
}
```

---

#### `GET /dirs?path=/`
List the immediate contents (files and subdirectories) of a directory.

**Query params:**

| Param | Default | Description            |
|-------|---------|------------------------|
| path  | /       | Virtual directory path |

**Response `200`:**
```json
{
  "path": "/documents",
  "total": 3,
  "items": [
    { "type": "directory", "name": "reports", "path": "/documents/reports" },
    { "type": "file", "id": "abc123", "name": "readme.txt", "path": "/documents/readme.txt", "size": "16.00 B", "size_bytes": 16, "mime_type": "text/plain", "created_at": "..." }
  ]
}
```

---

#### `GET /dirs/tree`
Get a full recursive tree of your entire storage.

**Response `200`:**
```json
{
  "type": "directory",
  "path": "/",
  "name": "(root)",
  "children": [
    {
      "type": "directory",
      "path": "/documents",
      "name": "documents",
      "children": [
        {
          "type": "directory",
          "path": "/documents/reports",
          "name": "reports",
          "children": [
            { "type": "file", "name": "q1.pdf", "path": "/documents/reports/q1.pdf", "size": "1.20 MB", ... }
          ]
        }
      ]
    }
  ]
}
```

---

#### `DELETE /dirs`
Delete a directory and all of its contents recursively. Irreversible.

**Request body:**
```json
{
  "path": "/documents/old-reports",
  "confirm": "DELETE_DIRECTORY"
}
```

**Response `200`:**
```json
{
  "message": "Directory and all contents deleted.",
  "path": "/documents/old-reports",
  "files_deleted": 12,
  "storage_reclaimed": "45.20 MB"
}
```

---

### Files

#### `POST /files/upload`
Upload a single file using `multipart/form-data`.

**Form fields:**

| Field | Required | Description                         |
|-------|----------|-------------------------------------|
| file  | Yes      | The file to upload                  |
| path  | No       | Target directory (default: `/`)     |

**cURL example:**
```bash
curl -X POST http://localhost:3000/files/upload \
  -H "Authorization: Bearer fst_xxxx" \
  -F "file=@/path/to/photo.jpg" \
  -F "path=/images/products"
```

**Response `201`:**
```json
{
  "message": "File uploaded successfully.",
  "file": {
    "id": "f1a2b3c4-...",
    "name": "photo.jpg",
    "path": "/images/products/photo.jpg",
    "directory": "/images/products",
    "size": "2.34 MB",
    "size_bytes": 2453678,
    "mime_type": "image/jpeg",
    "created_at": "2026-04-22T12:00:00.000Z"
  }
}
```

---

#### `POST /files/batch-upload`
Upload multiple files at once. All go to the same target directory.

**Form fields:**

| Field    | Required | Description                              |
|----------|----------|------------------------------------------|
| files[]  | Yes      | One or more files (repeat field)         |
| path     | No       | Target directory (default: `/`)          |

**cURL example:**
```bash
curl -X POST http://localhost:3000/files/batch-upload \
  -H "Authorization: Bearer fst_xxxx" \
  -F "files[]=@/path/to/report.pdf" \
  -F "files[]=@/path/to/data.csv" \
  -F "files[]=@/path/to/notes.txt" \
  -F "path=/documents/q1"
```

**Response `207` (Multi-Status):**
```json
{
  "message": "3 uploaded, 0 failed.",
  "uploaded": [
    { "status": "uploaded", "id": "...", "name": "report.pdf", "path": "/documents/q1/report.pdf", "size": "1.20 MB", "mime_type": "application/pdf" },
    { "status": "uploaded", "id": "...", "name": "data.csv",   "path": "/documents/q1/data.csv",   "size": "4.50 KB", "mime_type": "text/csv" },
    { "status": "uploaded", "id": "...", "name": "notes.txt",  "path": "/documents/q1/notes.txt",  "size": "512 B",   "mime_type": "text/plain" }
  ],
  "failed": [],
  "total_uploaded": 3,
  "total_failed": 0
}
```

---

#### `GET /files`
List all files for your app. Supports filtering, search, and pagination.

**Query params:**

| Param  | Default | Description                              |
|--------|---------|------------------------------------------|
| dir    | (all)   | Filter by directory path                 |
| search | (none)  | Filter by filename (partial match)       |
| page   | 1       | Page number                              |
| limit  | 50      | Results per page (max 100)               |

**Examples:**
```bash
# All files
GET /files

# Files in a specific directory
GET /files?dir=/documents/reports

# Search by name
GET /files?search=invoice

# Paginate
GET /files?page=2&limit=20
```

**Response `200`:**
```json
{
  "page": 1,
  "limit": 50,
  "total": 142,
  "total_pages": 3,
  "files": [
    {
      "id": "...",
      "name": "invoice-march.pdf",
      "path": "/documents/invoices/invoice-march.pdf",
      "directory": "/documents/invoices",
      "size": "340.00 KB",
      "size_bytes": 348160,
      "mime_type": "application/pdf",
      "created_at": "2026-03-15 09:12:44"
    }
  ]
}
```

---

#### `GET /files/info?path=`
Get metadata for a single file.

**Query params:**

| Param | Required | Description          |
|-------|----------|----------------------|
| path  | Yes      | Full virtual path    |

**Example:**
```bash
GET /files/info?path=/documents/reports/q1.pdf
```

**Response `200`:**
```json
{
  "id": "f1a2b3c4-...",
  "name": "q1.pdf",
  "path": "/documents/reports/q1.pdf",
  "directory": "/documents/reports",
  "size": "1.20 MB",
  "size_bytes": 1258291,
  "mime_type": "application/pdf",
  "created_at": "2026-04-22 10:00:00"
}
```

---

#### `GET /files/download?path=`
Download or stream a file directly. Sets appropriate `Content-Type` and `Content-Disposition` headers.

**Query params:**

| Param | Required | Description          |
|-------|----------|----------------------|
| path  | Yes      | Full virtual path    |

**Example:**
```bash
# curl: save to local file
curl -O -J "http://localhost:3000/files/download?path=/images/logo.png" \
  -H "Authorization: Bearer fst_xxxx"

# Browser: triggers download
GET /files/download?path=/documents/q1.pdf
```

---

#### `DELETE /files`
Delete a single file permanently.

**Request body:**
```json
{
  "path": "/documents/reports/old.pdf"
}
```

**Response `200`:**
```json
{
  "message": "File deleted.",
  "file": "old.pdf",
  "path": "/documents/reports/old.pdf",
  "storage_reclaimed": "1.20 MB"
}
```

---

#### `DELETE /files/batch`
Delete multiple files in one request.

**Request body:**
```json
{
  "paths": [
    "/documents/old-report.pdf",
    "/images/temp-photo.jpg",
    "/data/draft.csv"
  ]
}
```

**Response `207`:**
```json
{
  "message": "3 deleted, 0 failed.",
  "deleted": [
    { "path": "/documents/old-report.pdf", "name": "old-report.pdf" },
    { "path": "/images/temp-photo.jpg",    "name": "temp-photo.jpg" },
    { "path": "/data/draft.csv",           "name": "draft.csv" }
  ],
  "failed": [],
  "storage_reclaimed": "3.80 MB"
}
```

---

### Preview (public, no token)

Token-less preview of **image files only**, designed to be embedded directly in a website via `<img src="...">`. Files are addressed by their virtual `path` (same path used everywhere else in the API). Non-image files are rejected.

> **Multi-tenant note:** without a token the app can't be inferred from the request, so by default the first file matching the path (across all apps) is served. If multiple apps may share path names, scope the lookup by adding `&app=<appId>`.

#### `GET /files/preview?path=`
Returns the **raw image bytes** inline (correct `Content-Type`, `Content-Disposition: inline`, cached 1 day). Use the URL directly as an image source.

**Query params:**

| Param | Required | Description                                   |
|-------|----------|-----------------------------------------------|
| path  | Yes      | Full virtual path of the image                |
| app   | No       | App id to scope the lookup (disambiguation)   |

**Example:**
```html
<img src="https://file-upload.nakson.services/files/preview?path=/ticketing/manual-pump.png" />
```

```bash
# Fetch the raw image bytes (no Authorization header needed)
curl -O -J "http://localhost:3000/files/preview?path=/images/logo.png"
```

Responses: `404` (not found), `415` (file is not an image), `410` (record exists but file missing on disk).

> **Rendering many images?** There's no batch-bytes endpoint — one request returns one image. List the directory first (`GET /files?dir=...`), then render one `<img src="/files/preview?path=...">` per result; the browser fetches them in parallel.

---

### Streaming (public, no token)

Token-less streaming of **video/audio files only**, designed to be embedded directly via `<video src="...">` or `<audio src="...">`. Like `/preview`, files are addressed by their virtual `path`, and the same multi-tenant note applies (scope with `&app=<appId>` when paths may collide across apps). Non-media files are rejected with `415` — use `/download` for those.

The key difference from `/preview` and `/download` is **HTTP Range support**. The route advertises `Accept-Ranges: bytes`, and when the browser sends a `Range` header it replies with `206 Partial Content` and just the requested byte slice. This is what makes the scrubber/**seeking** work and what Safari/iOS require to start playback at all. With no `Range` header it falls back to a normal `200` full-file stream.

#### `GET /files/stream?path=`
Streams the **raw media bytes** inline (correct `Content-Type`, `Accept-Ranges: bytes`, cached 1 day; `206` for range requests, `200` otherwise).

**Query params:**

| Param | Required | Description                                   |
|-------|----------|-----------------------------------------------|
| path  | Yes      | Full virtual path of the video/audio file     |
| app   | No       | App id to scope the lookup (disambiguation)   |

**Embed in a page:**
```html
<video controls src="https://file-upload.nakson.services/files/stream?path=/device-videos/abc/clip.mp4"></video>
```

**cURL — play / save the whole file:**
```bash
curl --get "http://localhost:3000/files/stream" \
  --data-urlencode "path=/device-videos/abc/clip.mp4" \
  -o clip.mp4
```

**cURL — verify Range works (request the first 1 MB, print response headers):**
```bash
curl -r 0-1048575 -D - --get "http://localhost:3000/files/stream" \
  --data-urlencode "path=/device-videos/abc/clip.mp4" \
  -o first_mb.part
```
Expected response headers:
```
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-1048575/6367371
Content-Length: 1048576
```

> On **Windows PowerShell**, `curl` is an alias for `Invoke-WebRequest`. Use `curl.exe` so the flags above work.

Responses: `206` (partial, range request), `200` (full file), `400` (missing `path`), `404` (not found), `415` (not video/audio), `410` (record exists but file missing on disk), `416` (range not satisfiable / malformed).

> **Embedding behind a proxy:** if another service fronts this route (e.g. `/api/device-video/:id` that proxies here), it **must forward the incoming `Range` header** and pass the upstream `206` + `Content-Range` back to the client — otherwise seeking breaks again at the proxy layer.

---

## Error Responses

All errors follow this shape:

```json
{
  "error": "Human-readable error message."
}
```

| Status | Meaning                                      |
|--------|----------------------------------------------|
| 400    | Bad request (missing or invalid fields)      |
| 401    | Missing or invalid access token              |
| 404    | File or directory not found                  |
| 409    | Conflict (file or directory already exists)  |
| 410    | File record exists but physical file is gone |
| 413    | File too large or storage quota exceeded     |
| 415    | Unsupported media type (preview: not an image; stream: not video/audio) |
| 416    | Requested range not satisfiable (stream)     |
| 500    | Internal server error                        |

> `/files/stream` also returns the success codes `200` (full file) and `206` (partial content for a range request).

---

## Key Rules

- Files **cannot be updated** in place. Delete the old one and upload the new version.
- File paths are **scoped per app**. Two apps can have files at `/logo.png` with no conflict.
- Uploading a file to a path where a file already exists returns `409`.
- Paths are always **Unix-style** (`/dir/subdir/file.ext`).
- Path traversal attempts (`../`) are automatically blocked.
- `DELETE /dirs` and `DELETE /apps/me` require a `confirm` string to prevent accidents.

---

## VPS Deployment

```bash
# Install PM2
npm install -g pm2

# Start
pm2 start "npm start" --name filestore-api

# Auto-restart on reboot
pm2 save
pm2 restart filestore-api

# Nginx reverse proxy (example)
# proxy_pass http://127.0.0.1:3000;
```

> Set `STORAGE_ROOT` to a path on a large disk, e.g. `/mnt/data/filestore`

---

## Project Structure

```
filestore-api/
├── prisma/
│   └── schema.prisma         # Prisma schema (App, File, Directory models)
├── src/
│   ├── index.js              # Express app, middleware, boot
│   ├── db.js                 # Prisma client singleton
│   ├── middleware/
│   │   └── auth.js           # Bearer token auth + plan limits
│   ├── routes/
│   │   ├── apps.js           # /apps endpoints
│   │   ├── dirs.js           # /dirs endpoints
│   │   └── files.js          # /files endpoints (incl. public /files/preview + /files/stream)
│   └── utils/
│       └── storage.js        # Path resolution, sanitization, helpers
├── storage/                  # Runtime: per-app file storage (gitignored)
├── .env                      # Runtime: config (gitignored)
├── .env.example              # Committed config template
└── package.json
```
