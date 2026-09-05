-- ══════════════════════════════════════════════════════════════
-- ELYSIUM WORKS — D1 Database Schema
-- Run with: wrangler d1 execute elysium-works-db --file=schema.sql
-- ══════════════════════════════════════════════════════════════

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Projects (inspections) table
CREATE TABLE IF NOT EXISTS projects (
  id                          TEXT PRIMARY KEY,
  client_id                   TEXT REFERENCES clients(id),
  property_address            TEXT NOT NULL,
  inspection_date             DATETIME,
  status                      TEXT DEFAULT 'Draft' CHECK(status IN ('Draft','Completed','Sent')),
  total_estimated_repair_cost REAL DEFAULT 0,
  created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Inspection items table
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

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_projects_client    ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status    ON projects(status);
CREATE INDEX IF NOT EXISTS idx_items_project      ON inspection_items(project_id);
CREATE INDEX IF NOT EXISTS idx_items_zone         ON inspection_items(project_id, zone_name);
