-- ══════════════════════════════════════════════════════════════
-- ELYSIUM WORKS — D1 Database Schema  v4
-- Run with: wrangler d1 execute elysium-works-db --file=schema.sql --remote
-- ══════════════════════════════════════════════════════════════

-- ── CLIENTS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── PROJECTS (home inspections) ───────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                          TEXT PRIMARY KEY,
  client_id                   TEXT REFERENCES clients(id),
  property_address            TEXT NOT NULL,
  inspection_date             DATETIME,
  status                      TEXT DEFAULT 'Draft' CHECK(status IN ('Draft','Completed','Sent')),
  total_estimated_repair_cost REAL DEFAULT 0,
  created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── INSPECTION ITEMS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspection_items (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_name      TEXT NOT NULL,
  item_name      TEXT NOT NULL,
  status         TEXT CHECK(status IN ('Pass','Fail','Monitor','NA')),
  notes          TEXT,
  photo_url      TEXT,
  estimated_cost REAL DEFAULT 0
);

-- ── CRM CLIENTS (blob store for full client record) ────────────
-- Stores the full client JSON blob (offline-first sync model)
CREATE TABLE IF NOT EXISTS clients_crm (
  id         TEXT PRIMARY KEY,
  data       TEXT,        -- full JSON blob
  updated_at INTEGER      -- epoch ms for last-write-wins
);

-- ── JOBS (v4 — construction quotes, appliance, handyman etc.) ──
-- One client can have many jobs across different types.
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients_crm(id) ON DELETE CASCADE,
  client_name  TEXT,                    -- denormalised for fast display
  type         TEXT NOT NULL,           -- quote | appliance | handyman | inspection | patio | other
  ref          TEXT UNIQUE,             -- e.g. EW-Q-26-001
  description  TEXT,
  address      TEXT,
  visit_date   DATETIME,
  status       TEXT DEFAULT 'enquiry',  -- follows STAGES pipeline
  sketch_url   TEXT,                    -- R2 / B2 path for sketch PNG
  data         TEXT,                    -- full job JSON blob (quote, measurements, photos, notes)
  updated_at   INTEGER,                 -- epoch ms for last-write-wins
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── QUOTE LINE ITEMS (normalised for reporting) ───────────────
-- Populated when a job is synced to cloud for reporting purposes.
CREATE TABLE IF NOT EXISTS quote_line_items (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description TEXT,
  qty         REAL DEFAULT 1,
  unit        TEXT DEFAULT 'each',
  unit_price  REAL DEFAULT 0,
  line_total  REAL DEFAULT 0
);

-- ── ENQUIRIES (from public website form) ──────────────────────
CREATE TABLE IF NOT EXISTS enquiries (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  phone      TEXT,
  area       TEXT,
  job_type   TEXT,
  source     TEXT DEFAULT 'Website',
  imported   INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_client   ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status   ON projects(status);
CREATE INDEX IF NOT EXISTS idx_items_project     ON inspection_items(project_id);
CREATE INDEX IF NOT EXISTS idx_items_zone        ON inspection_items(project_id, zone_name);
CREATE INDEX IF NOT EXISTS idx_jobs_client       ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status       ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type         ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_enquiries_phone   ON enquiries(phone);
