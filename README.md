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

All endpoints except `POST /apps/create` require:

```
Authorization: Bearer <your_access_token>
```

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
| 413    | File too large or storage quota exceeded     |
| 500    | Internal server error                        |

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
pm2 startup

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
│   │   └── files.js          # /files endpoints
│   └── utils/
│       └── storage.js        # Path resolution, sanitization, helpers
├── storage/                  # Runtime: per-app file storage (gitignored)
├── .env                      # Runtime: config (gitignored)
├── .env.example              # Committed config template
└── package.json
```
