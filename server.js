/**
 * server.js — Capacity Model Express server
 * Port: 3381 (distinct from existing capacity-dashboard on 3380)
 *
 * Phase 1: DB-backed data endpoints + Oracle forecast upload
 * Phase 2: Full calculation engine (replaces Excel-based endpoints)
 * Phase 3: Admin UI CRUD endpoints
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as XLSXModule from 'xlsx';
const XLSX = XLSXModule.default || XLSXModule;
import { Database } from './db/sqlite-compat.js';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { runEngine } from './src/data/db-engine.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH    = path.join(__dirname, 'db', 'capacity.db');
const DATA_DIR   = path.join(__dirname, 'server-data');
const REQUIREMENTS_SOURCE_PATH = path.join(__dirname, '..', 'capacity-dashboard', 'server-data', 'shared-report.json');

const PORT = 3381;
const COVERAGE_MODES = new Set(['official', 'review', 'combined']);

function normalizeCoverageMode(raw) {
  return COVERAGE_MODES.has(raw) ? raw : 'official';
}

function loadRequirementsCoverage() {
  if (!existsSync(REQUIREMENTS_SOURCE_PATH)) {
    return {
      available: false,
      sourceFile: null,
      itemCount: 0,
      itemSet: new Set(),
    };
  }

  const report = JSON.parse(readFileSync(REQUIREMENTS_SOURCE_PATH, 'utf8'));
  const itemSet = new Set();
  for (const row of report.data?.itemStandards || []) {
    if (row.itemNumber) itemSet.add(String(row.itemNumber).trim());
  }

  return {
    available: true,
    sourceFile: report.fileName || path.basename(REQUIREMENTS_SOURCE_PATH),
    itemCount: itemSet.size,
    itemSet,
  };
}

// ─── DB connection (opened once, reused for all requests) ─────────────────────
if (!existsSync(DB_PATH)) {
  console.error('❌  Database not found. Run: node db/init-db.js && node db/migrate-from-excel.js');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, port: PORT, db: existsSync(DB_PATH) });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json(settings);
});

// ─── Capacity (from DB) ───────────────────────────────────────────────────────
app.get('/api/capacity', (req, res) => {
  const rows = db.prepare('SELECT * FROM capacity ORDER BY process, value_stream').all();
  res.json(rows);
});

// ─── Days in Month (from DB) ──────────────────────────────────────────────────
app.get('/api/days-in-month', (req, res) => {
  const rows = db.prepare('SELECT * FROM days_in_month ORDER BY schedule, month').all();
  res.json(rows);
});

// ─── Sequence daily caps (from DB) ────────────────────────────────────────────
app.get('/api/sequence-caps', (req, res) => {
  const rows = db.prepare('SELECT * FROM sequence_daily_caps ORDER BY sequence').all();
  res.json(rows);
});

// ─── Item Standards (from DB) ─────────────────────────────────────────────────
app.get('/api/standards', (req, res) => {
  const { item, sequence, type } = req.query;
  let sql = 'SELECT * FROM item_standards WHERE 1=1';
  const params = [];
  if (item)     { sql += ' AND item_number = ?'; params.push(item); }
  if (sequence) { sql += ' AND sequence = ?';    params.push(sequence); }
  if (type)     { sql += ' AND standard_type = ?'; params.push(type); }
  sql += ' ORDER BY item_number, sequence';
  res.json(db.prepare(sql).all(...params));
});

// ─── Yields (from DB) ─────────────────────────────────────────────────────────
app.get('/api/yields', (req, res) => {
  res.json(db.prepare('SELECT * FROM yields ORDER BY item_number').all());
});

// ─── Items catalog (from DB) ──────────────────────────────────────────────────
app.get('/api/items', (req, res) => {
  res.json(db.prepare('SELECT * FROM items ORDER BY item_number').all());
});

// ─── Forecast Changes (from DB) ───────────────────────────────────────────────
app.get('/api/forecast-changes', (req, res) => {
  res.json(db.prepare('SELECT * FROM forecast_changes ORDER BY item_number, month').all());
});

app.post('/api/forecast-changes', (req, res) => {
  const { item_number, month, override_qty, comment } = req.body;
  if (!item_number || !month || override_qty === undefined) {
    return res.status(400).json({ error: 'item_number, month, override_qty required' });
  }
  const result = db.prepare(`
    INSERT INTO forecast_changes (item_number, month, override_qty, comment, changed_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(item_number, month, override_qty, comment || null, 'admin');
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/forecast-changes/:id', (req, res) => {
  const { override_qty, comment } = req.body;
  db.prepare(`
    UPDATE forecast_changes SET override_qty = ?, comment = ?, changed_at = datetime('now') WHERE id = ?
  `).run(override_qty, comment || null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/forecast-changes/:id', (req, res) => {
  db.prepare('DELETE FROM forecast_changes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Forecast Change Groups (from DB) ─────────────────────────────────────────
app.get('/api/forecast-change-groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM forecast_change_groups ORDER BY id').all();
  const members = db.prepare('SELECT * FROM forecast_change_group_members ORDER BY group_id').all();
  res.json({ groups, members });
});

// ─── Oracle Forecast Upload ────────────────────────────────────────────────────
app.post('/api/oracle-forecast', upload.single('forecast'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use field name "forecast".' });

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets['forecast'];
    if (!ws) return res.status(400).json({ error: 'No "forecast" sheet found in uploaded file.' });

    const raw = XLSX.utils.sheet_to_json(ws, { defval: null });
    const year = db.prepare("SELECT value FROM settings WHERE key = 'year'").get()?.value || '2026';

    // Deactivate previous uploads
    db.prepare('UPDATE oracle_uploads SET is_active = 0').run();

    // Create upload record
    const uploadId = db.prepare(`
      INSERT INTO oracle_uploads (file_name, uploaded_by, is_active)
      VALUES (?, 'server', 1)
    `).run(req.file.originalname || 'oracle-forecast.xlsm').lastInsertRowid;

    // Delete previous forecast data for this upload (clean slate)
    db.prepare('DELETE FROM oracle_forecast WHERE upload_id IN (SELECT id FROM oracle_uploads WHERE is_active = 0)').run();

    const insertRow = db.prepare(`
      INSERT INTO oracle_forecast (upload_id, item_number, month, qty, forecast_type)
      VALUES (?, ?, ?, ?, ?)
    `);

    let firmPOCount = 0, forecastCount = 0;

    const run = db.transaction(() => {
      for (const row of raw) {
        if (String(row['Year']) !== String(year)) continue;
        if (row['Included in Forecast'] !== 'Yes') continue;
        const item = row['ITEM_NUMBER'];
        const month = row['Month'];
        if (!item || !month) continue;
        const itemStr = String(item).trim();

        if (row['Type'] === 'Backlog') {
          const qty = row[`${year} Order Qty`] || 0;
          if (!qty) continue;
          insertRow.run(uploadId, itemStr, month, qty, 'Backlog');
          firmPOCount++;
        } else {
          const qty = row[`${year} Working Outlook Qty`] || 0;
          if (!qty) continue;
          insertRow.run(uploadId, itemStr, month, qty, 'Forecast');
          forecastCount++;
        }
      }
    });
    run();

    res.json({
      ok: true,
      uploadId,
      year,
      firmPORows: firmPOCount,
      forecastRows: forecastCount,
      fileName: req.file.originalname,
    });
  } catch (err) {
    console.error('Oracle upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Oracle Forecast (read) ───────────────────────────────────────────────────
app.get('/api/oracle-forecast', (req, res) => {
  const upload = db.prepare('SELECT * FROM oracle_uploads WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
  if (!upload) return res.json({ available: false });

  const rows = db.prepare(
    'SELECT item_number, month, qty, forecast_type FROM oracle_forecast WHERE upload_id = ?'
  ).all(upload.id);

  // Build { firmPO: {item: {month: qty}}, forecast: {item: {month: qty}} }
  const firmPO = {}, forecast = {};
  for (const row of rows) {
    if (row.forecast_type === 'Backlog') {
      if (!firmPO[row.item_number]) firmPO[row.item_number] = {};
      firmPO[row.item_number][row.month] = (firmPO[row.item_number][row.month] || 0) + row.qty;
    } else {
      if (!forecast[row.item_number]) forecast[row.item_number] = {};
      forecast[row.item_number][row.month] = (forecast[row.item_number][row.month] || 0) + row.qty;
    }
  }

  res.json({ available: true, fileName: upload.file_name, uploadedAt: upload.uploaded_at, firmPO, forecast });
});

// ─── Employees (read) ─────────────────────────────────────────────────────────
app.get('/api/employees', (req, res) => {
  const { department } = req.query;
  let sql = 'SELECT * FROM employees';
  const params = [];
  if (department) { sql += ' WHERE department = ?'; params.push(department); }
  sql += ' ORDER BY department, shift, name';
  res.json(db.prepare(sql).all(...params));
});

// ─── Oven Info (read) ─────────────────────────────────────────────────────────
app.get('/api/oven-info', (req, res) => {
  res.json(db.prepare('SELECT * FROM oven_info ORDER BY oven_type, oven_number').all());
});

// ─── DB-driven Demand Breakdown ───────────────────────────────────────────────
// Runs the full calculation engine from DB inputs + live Oracle forecast.
// schedule=5+Day or 7+Day (query param)
app.get('/api/db-demand-breakdown', (req, res) => {
  try {
    const schedule = req.query.schedule === '7 Day' ? '7 Day' : '5 Day';
    const coverageMode = normalizeCoverageMode(req.query.coverage);
    const requirementsCoverage = loadRequirementsCoverage();

    // Load Oracle forecast from DB
    const upload = db.prepare('SELECT * FROM oracle_uploads WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
    if (!upload) {
      return res.status(400).json({ error: 'No Oracle forecast uploaded yet. Upload a TRN .xlsm file first.' });
    }

    const rows = db.prepare(
      'SELECT item_number, month, qty, forecast_type FROM oracle_forecast WHERE upload_id = ?'
    ).all(upload.id);

    const firmPO = {}, forecast = {};
    for (const row of rows) {
      if (row.forecast_type === 'Backlog') {
        if (!firmPO[row.item_number]) firmPO[row.item_number] = {};
        firmPO[row.item_number][row.month] = (firmPO[row.item_number][row.month] || 0) + row.qty;
      } else {
        if (!forecast[row.item_number]) forecast[row.item_number] = {};
        forecast[row.item_number][row.month] = (forecast[row.item_number][row.month] || 0) + row.qty;
      }
    }

    const oracleForecast = { firmPO, forecast };
    const breakdown = runEngine(db, oracleForecast, schedule, { coverageMode, requirementsCoverage });
    res.json({ ok: true, schedule, coverage: breakdown.coverage, oracleFile: upload.file_name, breakdown });
  } catch (err) {
    console.error('Engine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Audit log helper ────────────────────────────────────────────────────────
function writeAudit(table, recordId, action, oldValue, newValue, changedBy = 'admin') {
  db.prepare(`
    INSERT INTO audit_log (table_name, record_id, action, old_value, new_value, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    table,
    String(recordId ?? ''),
    action,
    oldValue  ? JSON.stringify(oldValue)  : null,
    newValue  ? JSON.stringify(newValue)  : null,
    changedBy
  );
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const storedPw = db.prepare("SELECT value FROM settings WHERE key='admin_password'").get()?.value || 'admin';
  if (!token || token !== storedPw) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Admin login ──────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const storedPw = db.prepare("SELECT value FROM settings WHERE key='admin_password'").get()?.value || 'admin';
  if (password === storedPw) {
    res.json({ ok: true, token: password });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// ─── DB-driven Operational Detail ────────────────────────────────────────────
// Returns a matrix: sequences × value streams × {demand_hc, capacity, delta, util_pct}
// month param optional — if omitted, uses current calendar month
app.get('/api/db-report', (req, res) => {
  try {
    const schedule = req.query.schedule === '7 Day' ? '7 Day' : '5 Day';
    const coverageMode = normalizeCoverageMode(req.query.coverage);
    const requirementsCoverage = loadRequirementsCoverage();
    const monthParam = req.query.month || null;

    // Determine the target month
    const now = new Date();
    const MONTHS_FULL = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December'
    ];
    const targetMonth = (monthParam && MONTHS_FULL.includes(monthParam))
      ? monthParam
      : MONTHS_FULL[now.getMonth()];

    // Check for oracle forecast
    const upload = db.prepare('SELECT * FROM oracle_uploads WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();

    let breakdown = null;
    if (upload) {
      const rows = db.prepare(
        'SELECT item_number, month, qty, forecast_type FROM oracle_forecast WHERE upload_id = ?'
      ).all(upload.id);

      const firmPO = {}, forecast = {};
      for (const row of rows) {
        if (row.forecast_type === 'Backlog') {
          if (!firmPO[row.item_number]) firmPO[row.item_number] = {};
          firmPO[row.item_number][row.month] = (firmPO[row.item_number][row.month] || 0) + row.qty;
        } else {
          if (!forecast[row.item_number]) forecast[row.item_number] = {};
          forecast[row.item_number][row.month] = (forecast[row.item_number][row.month] || 0) + row.qty;
        }
      }
      breakdown = runEngine(db, { firmPO, forecast }, schedule, { coverageMode, requirementsCoverage });
    }

    // Build matrix: [seq][vs] = { demand_hc, capacity, delta, util_pct }
    const matrix = {};
    const allVS  = new Set();
    const allSeq = new Set();

    // Populate from capacity table (ensures all seqs/VS appear even without demand)
    const capRows = db.prepare('SELECT process, value_stream, capacity, uom, department, subcategory FROM capacity').all();
    for (const row of capRows) {
      const seq = row.process;
      const vs  = row.value_stream;
      if (!vs) continue;
      allSeq.add(seq);
      allVS.add(vs);
      if (!matrix[seq]) matrix[seq] = {};
      if (!matrix[seq][vs]) matrix[seq][vs] = { demand_hc: 0, capacity: 0, delta: 0, util_pct: null };
      matrix[seq][vs].capacity += row.capacity;
    }

    // Overlay demand from engine
    if (breakdown) {
      for (const seq of (breakdown.sequences || [])) allSeq.add(seq);
      for (const [vs, seqData] of Object.entries(breakdown.byVSAndSequence)) {
        for (const [seq, monthData] of Object.entries(seqData)) {
          const data = monthData[targetMonth];
          if (!data) continue;
          allVS.add(vs);
          if (!matrix[seq]) matrix[seq] = {};
          if (!matrix[seq][vs]) matrix[seq][vs] = { demand_hc: 0, capacity: 0, delta: 0, util_pct: null };
          matrix[seq][vs].demand_hc = data.totalDemand_hc || 0;
          // capacity already set from capacity table; recalculate delta
          matrix[seq][vs].delta = matrix[seq][vs].capacity - matrix[seq][vs].demand_hc;
          const cap = matrix[seq][vs].capacity;
          matrix[seq][vs].util_pct = cap > 0 ? (matrix[seq][vs].demand_hc / cap) : null;
        }
      }

      // Recalc delta for all matrix cells (capacity may have been set before demand)
      for (const seq of Object.keys(matrix)) {
        for (const vs of Object.keys(matrix[seq])) {
          const cell = matrix[seq][vs];
          cell.delta = cell.capacity - cell.demand_hc;
          cell.util_pct = cell.capacity > 0 ? cell.demand_hc / cell.capacity : null;
        }
      }
    }

    // Build seq → uom / department / subcategory maps
    const sequenceUoms  = {};
    const sequenceDepts = {};
    const sequenceSubs  = {};
    for (const row of capRows) {
      if (row.process) {
        if (row.uom)        sequenceUoms[row.process]  = row.uom;
        if (row.department) sequenceDepts[row.process] = row.department;
        if (row.subcategory) sequenceSubs[row.process] = row.subcategory;
      }
    }

    res.json({
      ok: true,
      schedule,
      month: targetMonth,
      coverage: breakdown?.coverage || {
        mode: coverageMode,
        requirementsAvailable: requirementsCoverage.available,
        requirementsSourceFile: requirementsCoverage.sourceFile,
        requirementsItemCount: requirementsCoverage.itemCount,
      },
      hasOracleForecast: !!upload,
      oracleFile: upload?.file_name || null,
      sequences: [...allSeq].sort(),
      valueStreams: [...allVS].filter(v => v && v !== 'Total').sort(),
      sequenceUoms,
      sequenceDepts,
      sequenceSubs,
      matrix,
    });
  } catch (err) {
    console.error('db-report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: Audit log (read) ──────────────────────────────────────────────────
app.get('/api/audit-log', requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const table = req.query.table;
  let sql = 'SELECT * FROM audit_log';
  const params = [];
  if (table) { sql += ' WHERE table_name = ?'; params.push(table); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  res.json(db.prepare(sql).all(...params));
});

// ─── Admin: Capacity CRUD ─────────────────────────────────────────────────────
app.post('/api/capacity', requireAdmin, (req, res) => {
  const { process, value_stream, capacity, uom } = req.body;
  if (!process || !value_stream) return res.status(400).json({ error: 'process and value_stream required' });
  const result = db.prepare(`
    INSERT INTO capacity (process, value_stream, capacity, uom) VALUES (?, ?, ?, ?)
  `).run(process, value_stream, capacity ?? 0, uom || 'People');
  const newRow = db.prepare('SELECT * FROM capacity WHERE id = ?').get(result.lastInsertRowid);
  writeAudit('capacity', result.lastInsertRowid, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/capacity/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM capacity WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { process, value_stream, capacity, uom } = req.body;
  db.prepare(`
    UPDATE capacity SET process=?, value_stream=?, capacity=?, uom=? WHERE id=?
  `).run(process ?? old.process, value_stream ?? old.value_stream,
          capacity ?? old.capacity, uom ?? old.uom, req.params.id);
  const updated = db.prepare('SELECT * FROM capacity WHERE id = ?').get(req.params.id);
  writeAudit('capacity', req.params.id, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/capacity/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM capacity WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM capacity WHERE id = ?').run(req.params.id);
  writeAudit('capacity', req.params.id, 'DELETE', old, null);
  res.json({ ok: true });
});

// ─── Admin: Item Standards CRUD ───────────────────────────────────────────────
app.post('/api/standards', requireAdmin, (req, res) => {
  const { item_number, sequence, standard_type, seconds_per_unit } = req.body;
  if (!item_number || !sequence) return res.status(400).json({ error: 'item_number and sequence required' });
  const result = db.prepare(`
    INSERT OR REPLACE INTO item_standards (item_number, sequence, standard_type, seconds_per_unit)
    VALUES (?, ?, ?, ?)
  `).run(item_number, sequence, standard_type || 'machine', seconds_per_unit ?? 0);
  const newRow = db.prepare('SELECT * FROM item_standards WHERE id = ?').get(result.lastInsertRowid);
  writeAudit('item_standards', result.lastInsertRowid, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/standards/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM item_standards WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { item_number, sequence, standard_type, seconds_per_unit } = req.body;
  db.prepare(`
    UPDATE item_standards SET item_number=?, sequence=?, standard_type=?, seconds_per_unit=? WHERE id=?
  `).run(item_number ?? old.item_number, sequence ?? old.sequence,
          standard_type ?? old.standard_type, seconds_per_unit ?? old.seconds_per_unit, req.params.id);
  const updated = db.prepare('SELECT * FROM item_standards WHERE id = ?').get(req.params.id);
  writeAudit('item_standards', req.params.id, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/standards/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM item_standards WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM item_standards WHERE id = ?').run(req.params.id);
  writeAudit('item_standards', req.params.id, 'DELETE', old, null);
  res.json({ ok: true });
});

// ─── Admin: Yields CRUD ───────────────────────────────────────────────────────
app.post('/api/yields', requireAdmin, (req, res) => {
  const { item_number, yield: yld, description } = req.body;
  if (!item_number) return res.status(400).json({ error: 'item_number required' });
  db.prepare('INSERT OR REPLACE INTO yields (item_number, yield, description) VALUES (?,?,?)').run(item_number, yld ?? 1.0, description || null);
  const newRow = db.prepare('SELECT * FROM yields WHERE item_number = ?').get(item_number);
  writeAudit('yields', item_number, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/yields/:itemNumber', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM yields WHERE item_number = ?').get(req.params.itemNumber);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { yield: yld, description } = req.body;
  db.prepare('UPDATE yields SET yield=?, description=? WHERE item_number=?').run(yld ?? old.yield, description ?? old.description, req.params.itemNumber);
  const updated = db.prepare('SELECT * FROM yields WHERE item_number = ?').get(req.params.itemNumber);
  writeAudit('yields', req.params.itemNumber, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/yields/:itemNumber', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM yields WHERE item_number = ?').get(req.params.itemNumber);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM yields WHERE item_number = ?').run(req.params.itemNumber);
  writeAudit('yields', req.params.itemNumber, 'DELETE', old, null);
  res.json({ ok: true });
});

// ─── Admin: Employees CRUD ────────────────────────────────────────────────────
app.post('/api/employees', requireAdmin, (req, res) => {
  const { name, department, shift, function: fn, status } = req.body;
  if (!name || !department) return res.status(400).json({ error: 'name and department required' });
  const result = db.prepare(`
    INSERT INTO employees (name, department, shift, function, status) VALUES (?,?,?,?,?)
  `).run(name, department, shift || null, fn || null, status || 'Active');
  const newRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
  writeAudit('employees', result.lastInsertRowid, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/employees/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { name, department, shift, function: fn, status } = req.body;
  db.prepare(`
    UPDATE employees SET name=?, department=?, shift=?, function=?, status=? WHERE id=?
  `).run(name ?? old.name, department ?? old.department, shift ?? old.shift,
          fn ?? old.function, status ?? old.status, req.params.id);
  const updated = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  writeAudit('employees', req.params.id, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/employees/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  writeAudit('employees', req.params.id, 'DELETE', old, null);
  res.json({ ok: true });
});

// ─── Admin: Items CRUD ────────────────────────────────────────────────────────
app.post('/api/items', requireAdmin, (req, res) => {
  const fields = req.body;
  if (!fields.item_number) return res.status(400).json({ error: 'item_number required' });
  db.prepare(`
    INSERT OR REPLACE INTO items
      (item_number,description,material_type,color,item_type_detail,od_coat,id_coat,
       id_size,od_size,wall,fg_length,pull_length,im,customer,parent_company,
       value_stream,product_family,uom,planner,status,item_type)
    VALUES
      (@item_number,@description,@material_type,@color,@item_type_detail,@od_coat,@id_coat,
       @id_size,@od_size,@wall,@fg_length,@pull_length,@im,@customer,@parent_company,
       @value_stream,@product_family,@uom,@planner,@status,@item_type)
  `).run(fields);
  const newRow = db.prepare('SELECT * FROM items WHERE item_number = ?').get(fields.item_number);
  writeAudit('items', fields.item_number, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/items/:itemNumber', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM items WHERE item_number = ?').get(req.params.itemNumber);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const fields = { ...old, ...req.body, item_number: req.params.itemNumber };
  db.prepare(`
    UPDATE items SET description=@description,material_type=@material_type,color=@color,
      item_type_detail=@item_type_detail,od_coat=@od_coat,id_coat=@id_coat,
      id_size=@id_size,od_size=@od_size,wall=@wall,fg_length=@fg_length,pull_length=@pull_length,
      im=@im,customer=@customer,parent_company=@parent_company,value_stream=@value_stream,
      product_family=@product_family,uom=@uom,planner=@planner,status=@status,item_type=@item_type
    WHERE item_number=@item_number
  `).run(fields);
  const updated = db.prepare('SELECT * FROM items WHERE item_number = ?').get(req.params.itemNumber);
  writeAudit('items', req.params.itemNumber, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/items/:itemNumber', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM items WHERE item_number = ?').get(req.params.itemNumber);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM items WHERE item_number = ?').run(req.params.itemNumber);
  writeAudit('items', req.params.itemNumber, 'DELETE', old, null);
  res.json({ ok: true });
});

// ─── Admin: Days in Month CRUD ────────────────────────────────────────────────
app.put('/api/days-in-month', requireAdmin, (req, res) => {
  const { schedule, month, days } = req.body;
  if (!schedule || !month || days === undefined) return res.status(400).json({ error: 'schedule, month, days required' });
  const old = db.prepare('SELECT * FROM days_in_month WHERE schedule=? AND month=?').get(schedule, month);
  db.prepare('INSERT OR REPLACE INTO days_in_month (schedule, month, days) VALUES (?,?,?)').run(schedule, month, days);
  const updated = db.prepare('SELECT * FROM days_in_month WHERE schedule=? AND month=?').get(schedule, month);
  writeAudit('days_in_month', `${schedule}|${month}`, old ? 'UPDATE' : 'INSERT', old || null, updated);
  res.json(updated);
});

// ─── Admin: Settings CRUD ─────────────────────────────────────────────────────
app.put('/api/settings/:key', requireAdmin, (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value required' });
  const old = db.prepare('SELECT * FROM settings WHERE key=?').get(req.params.key);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(req.params.key, String(value));
  const updated = db.prepare('SELECT * FROM settings WHERE key=?').get(req.params.key);
  writeAudit('settings', req.params.key, old ? 'UPDATE' : 'INSERT', old || null, updated);
  res.json(updated);
});

// ─── Admin: Oven Info CRUD ────────────────────────────────────────────────────
app.post('/api/oven-info', requireAdmin, (req, res) => {
  const { oven_type, oven_number, size, heads, rollers, annealers, payoffs, takeups, laser_mics, notes } = req.body;
  if (!oven_type || !oven_number) return res.status(400).json({ error: 'oven_type and oven_number required' });
  const result = db.prepare(`
    INSERT INTO oven_info (oven_type,oven_number,size,heads,rollers,annealers,payoffs,takeups,laser_mics,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(oven_type, oven_number, size||null, heads||null, rollers||null, annealers||null, payoffs||null, takeups||null, laser_mics||null, notes||null);
  const newRow = db.prepare('SELECT * FROM oven_info WHERE id = ?').get(result.lastInsertRowid);
  writeAudit('oven_info', result.lastInsertRowid, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/oven-info/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM oven_info WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const f = { ...old, ...req.body };
  db.prepare(`
    UPDATE oven_info SET oven_type=?,oven_number=?,size=?,heads=?,rollers=?,annealers=?,payoffs=?,takeups=?,laser_mics=?,notes=? WHERE id=?
  `).run(f.oven_type,f.oven_number,f.size,f.heads,f.rollers,f.annealers,f.payoffs,f.takeups,f.laser_mics,f.notes,req.params.id);
  const updated = db.prepare('SELECT * FROM oven_info WHERE id = ?').get(req.params.id);
  writeAudit('oven_info', req.params.id, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/oven-info/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM oven_info WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM oven_info WHERE id = ?').run(req.params.id);
  writeAudit('oven_info', req.params.id, 'DELETE', old, null);
  res.json({ ok: true });
});

// ─── Admin: Forecast Changes (with audit) ─────────────────────────────────────
// Wrap existing POST/PUT/DELETE to add audit log entries
// NOTE: The existing endpoints above don't have audit. Replace them here with audited versions.
// The existing forecast-changes CRUD is already defined above (lines ~101-124).
// Those run without audit; re-declare with requireAdmin + audit below for completeness.
// To avoid duplication, we add a separate audited path: /api/admin/forecast-changes
app.get('/api/admin/forecast-changes', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM forecast_changes ORDER BY item_number, month').all());
});

app.post('/api/admin/forecast-changes', requireAdmin, (req, res) => {
  const { item_number, month, override_qty, comment } = req.body;
  if (!item_number || !month || override_qty === undefined) return res.status(400).json({ error: 'item_number, month, override_qty required' });
  const result = db.prepare(`
    INSERT INTO forecast_changes (item_number, month, override_qty, comment, changed_by) VALUES (?,?,?,?,?)
  `).run(item_number, month, override_qty, comment || null, 'admin');
  const newRow = db.prepare('SELECT * FROM forecast_changes WHERE id=?').get(result.lastInsertRowid);
  writeAudit('forecast_changes', result.lastInsertRowid, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/admin/forecast-changes/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM forecast_changes WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { item_number, month, override_qty, comment } = req.body;
  db.prepare(`
    UPDATE forecast_changes SET item_number=?,month=?,override_qty=?,comment=?,changed_at=datetime('now') WHERE id=?
  `).run(item_number??old.item_number, month??old.month, override_qty??old.override_qty, comment??old.comment, req.params.id);
  const updated = db.prepare('SELECT * FROM forecast_changes WHERE id=?').get(req.params.id);
  writeAudit('forecast_changes', req.params.id, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/admin/forecast-changes/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM forecast_changes WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM forecast_changes WHERE id=?').run(req.params.id);
  writeAudit('forecast_changes', req.params.id, 'DELETE', old, null);
  res.json({ ok: true });
});

// ─── Admin: Forecast Change Groups CRUD ──────────────────────────────────────
app.post('/api/forecast-change-groups', requireAdmin, (req, res) => {
  const { group_name, target_item, comment } = req.body;
  if (!group_name || !target_item) return res.status(400).json({ error: 'group_name and target_item required' });
  const result = db.prepare(`
    INSERT INTO forecast_change_groups (group_name, target_item, comment, created_by) VALUES (?,?,?,?)
  `).run(group_name, target_item, comment||null, 'admin');
  const newRow = db.prepare('SELECT * FROM forecast_change_groups WHERE id=?').get(result.lastInsertRowid);
  writeAudit('forecast_change_groups', result.lastInsertRowid, 'INSERT', null, newRow);
  res.json(newRow);
});

app.put('/api/forecast-change-groups/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM forecast_change_groups WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { group_name, target_item, comment } = req.body;
  db.prepare(`UPDATE forecast_change_groups SET group_name=?,target_item=?,comment=? WHERE id=?`).run(
    group_name??old.group_name, target_item??old.target_item, comment??old.comment, req.params.id);
  const updated = db.prepare('SELECT * FROM forecast_change_groups WHERE id=?').get(req.params.id);
  writeAudit('forecast_change_groups', req.params.id, 'UPDATE', old, updated);
  res.json(updated);
});

app.delete('/api/forecast-change-groups/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM forecast_change_groups WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM forecast_change_group_members WHERE group_id=?').run(req.params.id);
  db.prepare('DELETE FROM forecast_change_groups WHERE id=?').run(req.params.id);
  writeAudit('forecast_change_groups', req.params.id, 'DELETE', old, null);
  res.json({ ok: true });
});

// Group members
app.post('/api/forecast-change-groups/:groupId/members', requireAdmin, (req, res) => {
  const { item_number } = req.body;
  if (!item_number) return res.status(400).json({ error: 'item_number required' });
  const result = db.prepare(`INSERT INTO forecast_change_group_members (group_id, item_number) VALUES (?,?)`).run(req.params.groupId, item_number);
  res.json({ id: result.lastInsertRowid, group_id: req.params.groupId, item_number });
});

app.delete('/api/forecast-change-group-members/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM forecast_change_group_members WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Serve frontend (when built) ──────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist');
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(DIST, 'index.html'));
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  Capacity Model server running at http://localhost:${PORT}`);
  console.log(`    DB: ${DB_PATH}\n`);
});
