-- =============================================================================
-- Capacity Model Database Schema
-- SQLite — created by db/init-db.js
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- PRODUCT CATALOG
-- Source: Item Info tab
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  item_number   TEXT PRIMARY KEY,
  description   TEXT,
  material_type TEXT,
  color         TEXT,
  item_type_detail TEXT,   -- 'Type' column in Item Info (e.g., Nonbraid, Over Extruded...)
  od_coat       TEXT,
  id_coat       TEXT,
  id_size       REAL,
  od_size       REAL,
  wall          REAL,
  fg_length     REAL,
  pull_length   REAL,
  im            TEXT,
  customer      TEXT,
  parent_company TEXT,
  value_stream  TEXT,      -- PI, PTFE, Ex, PL, AC/DC, Micro Cath
  product_family TEXT,
  uom           TEXT,
  planner       TEXT,
  status        TEXT,
  item_type     TEXT       -- e.g. 'INTER ORG MAKE'
);

-- ---------------------------------------------------------------------------
-- PROCESSING STANDARDS (consolidated Machine + Draw + Finishing)
-- Source: Machine Standards, Draw Standards, Finishing Standards tabs
-- All values in SECONDS per unit of finished output
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_standards (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_number     TEXT NOT NULL,
  sequence        TEXT NOT NULL,   -- e.g. 'Draw', 'Braid', 'Long Pull', 'Inspection'
  standard_type   TEXT NOT NULL,   -- 'machine', 'draw', 'finishing'
  seconds_per_unit REAL NOT NULL,
  UNIQUE(item_number, sequence)
);

CREATE INDEX IF NOT EXISTS idx_item_standards_item ON item_standards(item_number);
CREATE INDEX IF NOT EXISTS idx_item_standards_seq  ON item_standards(sequence);

-- ---------------------------------------------------------------------------
-- MANUFACTURING YIELDS
-- Source: MFG Yields tab
-- One yield factor per item (applies to all sequences for that item)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yields (
  item_number TEXT PRIMARY KEY,
  yield       REAL NOT NULL,   -- 0.0–1.0 (e.g. 0.74 = 74% yield)
  description TEXT             -- component description from the tab
);

-- ---------------------------------------------------------------------------
-- CURRENT CAPACITY
-- Source: Current Capacity tab
-- Headcount (People) or machine heads (Heads) per Process × Value Stream
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capacity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  process      TEXT NOT NULL,
  value_stream TEXT NOT NULL,
  capacity     REAL NOT NULL DEFAULT 0,
  uom          TEXT NOT NULL DEFAULT 'People',  -- 'People' or 'Heads'
  department   TEXT,                            -- 'Finishing' or 'Machines'
  subcategory  TEXT,                            -- 'Other', 'Non-Oven', 'Oven'
  UNIQUE(process, value_stream)
);

CREATE INDEX IF NOT EXISTS idx_capacity_process ON capacity(process);

-- ---------------------------------------------------------------------------
-- WORKING DAYS PER MONTH
-- Source: Days in Month tab
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS days_in_month (
  schedule TEXT NOT NULL,    -- '5 Day' or '7 Day'
  month    TEXT NOT NULL,    -- 'January' … 'December'
  days     INTEGER NOT NULL,
  PRIMARY KEY(schedule, month)
);

-- ---------------------------------------------------------------------------
-- SEQUENCE DAILY CAPACITIES
-- Source: Requirements sheet, row 334 (0-indexed row 333)
-- Labor hours per person per day (People seqs) or heads per machine per day (machine seqs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequence_daily_caps (
  sequence       TEXT PRIMARY KEY,
  daily_cap_hours REAL NOT NULL   -- e.g. 5.95 for labor, 20.4 for machine
);

-- ---------------------------------------------------------------------------
-- GLOBAL SETTINGS
-- Key/value store for configurable constants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- Keys: oe_factor (default '0.10'), year ('2026')
);

-- ---------------------------------------------------------------------------
-- ORACLE FORECAST UPLOADS
-- Metadata for each TRN .xlsm file upload
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oracle_uploads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name   TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active   INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- ORACLE FORECAST DATA
-- Source: TRN .xlsm upload (replaces Forecast Dump tab)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oracle_forecast (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id     INTEGER NOT NULL REFERENCES oracle_uploads(id),
  item_number   TEXT NOT NULL,
  month         TEXT NOT NULL,    -- 'January' … 'December'
  qty           REAL NOT NULL DEFAULT 0,
  forecast_type TEXT NOT NULL     -- 'Backlog' (firm PO) or 'Forecast'
);

CREATE INDEX IF NOT EXISTS idx_oracle_item  ON oracle_forecast(item_number);
CREATE INDEX IF NOT EXISTS idx_oracle_upload ON oracle_forecast(upload_id);

-- ---------------------------------------------------------------------------
-- FORECAST CHANGES — Simple Per-Item Overrides
-- Source: Changes tab, rows 14-71
-- Replaces the Oracle forecast qty for a specific item × month
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forecast_changes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_number  TEXT NOT NULL,
  month        TEXT NOT NULL,     -- 'January' … 'December'
  override_qty REAL NOT NULL,
  comment      TEXT,              -- optional note
  changed_by   TEXT,
  changed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fc_item ON forecast_changes(item_number);

-- ---------------------------------------------------------------------------
-- FORECAST CHANGE GROUPS — "Add items together" logic
-- Source: Changes tab, rows 3-12 (special grouping cases)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forecast_change_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name  TEXT NOT NULL,
  target_item TEXT NOT NULL,   -- item that receives the summed demand
  comment     TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forecast_change_group_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER NOT NULL REFERENCES forecast_change_groups(id),
  item_number TEXT NOT NULL,
  -- Optional monthly qty overrides for this member (if different from Oracle)
  jan REAL, feb REAL, mar REAL, apr REAL, may REAL, jun REAL,
  jul REAL, aug REAL, sep REAL, oct REAL, nov REAL, dec REAL
);

CREATE INDEX IF NOT EXISTS idx_fcgm_group ON forecast_change_group_members(group_id);

-- ---------------------------------------------------------------------------
-- EMPLOYEE ROSTER
-- Source: PI Ovens, PI Finishing, PTFE Ovens, PTFE Finishing,
--         Precision, Braid SPI, Ext tabs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  department  TEXT NOT NULL,   -- 'PI Ovens', 'PI Finishing', 'PTFE Ovens', etc.
  shift       TEXT,            -- 'A/1st', 'B/2nd', 'C/3rd', 'D', 'Weekend Day', etc.
  function    TEXT,            -- 'Extrusion', 'Inspection', 'Long Pull', 'Lead', etc.
  status      TEXT NOT NULL DEFAULT 'Active',
              -- 'Active', 'FMLA', 'Recruiting', 'Partial FMLA', 'Exempt', 'NPI'
  year_ask_2025 INTEGER,
  year_ask_2026 INTEGER
);

CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department);

-- ---------------------------------------------------------------------------
-- OVEN EQUIPMENT INFO
-- Source: PI Oven Info, PTFE Oven Info tabs
-- Reference only — does not feed demand calculations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oven_info (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  oven_type   TEXT NOT NULL,   -- 'PI' or 'PTFE'
  oven_number TEXT NOT NULL,
  size        TEXT,            -- 'PI S', 'PI M', 'PI L', etc.
  heads       INTEGER,
  rollers     INTEGER,
  annealers   INTEGER,
  payoffs     INTEGER,
  takeups     INTEGER,
  laser_mics  INTEGER,
  notes       TEXT
);

-- ---------------------------------------------------------------------------
-- AUDIT LOG
-- Written on every admin INSERT / UPDATE / DELETE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  record_id   TEXT,
  action      TEXT NOT NULL,   -- 'INSERT', 'UPDATE', 'DELETE'
  old_value   TEXT,            -- JSON snapshot of row before change
  new_value   TEXT,            -- JSON snapshot of row after change
  changed_by  TEXT,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_at    ON audit_log(changed_at);

-- ---------------------------------------------------------------------------
-- DEFAULT SETTINGS
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO settings(key, value) VALUES ('oe_factor', '0.10');
INSERT OR IGNORE INTO settings(key, value) VALUES ('year', '2026');
