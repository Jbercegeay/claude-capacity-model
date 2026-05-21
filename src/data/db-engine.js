/**
 * db-engine.js — Server-side calculation engine (Phase 2)
 *
 * Replaces the Excel-based Requirements sheet calculation.
 * Reads all inputs from SQLite, applies Changes overrides,
 * then produces the same output shape as demand-calc.js.
 *
 * Reverse-engineered Requirements sheet formulas:
 *
 *   FINISHING standards (Long Pull, Inspection, CTL, etc.):
 *     The standard value is THROUGHPUT RATE in units/hour.
 *     hoursPerUnit = 1 / std.value
 *     (Raw forecast qty is used directly — no yield, no length adjustment)
 *
 *   MACHINE + DRAW standards (PI Base, PTFE, Braid, Draw, etc.):
 *     The standard value is THROUGHPUT RATE in feet/hour.
 *     hoursPerUnit = length_ft_per_unit / yield / std.value
 *     Where length_ft_per_unit:
 *       EA → fg_length_inches / 12
 *       FT → 1.0 (qty already in feet)
 *       IN → 1/12
 *       CM → 1/30.48
 *       ME → 3.2808399
 *       MM → 0.00328084
 *
 *   Then: hc = hours × (1 + oe_factor) / daily_cap / working_days
 */

export const MONTHS_FULL = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

const VS_ALIASES = {
  // Short-form aliases (from original workbook)
  polyimide: 'PI',
  extrusion: 'Ex',
  precision: 'PL',
  // Full Oracle value stream names → capacity table short names
  'trn pi vs':                       'PI',
  'trn ptfe vs':                     'PTFE',
  'trn extrusion vs':                'Ex',
  'trn access dlvry catheter vs':    'AC/DC',
  'trn micro and ep catheter vs':    'Micro Cath',
  // NPI items span multiple VS — left unmapped so they still appear in plantTotal/bySequence
};

// Support capacity can work across sequences, so it should not become a sequence row.
const SUPPORT_CAPACITY_PROCESSES = new Set(['floater']);

export function isSupportCapacityProcess(processName) {
  return SUPPORT_CAPACITY_PROCESSES.has(String(processName || '').trim().toLowerCase());
}

function normalizeVS(raw) {
  if (!raw || !raw.trim()) return null;
  const lower = raw.toLowerCase().trim();
  return VS_ALIASES[lower] || raw.trim();
}

function isPlantTotalValueStream(valueStream) {
  return !valueStream || String(valueStream).trim().toLowerCase() === 'total';
}

/**
 * Convert item quantity (1 unit) to feet based on UOM and fg_length.
 * This is the "length per unit" used by machine/draw standards.
 *
 * @param {string} uom       - UOM from items table ('EA', 'FT', 'IN', 'CM', 'ME', 'MM')
 * @param {number} fg_length - finished-goods length in INCHES (from items.fg_length)
 * @returns {number} length in feet per unit
 */
function lengthFtPerUnit(uom, fg_length) {
  const u = (uom || '').toUpperCase().trim();
  switch (u) {
    case 'EA': return (fg_length || 0) / 12;
    case 'FT': return 1.0;
    case 'IN': return 1.0 / 12;
    case 'CM': return 1.0 / 30.48;
    case 'ME': return 3.2808399;
    case 'MM': return 0.00328084;
    default:   return (fg_length || 0) / 12; // assume EA
  }
}

// ─── Load all inputs from DB ──────────────────────────────────────────────────

export function loadInputsFromDB(db) {
  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])
  );

  // standards[itemNumber][sequence] = { value, type }
  const standards = {};
  for (const row of db.prepare(
    'SELECT item_number, sequence, seconds_per_unit, standard_type FROM item_standards'
  ).all()) {
    if (isSupportCapacityProcess(row.sequence)) continue;
    if (!standards[row.item_number]) standards[row.item_number] = {};
    standards[row.item_number][row.sequence] = {
      value: row.seconds_per_unit,
      type:  row.standard_type,   // 'machine', 'draw', 'finishing'
    };
  }

  // yields[itemNumber] = yield decimal
  const yields = {};
  for (const row of db.prepare('SELECT item_number, yield FROM yields').all()) {
    yields[row.item_number] = row.yield;
  }

  // items[itemNumber] = { value_stream, uom, fg_length }
  const items = {};
  for (const row of db.prepare(
    'SELECT item_number, value_stream, uom, fg_length FROM items'
  ).all()) {
    items[row.item_number] = row;
  }

  // capacityRows — process × value_stream × capacity × uom
  const capacityRows = db.prepare('SELECT * FROM capacity')
    .all()
    .filter(row => !isSupportCapacityProcess(row.process));

  // sequenceDailyCaps[sequence] = daily_cap_hours
  const sequenceDailyCaps = {};
  for (const row of db.prepare('SELECT sequence, daily_cap_hours FROM sequence_daily_caps').all()) {
    sequenceDailyCaps[row.sequence] = row.daily_cap_hours;
  }

  // workingDaysByScheduleAndMonth['5 Day']['January'] = days
  const workingDaysByScheduleAndMonth = {};
  for (const row of db.prepare('SELECT schedule, month, days FROM days_in_month').all()) {
    if (!workingDaysByScheduleAndMonth[row.schedule]) {
      workingDaysByScheduleAndMonth[row.schedule] = {};
    }
    workingDaysByScheduleAndMonth[row.schedule][row.month] = row.days;
  }

  // forecastChanges[itemNumber][month] = override_qty
  const forecastChanges = {};
  for (const row of db.prepare('SELECT item_number, month, override_qty FROM forecast_changes').all()) {
    if (!forecastChanges[row.item_number]) forecastChanges[row.item_number] = {};
    forecastChanges[row.item_number][row.month] = row.override_qty;
  }

  // changeGroups and members
  const changeGroups = db.prepare('SELECT id, target_item FROM forecast_change_groups').all();
  const changeGroupMembers = db.prepare('SELECT * FROM forecast_change_group_members').all();

  const oeFactor = parseFloat(settings['oe_factor'] || '0.10');

  return {
    settings,
    standards,
    yields,
    items,
    capacityRows,
    sequenceDailyCaps,
    workingDaysByScheduleAndMonth,
    forecastChanges,
    changeGroups,
    changeGroupMembers,
    oeFactor,
  };
}

// ─── Apply Changes to Oracle forecast ────────────────────────────────────────

/**
 * Returns a modified oracle forecast with Changes overrides applied.
 */
export function applyChanges(oracleForecast, forecastChanges, changeGroups, changeGroupMembers) {
  const firmPO   = deepCopyMonths(oracleForecast.firmPO);
  const forecast = deepCopyMonths(oracleForecast.forecast);

  const MONTH_COLS = {
    January:'jan', February:'feb', March:'mar', April:'apr',
    May:'may', June:'jun', July:'jul', August:'aug',
    September:'sep', October:'oct', November:'nov', December:'dec',
  };

  // 1. Group-sum logic
  for (const group of changeGroups) {
    const members = changeGroupMembers.filter(m => m.group_id === group.id);
    if (!members.length) continue;

    const sumByMonth = {};
    for (const month of MONTHS_FULL) {
      let total = 0;
      for (const member of members) {
        const colName = MONTH_COLS[month];
        const memberOverride = member[colName];
        if (memberOverride !== null && memberOverride !== undefined) {
          total += memberOverride;
        } else {
          const oracle = forecast[member.item_number];
          if (oracle && oracle[month]) total += oracle[month];
          const po = firmPO[member.item_number];
          if (po && po[month]) total += po[month];
        }
      }
      sumByMonth[month] = total;
    }
    forecast[group.target_item] = sumByMonth;
  }

  // 2. Simple per-item overrides
  for (const [item, monthOverrides] of Object.entries(forecastChanges)) {
    for (const [month, qty] of Object.entries(monthOverrides)) {
      if (!forecast[item]) forecast[item] = {};
      forecast[item][month] = qty;
    }
  }

  return { firmPO, forecast };
}

function deepCopyMonths(obj) {
  const copy = {};
  for (const [item, months] of Object.entries(obj)) {
    copy[item] = { ...months };
  }
  return copy;
}

const COVERAGE_MODES = new Set(['official', 'review', 'combined']);

function normalizeCoverageMode(raw) {
  return COVERAGE_MODES.has(raw) ? raw : 'official';
}

function hasRequirementsItem(requirementsCoverage, itemNum) {
  if (!requirementsCoverage?.available || !requirementsCoverage.itemSet) return true;
  return requirementsCoverage.itemSet.has(String(itemNum).trim());
}

// ─── Core calculation engine ──────────────────────────────────────────────────

/**
 * Full demand calculation pipeline.
 *
 * @param {Object} oracleForecast - after applyChanges: { firmPO, forecast }
 * @param {Object} inputs         - from loadInputsFromDB()
 * @param {string} schedule       - '5 Day' | '7 Day'
 * @param {Object} options        - { coverageMode, requirementsCoverage }
 * @returns Demand breakdown matching demand-calc.js output shape
 */
export function calculateDemand(oracleForecast, inputs, schedule = '5 Day', options = {}) {
  const {
    standards, yields, items, capacityRows,
    sequenceDailyCaps, workingDaysByScheduleAndMonth, oeFactor,
  } = inputs;

  const coverageMode = normalizeCoverageMode(options.coverageMode);
  const requirementsCoverage = options.requirementsCoverage || null;
  const includeMachineSequences = options.includeMachineSequences === true;
  const workingDaysByMonth = workingDaysByScheduleAndMonth[schedule] || {};

  // Build capacity lookups from DB rows.
  // Plant Total uses workbook Total rows; VS drilldowns use only VS-specific rows.
  const capacityBySeqVS = {};  // seq -> vs -> capacity (HC)
  const capacityBySeq   = {};  // seq -> plant-total capacity
  const seqToUom        = {};

  for (const row of capacityRows) {
    const seq = row.process;
    const vs  = normalizeVS(row.value_stream);
    if (!seq) continue;

    seqToUom[seq] = row.uom;
    if (!includeMachineSequences && row.uom === 'Heads') continue;

    if (isPlantTotalValueStream(vs)) {
      capacityBySeq[seq] = (capacityBySeq[seq] || 0) + row.capacity;
    } else {
      if (!capacityBySeqVS[seq]) capacityBySeqVS[seq] = {};
      capacityBySeqVS[seq][vs] = (capacityBySeqVS[seq][vs] || 0) + row.capacity;
    }
  }

  // Case-insensitive daily-cap lookup
  const capByNorm = {};
  for (const [name, cap] of Object.entries(sequenceDailyCaps)) {
    capByNorm[name.toLowerCase().trim()] = cap;
  }
  function resolveCap(seq) {
    return sequenceDailyCaps[seq] ?? capByNorm[seq.toLowerCase().trim()] ?? null;
  }

  function resolveWorkingDays(month) {
    return workingDaysByMonth[month] || 18;
  }

  // Compute hoursPerUnit for a given item × sequence
  function computeHoursPerUnit(itemNum, seqName, stdInfo) {
    const itemYield = yields[itemNum] || 1.0;
    const itemInfo  = items[itemNum];

    if (stdInfo.type === 'finishing') {
      // Finishing: throughput rate in units/hr → hoursPerUnit = 1/rate
      // No yield, no length adjustment (formula uses raw forecast qty)
      return 1.0 / stdInfo.value;
    } else {
      // Machine or Draw: throughput rate in feet/hr
      // hoursPerUnit = length_ft_per_unit / yield / rate
      const uom = itemInfo?.uom || 'EA';
      const fgLen = itemInfo?.fg_length;
      const lenFt = lengthFtPerUnit(uom, fgLen);
      if (lenFt === 0) return 0; // EA item with no fg_length → skip
      return lenFt / itemYield / stdInfo.value;
    }
  }

  // Accumulate hours and HC
  const bySequence       = {};
  const byVSDemand       = {};
  const byVSAndSeqDemand = {};
  const unmatched        = { firmPO: new Set(), forecast: new Set() };
  const vsUnassigned     = { firmPO: new Set(), forecast: new Set() };
  const coverageSkipped  = { firmPO: new Set(), forecast: new Set() };
  const reviewItems      = new Map();
  const reviewDetails    = [];
  const noStandardDemand = new Map();

  function shouldIncludeItem(itemNum, type) {
    const inRequirements = hasRequirementsItem(requirementsCoverage, itemNum);
    if (coverageMode === 'official' && !inRequirements) {
      coverageSkipped[type].add(itemNum);
      return false;
    }
    if (coverageMode === 'review' && inRequirements) {
      return false;
    }
    return true;
  }

  function recordNoStandardDemand(type, itemNum, monthQtys) {
    const months = {};
    let totalQty = 0;

    for (const [month, qty] of Object.entries(monthQtys)) {
      if (!qty || qty === 0) continue;
      months[month] = (months[month] || 0) + qty;
      totalQty += qty;
    }
    if (!totalQty) return;

    const itemInfo = items[itemNum];
    const itemVS = normalizeVS(itemInfo?.value_stream);
    const key = `${type}|${itemNum}`;
    noStandardDemand.set(key, {
      demandType: type,
      itemNumber: itemNum,
      valueStream: itemVS || itemInfo?.value_stream || '',
      uom: itemInfo?.uom || '',
      fgLength: itemInfo?.fg_length ?? null,
      inItemsDb: !!itemInfo,
      inRequirements: requirementsCoverage?.available
        ? requirementsCoverage.itemSet.has(String(itemNum).trim())
        : null,
      totalQty,
      months,
    });
  }

  function hasDemandQty(monthQtys) {
    return Object.values(monthQtys || {}).some(qty => qty && qty !== 0);
  }

  function addReviewDetail({ type, itemNum, itemInfo, itemVS, seq, stdInfo, month, qty, hoursPerUnit, hours, hc }) {
    if (hasRequirementsItem(requirementsCoverage, itemNum)) return;

    if (!reviewItems.has(itemNum)) {
      reviewItems.set(itemNum, {
        itemNumber: itemNum,
        valueStream: itemVS || itemInfo?.value_stream || '',
        uom: itemInfo?.uom || '',
        fgLength: itemInfo?.fg_length ?? null,
        demandHours: 0,
        demandHC: 0,
        standards: new Set(),
      });
    }

    const reviewItem = reviewItems.get(itemNum);
    reviewItem.demandHours += hours;
    reviewItem.demandHC += hc;
    reviewItem.standards.add(stdInfo.type);

    reviewDetails.push({
      demandType: type,
      itemNumber: itemNum,
      valueStream: itemVS || itemInfo?.value_stream || '',
      month,
      sequence: seq,
      qty,
      standardType: stdInfo.type,
      standardValue: stdInfo.value,
      hoursPerUnit,
      demandHours: hours,
      demandHC: hc,
      reason: 'Item not found in Requirements sheet',
    });
  }

  function addHours(type, itemNum, monthQtys) {
    const itemStds = standards[itemNum];
    if (!itemStds) {
      if (hasDemandQty(monthQtys)) {
        unmatched[type].add(itemNum);
        recordNoStandardDemand(type, itemNum, monthQtys);
      }
      return;
    }
    if (!shouldIncludeItem(itemNum, type)) return;

    const itemInfo = items[itemNum];
    const itemVS   = normalizeVS(itemInfo?.value_stream);
    if (!itemVS) vsUnassigned[type].add(itemNum);

    for (const [month, qty] of Object.entries(monthQtys)) {
      if (!qty || qty === 0) continue;

      for (const [seq, stdInfo] of Object.entries(itemStds)) {
        // Skip machine sequences (UOM = Heads) — demand breakdown compares human constraints only
        if (!includeMachineSequences) {
          const isPeopleSequence = seqToUom[seq] === 'People' || (!seqToUom[seq] && stdInfo.type === 'finishing');
          if (!isPeopleSequence) continue;
        }

        const hoursPerUnit = computeHoursPerUnit(itemNum, seq, stdInfo);
        if (!hoursPerUnit || hoursPerUnit <= 0) continue;

        const hours = qty * hoursPerUnit;
        const cap   = resolveCap(seq);
        const wd    = resolveWorkingDays(month);
        const hc    = cap ? hours * (1 + oeFactor) / cap / wd : 0;
        addReviewDetail({ type, itemNum, itemInfo, itemVS, seq, stdInfo, month, qty, hoursPerUnit, hours, hc });

        // bySequence
        if (!bySequence[seq]) bySequence[seq] = {};
        if (!bySequence[seq][month]) {
          bySequence[seq][month] = { firmPO: 0, forecast: 0, firmPO_hc: 0, forecast_hc: 0 };
        }
        bySequence[seq][month][type]         += hours;
        bySequence[seq][month][type + '_hc'] += hc;

        // byVSDemand
        if (itemVS) {
          if (!byVSDemand[itemVS]) byVSDemand[itemVS] = {};
          if (!byVSDemand[itemVS][month]) {
            byVSDemand[itemVS][month] = { firmPO: 0, forecast: 0, firmPO_hc: 0, forecast_hc: 0 };
          }
          byVSDemand[itemVS][month][type]         += hours;
          byVSDemand[itemVS][month][type + '_hc'] += hc;

          // byVSAndSeqDemand
          if (!byVSAndSeqDemand[itemVS]) byVSAndSeqDemand[itemVS] = {};
          if (!byVSAndSeqDemand[itemVS][seq]) byVSAndSeqDemand[itemVS][seq] = {};
          if (!byVSAndSeqDemand[itemVS][seq][month]) {
            byVSAndSeqDemand[itemVS][seq][month] = { firmPO: 0, forecast: 0, firmPO_hc: 0, forecast_hc: 0 };
          }
          byVSAndSeqDemand[itemVS][seq][month][type]         += hours;
          byVSAndSeqDemand[itemVS][seq][month][type + '_hc'] += hc;
        }
      }
    }
  }

  for (const [item, monthQtys] of Object.entries(oracleForecast.firmPO)) {
    addHours('firmPO', item, monthQtys);
  }
  for (const [item, monthQtys] of Object.entries(oracleForecast.forecast)) {
    addHours('forecast', item, monthQtys);
  }

  // Collect all VS from capacity table
  const allVS = new Set();
  for (const vsMap of Object.values(capacityBySeqVS)) {
    for (const vs of Object.keys(vsMap)) allVS.add(vs);
  }

  const result = {
    bySequence: {},
    byValueStream: {},
    byVSAndSequence: {},
    plantTotal: {},
    sequences: [],
    valueStreams: [...allVS].sort(),
    seqToUom,   // seq → 'People' | 'Heads' — lets frontend label machine rows
    unmatched: { firmPO: unmatched.firmPO.size, forecast: unmatched.forecast.size },
    vsUnassigned: { firmPO: vsUnassigned.firmPO.size, forecast: vsUnassigned.forecast.size },
    coverage: {
      mode: coverageMode,
      requirementsAvailable: !!requirementsCoverage?.available,
      requirementsSourceFile: requirementsCoverage?.sourceFile || null,
      requirementsSourcePath: requirementsCoverage?.sourcePath || null,
      requirementsItemCount: requirementsCoverage?.itemCount || 0,
      excludedAdditionalItems: {
        firmPO: coverageSkipped.firmPO.size,
        forecast: coverageSkipped.forecast.size,
      },
      reviewItemCount: reviewItems.size,
    },
    reviewItems: [],
    reviewDetails,
    noStandardDemand: [],
  };

  // ── bySequence + plantTotal ──────────────────────────────────────────────
  function buildSeqEntry(seq, monthData) {
    result.bySequence[seq] = { months: {} };
    const dailyCap = resolveCap(seq);

    for (const month of MONTHS_FULL) {
      const demand   = monthData[month] || { firmPO: 0, forecast: 0, firmPO_hc: 0, forecast_hc: 0 };
      const capacity = capacityBySeq[seq] || 0;
      const wd       = resolveWorkingDays(month);
      const hrsAvail = dailyCap ? capacity * dailyCap * wd : 0;

      const totalDemand    = demand.forecast;
      const totalDemand_hc = demand.forecast_hc;

      result.bySequence[seq].months[month] = {
        firmPO: demand.firmPO, forecast: demand.forecast,
        totalDemand, capacity, hrsAvail,
        delta: capacity - totalDemand, delta_hc: capacity - totalDemand_hc,
        firmPO_hc: demand.firmPO_hc, forecast_hc: demand.forecast_hc,
        totalDemand_hc,
      };

      if (!result.plantTotal[month]) {
        result.plantTotal[month] = {
          firmPO: 0, forecast: 0, totalDemand: 0, capacity: 0, hrsAvail: 0, delta: 0,
          firmPO_hc: 0, forecast_hc: 0, totalDemand_hc: 0, delta_hc: 0,
        };
      }
      const pt = result.plantTotal[month];
      pt.firmPO         += demand.firmPO;
      pt.forecast       += demand.forecast;
      pt.totalDemand    += totalDemand;
      pt.capacity       += capacity;
      pt.hrsAvail       += hrsAvail;
      pt.delta          += capacity - totalDemand;
      pt.firmPO_hc      += demand.firmPO_hc;
      pt.forecast_hc    += demand.forecast_hc;
      pt.totalDemand_hc += totalDemand_hc;
      pt.delta_hc       += capacity - totalDemand_hc;
    }
  }

  for (const [seq, monthData] of Object.entries(bySequence)) {
    buildSeqEntry(seq, monthData);
  }
  for (const seq of Object.keys(capacityBySeq)) {
    if (!result.bySequence[seq]) {
      buildSeqEntry(seq, {});
    }
  }
  result.sequences = Object.keys(result.bySequence).sort();

  // ── byValueStream ─────────────────────────────────────────────────────────
  const capacityByVS  = {};
  const hrsAvailByVS  = {};
  for (const [seq, vsData] of Object.entries(capacityBySeqVS)) {
    if (!includeMachineSequences && seqToUom[seq] === 'Heads') continue;
    const seqDailyCap = resolveCap(seq);
    for (const [vs, hc] of Object.entries(vsData)) {
      if (!capacityByVS[vs]) capacityByVS[vs] = {};
      if (!hrsAvailByVS[vs]) hrsAvailByVS[vs] = {};
      for (const month of MONTHS_FULL) {
        capacityByVS[vs][month] = (capacityByVS[vs][month] || 0) + hc;
        if (seqDailyCap) {
          hrsAvailByVS[vs][month] = (hrsAvailByVS[vs][month] || 0)
            + hc * seqDailyCap * resolveWorkingDays(month);
        }
      }
    }
  }

  for (const vs of allVS) {
    result.byValueStream[vs] = {};
    for (const month of MONTHS_FULL) {
      const demand       = byVSDemand[vs]?.[month] || { firmPO: 0, forecast: 0, firmPO_hc: 0, forecast_hc: 0 };
      const capacity     = capacityByVS[vs]?.[month] || 0;
      const hrsAvail     = hrsAvailByVS[vs]?.[month] || 0;
      const totalDemand    = demand.forecast;
      const totalDemand_hc = demand.forecast_hc;
      result.byValueStream[vs][month] = {
        firmPO: demand.firmPO, forecast: demand.forecast,
        totalDemand, capacity, hrsAvail,
        delta: capacity - totalDemand, delta_hc: capacity - totalDemand_hc,
        firmPO_hc: demand.firmPO_hc, forecast_hc: demand.forecast_hc,
        totalDemand_hc,
      };
    }
  }

  // ── byVSAndSequence ───────────────────────────────────────────────────────
  for (const vs of allVS) {
    result.byVSAndSequence[vs] = {};
    const seqsForVS = new Set([
      ...Object.keys(byVSAndSeqDemand[vs] || {}),
      ...Object.keys(capacityBySeqVS).filter(seq => capacityBySeqVS[seq][vs]),
    ]);
    for (const seq of seqsForVS) {
      result.byVSAndSequence[vs][seq] = {};
      const seqDailyCap = resolveCap(seq);
      for (const month of MONTHS_FULL) {
        const demand   = byVSAndSeqDemand[vs]?.[seq]?.[month] || { firmPO: 0, forecast: 0, firmPO_hc: 0, forecast_hc: 0 };
        const capacity = capacityBySeqVS[seq]?.[vs] || 0;
        const wd       = resolveWorkingDays(month);
        const hrsAvail = seqDailyCap ? capacity * seqDailyCap * wd : 0;
        const totalDemand    = demand.forecast;
        const totalDemand_hc = demand.forecast_hc;
        result.byVSAndSequence[vs][seq][month] = {
          firmPO: demand.firmPO, forecast: demand.forecast,
          totalDemand, capacity, hrsAvail,
          delta: capacity - totalDemand, delta_hc: capacity - totalDemand_hc,
          firmPO_hc: demand.firmPO_hc, forecast_hc: demand.forecast_hc,
          totalDemand_hc,
        };
      }
    }
  }

  result.reviewItems = [...reviewItems.values()]
    .map(item => ({ ...item, standards: [...item.standards].sort() }))
    .sort((a, b) => b.demandHours - a.demandHours);
  result.reviewDetails.sort((a, b) => b.demandHours - a.demandHours);
  result.noStandardDemand = [...noStandardDemand.values()]
    .sort((a, b) => b.totalQty - a.totalQty || a.itemNumber.localeCompare(b.itemNumber));

  return result;
}

/**
 * Apply overtime percentage to monthly breakdown data.
 * Matches the applyOvertime signature in demand-calc.js.
 */
export function applyOvertime(monthlyData, otPercents) {
  const result = {};
  for (const month of MONTHS_FULL) {
    const data = monthlyData[month];
    if (!data) {
      result[month] = { ...data, otCapacity: 0, otDelta: 0, otDelta_hc: 0 };
      continue;
    }
    const otPct      = (otPercents && otPercents[month]) || 0;
    const otCapacity = data.capacity * (1 + otPct / 100);
    result[month] = {
      ...data,
      otCapacity,
      otDelta:    otCapacity - data.totalDemand,
      otDelta_hc: otCapacity - (data.totalDemand_hc || 0),
    };
  }
  return result;
}

/**
 * High-level entry point: load from DB, apply changes, run calculation.
 *
 * @param {Database} db            - node:sqlite DatabaseSync instance
 * @param {Object}   oracleForecast - { firmPO, forecast }
 * @param {string}   schedule      - '5 Day' | '7 Day'
 */
export function runEngine(db, oracleForecast, schedule = '5 Day', options = {}) {
  const inputs = loadInputsFromDB(db);
  const modifiedForecast = applyChanges(
    oracleForecast,
    inputs.forecastChanges,
    inputs.changeGroups,
    inputs.changeGroupMembers,
  );
  return calculateDemand(modifiedForecast, inputs, schedule, options);
}
