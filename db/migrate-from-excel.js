/**
 * db/migrate-from-excel.js
 *
 * One-time migration: reads every relevant tab from the .xlsb capacity workbook
 * and populates the SQLite database.
 *
 * Usage:
 *   node db/migrate-from-excel.js
 *   node db/migrate-from-excel.js --xlsb "C:\path\to\file.xlsb"
 *
 * The script will auto-locate the .xlsb file in the parent Capacity Report Model
 * folder if no --xlsb argument is given.
 */

import * as XLSXModule from 'xlsx';
const XLSX = XLSXModule.default || XLSXModule;
import Database from 'better-sqlite3';
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH    = path.join(__dirname, 'capacity.db');

// Auto-detect .xlsb file in the Capacity Report Model folder
function findXlsb() {
  const arg = process.argv.find(a => a.startsWith('--xlsb='));
  if (arg) return arg.split('=')[1];

  const searchDir = path.join(__dirname, '..', '..', 'Capacity Report Model');
  if (existsSync(searchDir)) {
    const files = readdirSync(searchDir).filter(f => f.endsWith('.xlsb'));
    if (files.length > 0) return path.join(searchDir, files[0]);
  }
  throw new Error(
    'Could not find .xlsb file. Pass --xlsb=<path> or place the file in ' +
    '"../Capacity Report Model/" relative to the Claude Capacity Model folder.'
  );
}

const XLSB_PATH = findXlsb();

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS_FULL = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Machine Standards: sequences in column order (cols 1-20, index 1-20)
const MACHINE_SEQUENCES = [
  'Draw','Micro','PI Base S','PI Base M','PI Base L',
  'PTFE','PTFE L','Etch','Braid','PI Overcoat/ Rebake',
  'SPI','PL Overcoat','Pebax','Teco','FEP',
  'Ex 1','Ex 6','Ex 8,10','Ex 12','Annealer'
];

// Finishing Standards: sequences in column order (cols 1-17, index 1-17)
const FINISHING_SEQUENCES = [
  'Long Pull','Table Pull','Medtronic Pull','Wrapping',
  'Flush','Pressure Test','Check Flush','CTL','Ex CTL',
  'Inspection','Ex Inspection','PL Inspection',
  'Roll Cut','Machine Cut','Accu-Cut','Packaging'
];

// Department staffing sheet names → department label
const DEPT_SHEETS = {
  'PI Ovens':      'PI Ovens',
  'PI Finishing':  'PI Finishing',
  'PTFE Ovens':    'PTFE Ovens',
  'PTFE Finishing':'PTFE Finishing',
  'Precision':     'Precision',
  'Braid SPI':     'Braid SPI',
  'Ext':           'Extrusion',
};

// ─── Load workbook ────────────────────────────────────────────────────────────

console.log(`\n📂  Loading workbook: ${path.basename(XLSB_PATH)}`);
const wb = XLSX.readFile(XLSB_PATH, { type: 'file', cellText: false, cellDates: false });
console.log(`    Sheets found: ${wb.SheetNames.join(', ')}\n`);

// ─── Open DB ──────────────────────────────────────────────────────────────────

if (!existsSync(DB_PATH)) {
  throw new Error(`Database not found at ${DB_PATH}. Run: node db/init-db.js first.`);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? null : n;
}

function cleanStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function sheetToArr(sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

function countInserted(label, n) {
  console.log(`  ✓  ${label}: ${n} rows inserted`);
}

// ─── 1. Items (Item Info tab) ─────────────────────────────────────────────────

function migrateItems() {
  console.log('📋  Migrating: Item Info → items');
  const rows = sheetToArr('Item Info');
  if (!rows || rows.length < 2) { console.log('  ⚠️  Sheet not found or empty'); return; }

  // Header row: Item, Material Type, Color, Type, OD Coat, ID Coat, ID, OD, Wall,
  //             FG Length, Pull Length, IM, Description, Customer, Parent Company,
  //             Value Stream, Product Family, UOM, Planner, Status, Item Type
  const C = {
    item_number: 0, material_type: 1, color: 2, item_type_detail: 3,
    od_coat: 4, id_coat: 5, id_size: 6, od_size: 7, wall: 8,
    fg_length: 9, pull_length: 10, im: 11, description: 12,
    customer: 13, parent_company: 14, value_stream: 15, product_family: 16,
    uom: 17, planner: 18, status: 19, item_type: 20
  };

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO items
      (item_number, description, material_type, color, item_type_detail,
       od_coat, id_coat, id_size, od_size, wall, fg_length, pull_length,
       im, customer, parent_company, value_stream, product_family,
       uom, planner, status, item_type)
    VALUES
      (@item_number, @description, @material_type, @color, @item_type_detail,
       @od_coat, @id_coat, @id_size, @od_size, @wall, @fg_length, @pull_length,
       @im, @customer, @parent_company, @value_stream, @product_family,
       @uom, @planner, @status, @item_type)
  `);

  let count = 0;
  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const itemNum = cleanStr(r[C.item_number]);
      if (!itemNum) continue;
      stmt.run({
        item_number:    itemNum,
        description:    cleanStr(r[C.description]),
        material_type:  cleanStr(r[C.material_type]),
        color:          cleanStr(r[C.color]),
        item_type_detail: cleanStr(r[C.item_type_detail]),
        od_coat:        cleanStr(r[C.od_coat]),
        id_coat:        cleanStr(r[C.id_coat]),
        id_size:        parseNum(r[C.id_size]),
        od_size:        parseNum(r[C.od_size]),
        wall:           parseNum(r[C.wall]),
        fg_length:      parseNum(r[C.fg_length]),
        pull_length:    parseNum(r[C.pull_length]),
        im:             cleanStr(r[C.im]),
        customer:       cleanStr(r[C.customer]),
        parent_company: cleanStr(r[C.parent_company]),
        value_stream:   cleanStr(r[C.value_stream]),
        product_family: cleanStr(r[C.product_family]),
        uom:            cleanStr(r[C.uom]),
        planner:        cleanStr(r[C.planner]),
        status:         cleanStr(r[C.status]),
        item_type:      cleanStr(r[C.item_type]),
      });
      count++;
    }
  });
  run();
  countInserted('items', count);
}

// ─── 2. Machine Standards ─────────────────────────────────────────────────────

function migrateMachineStandards() {
  console.log('⚙️   Migrating: Machine Standards → item_standards (type=machine)');
  const rows = sheetToArr('Machine Standards');
  if (!rows || rows.length < 2) { console.log('  ⚠️  Sheet not found or empty'); return; }

  // Row 0 = headers: Item, Draw, Micro, PI Base S, PI Base M, PI Base L,
  //                  PTFE, PTFE L, Etch, Braid, PI Overcoat/ Rebake,
  //                  SPI, PL Overcoat, Pebax, Teco, FEP,
  //                  Ex 1, Ex 6, Ex 8,10, Ex 12, Annealer, ...
  // Sequences start at col 1, end at col 20 (20 sequences)

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO item_standards (item_number, sequence, standard_type, seconds_per_unit)
    VALUES (@item_number, @sequence, 'machine', @seconds_per_unit)
  `);

  let count = 0;
  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const itemNum = cleanStr(r[0]);
      if (!itemNum) continue;

      for (let s = 0; s < MACHINE_SEQUENCES.length; s++) {
        const secs = parseNum(r[s + 1]);
        // Only store non-null, non-zero standards
        if (secs === null || secs <= 0) continue;
        stmt.run({ item_number: itemNum, sequence: MACHINE_SEQUENCES[s], seconds_per_unit: secs });
        count++;
      }
    }
  });
  run();
  countInserted('machine standards', count);
}

// ─── 3. Draw Standards ───────────────────────────────────────────────────────

function migrateDrawStandards() {
  console.log('⚙️   Migrating: Draw Standards → item_standards (type=draw)');
  const rows = sheetToArr('Draw Standards');
  if (!rows || rows.length < 2) { console.log('  ⚠️  Sheet not found or empty'); return; }

  // Row 0 = headers: Item, Size, Material, Drawn From, Drawn %, STD, Demand, ...
  // STD (draw standard in seconds) is at col index 5
  const STD_COL = 5;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO item_standards (item_number, sequence, standard_type, seconds_per_unit)
    VALUES (@item_number, 'Draw', 'draw', @seconds_per_unit)
  `);

  let count = 0;
  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const itemNum = cleanStr(r[0]);
      if (!itemNum) continue;
      const secs = parseNum(r[STD_COL]);
      if (secs === null || secs <= 0) continue;
      // Draw Standards may have duplicate item rows (same item, different wire sizes)
      // Use INSERT OR REPLACE to keep last value — or you can average/take max
      stmt.run({ item_number: itemNum, seconds_per_unit: secs });
      count++;
    }
  });
  run();
  countInserted('draw standards', count);
}

// ─── 4. Finishing Standards ───────────────────────────────────────────────────

function migrateFinishingStandards() {
  console.log('⚙️   Migrating: Finishing Standards → item_standards (type=finishing)');
  const rows = sheetToArr('Finishing Standards');
  if (!rows || rows.length < 2) { console.log('  ⚠️  Sheet not found or empty'); return; }

  // Row 0 = headers: Item, Long Pull, Table Pull, Medtronic Pull, Wrapping,
  //                  Flush, Pressure Test, Check Flush, CTL, Ex CTL,
  //                  Inspection, Ex Inspection, PL Inspection,
  //                  Roll Cut, Machine Cut, Accu-Cut, Packaging, ...
  // Sequences at cols 1-16

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO item_standards (item_number, sequence, standard_type, seconds_per_unit)
    VALUES (@item_number, @sequence, 'finishing', @seconds_per_unit)
  `);

  let count = 0;
  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const itemNum = cleanStr(r[0]);
      if (!itemNum) continue;

      for (let s = 0; s < FINISHING_SEQUENCES.length; s++) {
        const secs = parseNum(r[s + 1]);
        if (secs === null || secs <= 0) continue;
        stmt.run({ item_number: itemNum, sequence: FINISHING_SEQUENCES[s], seconds_per_unit: secs });
        count++;
      }
    }
  });
  run();
  countInserted('finishing standards', count);
}

// ─── 5. MFG Yields ────────────────────────────────────────────────────────────

function migrateYields() {
  console.log('🔬  Migrating: MFG Yields → yields');
  const rows = sheetToArr('MFG Yields');
  if (!rows || rows.length < 2) { console.log('  ⚠️  Sheet not found or empty'); return; }

  // Row 0 = headers: Item, Component Description, Material, Yield, ...
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO yields (item_number, yield, description)
    VALUES (@item_number, @yield, @description)
  `);

  let count = 0;
  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const itemNum = cleanStr(r[0]);
      if (!itemNum) continue;
      const yld = parseNum(r[3]);
      if (yld === null) continue;
      stmt.run({
        item_number: itemNum,
        yield:       yld,
        description: cleanStr(r[1]),
      });
      count++;
    }
  });
  run();
  countInserted('yields', count);
}

// ─── 6. Current Capacity ──────────────────────────────────────────────────────

function migrateCapacity() {
  console.log('👥  Migrating: Current Capacity → capacity');
  const ws = wb.Sheets['Current Capacity'];
  if (!ws) { console.log('  ⚠️  Sheet not found'); return; }

  // Build sequence → {department, subcategory} map from 5 Day sheet
  const seqDeptMap = {};
  const fiveDayWs = wb.Sheets['5 Day'];
  if (fiveDayWs) {
    const fiveDayRaw = XLSX.utils.sheet_to_json(fiveDayWs, { defval: null });
    for (const row of fiveDayRaw) {
      const seq = cleanStr(row['Sequence']);
      if (seq && row['Department'] && !seqDeptMap[seq]) {
        seqDeptMap[seq] = {
          department:  cleanStr(row['Department']),
          subcategory: cleanStr(row['Subcategory']),
        };
      }
    }
  }

  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO capacity (process, value_stream, capacity, uom, department, subcategory)
    VALUES (@process, @value_stream, @capacity, @uom, @department, @subcategory)
  `);

  let count = 0;
  const run = db.transaction(() => {
    for (const row of raw) {
      const process = cleanStr(row['Process']);
      if (!process) continue;
      const deptInfo = seqDeptMap[process] || {};
      stmt.run({
        process,
        value_stream: cleanStr(row['Value Stream']) || '',
        capacity:     parseNum(row['Current Capacity']) ?? 0,
        uom:          cleanStr(row['UOM']) || 'People',
        department:   deptInfo.department  || null,
        subcategory:  deptInfo.subcategory || null,
      });
      count++;
    }
  });
  run();
  countInserted('capacity rows', count);
}

// ─── 7. Days in Month ─────────────────────────────────────────────────────────

function migrateDaysInMonth() {
  console.log('📅  Migrating: Days in Month → days_in_month');
  const rows = sheetToArr('Days in Month');
  if (!rows || rows.length < 2) { console.log('  ⚠️  Sheet not found or empty'); return; }

  // Row 0 = headers (col 0 blank, cols 1-12 = month names)
  // Row 1+ = schedule rows: col 0 = '5 Day' or '7 Day', cols 1-12 = days
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO days_in_month (schedule, month, days)
    VALUES (@schedule, @month, @days)
  `);

  let count = 0;
  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const label = cleanStr(r[0]);
      if (label !== '5 Day' && label !== '7 Day') continue;
      for (let m = 0; m < 12; m++) {
        const days = parseNum(r[m + 1]);
        if (!days) continue;
        stmt.run({ schedule: label, month: MONTHS_FULL[m], days: Math.round(days) });
        count++;
      }
    }
  });
  run();
  countInserted('days_in_month rows', count);
}

// ─── 8. Requirements metadata (sequence daily caps + OE factor) ───────────────

function migrateRequirementsMetadata() {
  console.log('🔧  Migrating: Requirements → sequence_daily_caps + settings');
  const rows = sheetToArr('Requirements');
  if (!rows || rows.length < 335) {
    console.log('  ⚠️  Requirements sheet not found or too short');
    return;
  }

  // Row 1 (0-indexed) = column headers; sequence names in cols 65-99
  const STANDARDS_START = 65;
  const SEQ_COUNT = 35;
  const headerRow = rows[1] || [];
  const sequenceNames = [];
  for (let i = 0; i < SEQ_COUNT; i++) {
    const name = headerRow[STANDARDS_START + i];
    sequenceNames.push(name ? String(name).trim() : `Seq${i}`);
  }

  // Find monthly block starts by looking for repeated first sequence name
  const firstSeqName = sequenceNames[0]; // 'Draw'
  const MONTH_STARTS = [];
  for (let c = STANDARDS_START + SEQ_COUNT + 1; c < (headerRow.length || 0); c++) {
    const cell = headerRow[c];
    if (cell && String(cell).trim() === firstSeqName) {
      MONTH_STARTS.push(c);
      if (MONTH_STARTS.length === 12) break;
    }
  }
  const FALLBACK = [101, 137, 173, 209, 245, 281, 317, 353, 389, 425, 461, 497];
  for (let m = 0; m < 12; m++) {
    if (MONTH_STARTS[m] == null) MONTH_STARTS[m] = FALLBACK[m];
  }

  // OE factor: row 327 (0-indexed), col 2 = cell C328
  let oeFactor = 0.10;
  if (rows[327] && rows[327][2] !== null && rows[327][2] !== undefined) {
    const v = parseNum(rows[327][2]);
    if (v !== null && v > 0) oeFactor = v;
  }

  // Sequence daily caps: row 333 (0-indexed), January block = MONTH_STARTS[0]
  const capsRow = rows[333] || [];
  const caps = {};
  for (let i = 0; i < SEQ_COUNT; i++) {
    const cap = parseNum(capsRow[MONTH_STARTS[0] + i]);
    if (cap !== null && cap > 0) {
      caps[sequenceNames[i]] = cap;
    }
  }

  const capStmt = db.prepare(`
    INSERT OR REPLACE INTO sequence_daily_caps (sequence, daily_cap_hours)
    VALUES (@sequence, @daily_cap_hours)
  `);
  const setStmt = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)
  `);

  const run = db.transaction(() => {
    for (const [seq, cap] of Object.entries(caps)) {
      capStmt.run({ sequence: seq, daily_cap_hours: cap });
    }
    setStmt.run({ key: 'oe_factor', value: String(oeFactor) });
  });
  run();

  countInserted('sequence_daily_caps', Object.keys(caps).length);
  console.log(`  ✓  OE factor: ${oeFactor}`);
}

// ─── 9. Changes tab ───────────────────────────────────────────────────────────

function migrateChanges() {
  console.log('📋  Migrating: Changes → forecast_changes + forecast_change_groups');
  const rows = sheetToArr('Changes');
  if (!rows || rows.length < 3) { console.log('  ⚠️  Sheet not found or empty'); return; }

  // Row 0: [None, None, 2026]
  // Row 1: [None, 'Comments', 'Jan', 'Feb', ..., 'Dec']  — headers
  // Rows 2-11 (Excel rows 3-12): Special/complex items
  // Row 12 (Excel row 13): An internal note — skip
  // Rows 13+ (Excel rows 14+): Simple per-item overrides

  const changeStmt = db.prepare(`
    INSERT INTO forecast_changes (item_number, month, override_qty, comment)
    VALUES (@item_number, @month, @override_qty, @comment)
  `);
  const groupStmt = db.prepare(`
    INSERT INTO forecast_change_groups (group_name, target_item, comment)
    VALUES (@group_name, @target_item, @comment)
  `);
  const memberStmt = db.prepare(`
    INSERT INTO forecast_change_group_members
      (group_id, item_number, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec)
    VALUES
      (@group_id, @item_number, @jan, @feb, @mar, @apr, @may, @jun, @jul, @aug, @sep, @oct, @nov, @dec)
  `);

  let changeCount = 0;
  let groupCount  = 0;

  function hasMonthlyData(row) {
    // Cols 2-13 = Jan-Dec
    return MONTHS_SHORT.some((_, m) => parseNum(row[m + 2]) !== null);
  }

  function rowToMonths(row) {
    return {
      jan: parseNum(row[2]),  feb: parseNum(row[3]),  mar: parseNum(row[4]),
      apr: parseNum(row[5]),  may: parseNum(row[6]),  jun: parseNum(row[7]),
      jul: parseNum(row[8]),  aug: parseNum(row[9]),  sep: parseNum(row[10]),
      oct: parseNum(row[11]), nov: parseNum(row[12]), dec: parseNum(row[13]),
    };
  }

  const run = db.transaction(() => {
    // ── SPECIAL ROWS (Excel rows 3-12, 0-indexed rows 2-11) ────────────────
    // Detect groups: a row where col 1 (Comments) starts with 'Add' and has NO monthly data
    // The rows immediately following (until the next group header or end of special section)
    // are the members of that group.

    let currentGroupId = null;

    for (let i = 2; i <= 11; i++) {
      const r = rows[i];
      if (!r) continue;

      const itemRaw = r[0];
      const comment = cleanStr(r[1]);
      const itemNum = cleanStr(itemRaw !== null ? String(itemRaw) : null);

      if (!itemNum) continue;

      // Is this a group header? (has comment starting with 'Add', no monthly data)
      const isGroupHeader = comment &&
        (comment.toLowerCase().startsWith('add') || comment.includes('(')) &&
        !hasMonthlyData(r);

      if (isGroupHeader) {
        // Create a new group — the target item is the item in this row
        const groupName = comment.length > 50 ? comment.slice(0, 50) : comment;
        const result = groupStmt.run({
          group_name:  groupName,
          target_item: itemNum,
          comment:     comment,
        });
        currentGroupId = result.lastInsertRowid;
        groupCount++;

        // Also add the target item itself as a member of the group
        // (so when we sum group members, this item's own Oracle qty is included)
        memberStmt.run({
          group_id: currentGroupId,
          item_number: itemNum,
          jan: null, feb: null, mar: null, apr: null,
          may: null, jun: null, jul: null, aug: null,
          sep: null, oct: null, nov: null, dec: null,
        });

      } else if (currentGroupId !== null && !hasMonthlyData(r) === false) {
        // Row has monthly data and we're inside a group — treat as a group member
        const months = rowToMonths(r);
        memberStmt.run({ group_id: currentGroupId, item_number: itemNum, ...months });

      } else {
        // Row has monthly data but no active group, OR it's in the special section
        // but acts as a standalone override. Store as a simple change.
        currentGroupId = null; // reset group context when we hit a standalone row
        const months = rowToMonths(r);
        for (let m = 0; m < 12; m++) {
          const qty = parseNum(r[m + 2]);
          if (qty === null) continue;
          changeStmt.run({
            item_number:  itemNum,
            month:        MONTHS_FULL[m],
            override_qty: qty,
            comment:      comment,
          });
          changeCount++;
        }
      }
    }

    // ── SIMPLE OVERRIDE ROWS (Excel rows 14-71, 0-indexed rows 13-70) ──────
    for (let i = 13; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;

      const itemRaw = r[0];
      if (itemRaw === null || itemRaw === undefined) continue;
      const itemNum = cleanStr(String(itemRaw));
      if (!itemNum) continue;

      // Skip if this looks like a note or header (non-numeric item number with no monthly data)
      if (typeof itemRaw === 'string' && !hasMonthlyData(r)) continue;

      const comment = cleanStr(r[1]);

      for (let m = 0; m < 12; m++) {
        const qty = parseNum(r[m + 2]);
        if (qty === null) continue;
        changeStmt.run({
          item_number:  itemNum,
          month:        MONTHS_FULL[m],
          override_qty: qty,
          comment:      comment,
        });
        changeCount++;
      }
    }
  });

  run();
  countInserted('forecast_changes', changeCount);
  countInserted('forecast_change_groups', groupCount);
}

// ─── 10. Employees (7 department staffing sheets) ─────────────────────────────

function migrateEmployees() {
  console.log('👤  Migrating: Dept sheets → employees');

  const stmt = db.prepare(`
    INSERT INTO employees (name, department, shift, function, status)
    VALUES (@name, @department, @shift, @function, @status)
  `);

  const SHIFT_COLS = {
    'A/1st': 2,
    'B/2nd': 3,
    'C/3rd': 4,
    'Floater': 5,
  };

  // Status keywords to detect when a cell is not a name
  const STATUS_KEYWORDS = [
    'headcount', 'fmla', 'recruiting', 'partial', 'exempt', 'working',
    'demand', 'capacity', 'hr ', 'npi', '2025', '2026', 'actual',
    'shift', 'ask', 'name', 'lead', 'trainer', 'utility'
  ];

  function isLikelyName(val) {
    if (!val) return false;
    const s = String(val).trim();
    if (s.length < 3) return false;
    if (typeof val === 'number') return false;
    const lower = s.toLowerCase();
    // Reject if it matches known status/header keywords
    if (STATUS_KEYWORDS.some(k => lower.includes(k))) return false;
    // Must look like a name (letters, spaces, parentheses for nicknames)
    return /^[A-Za-z\s().'-]+$/.test(s);
  }

  let totalCount = 0;

  for (const [sheetName, deptLabel] of Object.entries(DEPT_SHEETS)) {
    const rows = sheetToArr(sheetName);
    if (!rows) { console.log(`  ⚠️  Sheet not found: ${sheetName}`); continue; }

    let count = 0;
    const seen = new Set();

    const run = db.transaction(() => {
      let currentFunction = null;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;

        // Col B (index 1) = function/role label (e.g., 'Extrusion', 'Inspection')
        const funcCell = cleanStr(r[1]);
        if (funcCell && isLikelyName(funcCell) === false &&
            typeof r[1] === 'string' && r[1].trim().length > 0 &&
            !r[1].trim().match(/^\d/)) {
          // Check if it's a function header (not a name, not a number)
          const lc = funcCell.toLowerCase();
          if (!STATUS_KEYWORDS.some(k => lc === k) && lc !== '') {
            currentFunction = funcCell;
          }
        }

        // Scan shift columns C, D, E, F (indices 2-5) for employee names
        for (const [shiftLabel, colIdx] of Object.entries(SHIFT_COLS)) {
          const cellVal = r[colIdx];
          if (!isLikelyName(cellVal)) continue;

          // Strip parenthetical nicknames: "Brad Gatlin (Thomas)" → "Brad Gatlin"
          const rawName = String(cellVal).trim();
          const name = rawName.replace(/\s*\([^)]+\)\s*$/, '').trim();

          // Skip if name contains 'Recruiting' or is a status word
          if (!name || seen.has(name + shiftLabel)) continue;

          // Determine status from raw cell
          let status = 'Active';
          if (/recruiting/i.test(rawName)) status = 'Recruiting';
          else if (/fmla/i.test(rawName)) status = 'FMLA';

          seen.add(name + shiftLabel);
          stmt.run({
            name,
            department: deptLabel,
            shift:      shiftLabel,
            function:   currentFunction,
            status,
          });
          count++;
        }
      }
    });
    run();
    console.log(`  ✓  ${deptLabel}: ${count} employees`);
    totalCount += count;
  }

  countInserted('employees (total)', totalCount);
}

// ─── 11. Oven Info ────────────────────────────────────────────────────────────

function migrateOvenInfo() {
  console.log('🏭  Migrating: PI/PTFE Oven Info → oven_info');

  const stmt = db.prepare(`
    INSERT INTO oven_info (oven_type, oven_number, size, heads, rollers, annealers, payoffs, takeups, laser_mics, notes)
    VALUES (@oven_type, @oven_number, @size, @heads, @rollers, @annealers, @payoffs, @takeups, @laser_mics, @notes)
  `);

  // PI Oven Info: Row 0 = oven numbers (as header row), rows 1+ = attributes
  // Attributes in col 0: Size, Heads, Rollers, Annealers, Payoffs, Takeups, Laser Mics
  function parseOvenSheet(sheetName, ovenType) {
    const rows = sheetToArr(sheetName);
    if (!rows || rows.length < 2) return 0;

    // Row 0 = [None, oven_number1, oven_number2, ...]
    const ovenNums = rows[0].slice(1).map(v => cleanStr(v)).filter(Boolean);

    const attrMap = { size: null, heads: null, rollers: null, annealers: null, payoffs: null, takeups: null, laser_mics: null };
    const attrRows = {}; // attribute label → row index

    for (let i = 1; i < rows.length; i++) {
      const label = cleanStr(rows[i][0]);
      if (!label) continue;
      const lc = label.toLowerCase();
      if (lc.includes('size') || lc === ovenType.toLowerCase() + ' s' || lc === ovenType.toLowerCase() + ' m' || lc === ovenType.toLowerCase() + ' l' || lc.includes('pi base') || lc.includes('ptfe')) {
        attrRows.size = i;
      } else if (lc === 'heads') attrRows.heads = i;
      else if (lc === 'rollers') attrRows.rollers = i;
      else if (lc === 'annealers') attrRows.annealers = i;
      else if (lc === 'payoffs') attrRows.payoffs = i;
      else if (lc === 'takeups') attrRows.takeups = i;
      else if (lc.includes('laser')) attrRows.laser_mics = i;
    }

    let count = 0;
    const run = db.transaction(() => {
      for (let j = 0; j < ovenNums.length; j++) {
        const col = j + 1;
        stmt.run({
          oven_type:   ovenType,
          oven_number: ovenNums[j],
          size:        attrRows.size       != null ? cleanStr(rows[attrRows.size][col])       : null,
          heads:       attrRows.heads      != null ? parseNum(rows[attrRows.heads][col])      : null,
          rollers:     attrRows.rollers    != null ? parseNum(rows[attrRows.rollers][col])    : null,
          annealers:   attrRows.annealers  != null ? parseNum(rows[attrRows.annealers][col])  : null,
          payoffs:     attrRows.payoffs    != null ? parseNum(rows[attrRows.payoffs][col])    : null,
          takeups:     attrRows.takeups    != null ? parseNum(rows[attrRows.takeups][col])    : null,
          laser_mics:  attrRows.laser_mics != null ? parseNum(rows[attrRows.laser_mics][col]) : null,
          notes:       null,
        });
        count++;
      }
    });
    run();
    return count;
  }

  const piCount   = parseOvenSheet('PI Oven Info',   'PI');
  const ptfeCount = parseOvenSheet('PTFE Oven Info', 'PTFE');
  countInserted('oven_info (PI)',   piCount);
  countInserted('oven_info (PTFE)', ptfeCount);
}

// ─── Run all migrations ───────────────────────────────────────────────────────

console.log('═'.repeat(60));
console.log('  Capacity Model — Excel → SQLite Migration');
console.log('═'.repeat(60));

migrateItems();
migrateMachineStandards();
migrateDrawStandards();
migrateFinishingStandards();
migrateYields();
migrateCapacity();
migrateDaysInMonth();
migrateRequirementsMetadata();
migrateChanges();
migrateEmployees();
migrateOvenInfo();

db.close();

console.log('\n' + '═'.repeat(60));
console.log('✅  Migration complete!');
console.log(`    Database: ${DB_PATH}`);
console.log('═'.repeat(60) + '\n');
