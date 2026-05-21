import { fetchDemandBreakdown } from '../data/api.js';

const MONTHS_FULL = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const COVERAGE_LABELS = {
  official: 'Official Requirements Items',
  review: 'Additional Review Items',
  combined: 'Combined Scenario',
};

function coverageLabel(mode) {
  return COVERAGE_LABELS[mode] || COVERAGE_LABELS.official;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function renderDemandBreakdown(container, schedule, coverageMode = 'official') {
  container.innerHTML = `<div class="loading-spinner animate-in">Loading Demand Breakdown…</div>`;

  let result;
  try {
    result = await fetchDemandBreakdown(schedule, coverageMode);
  } catch (err) {
    container.innerHTML = `
      <div class="view-header animate-in"><h1 class="view-title">Demand Breakdown</h1></div>
      <div class="error-banner animate-in">${err.message}</div>
      <div class="info-banner animate-in">Upload an Oracle TRN .xlsm file via Admin → Oracle Upload to enable this view.</div>
    `;
    return;
  }

  const { breakdown, oracleFile } = result;
  const coverage = result.coverage || breakdown.coverage || { mode: coverageMode };
  let level = 'plant';
  let filterValue = null;
  let seqFilter = null;
  let otPercents = {};

  function getViewData() {
    if (level === 'vsAndSequence' && breakdown.byVSAndSequence?.[filterValue]?.[seqFilter]) {
      return breakdown.byVSAndSequence[filterValue][seqFilter];
    }
    if (level === 'sequence' && breakdown.bySequence?.[filterValue]) {
      return breakdown.bySequence[filterValue].months;
    }
    if (level === 'valueStream' && breakdown.byValueStream?.[filterValue]) {
      return breakdown.byValueStream[filterValue];
    }
    return breakdown.plantTotal;
  }

  function applyOT(viewData) {
    const out = {};
    for (const month of MONTHS_FULL) {
      const d = viewData[month] || {};
      const pct = (otPercents[month] || 0) / 100;
      const otCapacity = (d.capacity || 0) * (1 + pct);
      out[month] = {
        ...d,
        otCapacity,
        otDelta_hc: otCapacity - (d.totalDemand_hc || 0),
      };
    }
    return out;
  }

  function fmt(v) {
    if (v === null || v === undefined) return '–';
    return Math.round(v).toLocaleString();
  }
  function fmtDec(v) {
    if (v === null || v === undefined) return '–';
    return v.toFixed(1);
  }

  function fmtDetail(v, digits = 2) {
    if (v === null || v === undefined) return '-';
    return Number(v).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function coverageMessage() {
    const mode = coverage.mode || coverageMode;
    if (mode === 'review') {
      return 'Showing only forecast demand for items that are not in the Requirements sheet. The review table below lists item numbers and standards for verification.';
    }
    if (mode === 'combined') {
      return 'Showing Requirements-covered demand plus the additional review items. The table below isolates the unverified items included in this scenario.';
    }
    const excluded = coverage.excludedAdditionalItems?.forecast || 0;
    return `Showing only items found in the Requirements sheet. ${excluded} additional forecast item${excluded === 1 ? '' : 's'} with DB standards are excluded from this official view.`;
  }

  function scopedReviewDetails() {
    let rows = breakdown.reviewDetails || [];
    if (level === 'valueStream' || level === 'vsAndSequence') {
      rows = rows.filter(row => row.valueStream === filterValue);
    }
    if (level === 'sequence' || level === 'vsAndSequence') {
      rows = rows.filter(row => row.sequence === (seqFilter || filterValue));
    }
    return rows;
  }

  function scopedNoStandardDemand() {
    let rows = breakdown.noStandardDemand || [];
    if (level === 'valueStream' || level === 'vsAndSequence') {
      rows = rows.filter(row => row.valueStream === filterValue);
    }
    return rows;
  }

  function noStandardScopeLabel() {
    if (level === 'vsAndSequence') {
      return `${filterValue} value stream; no sequence can be assigned until standards exist`;
    }
    if (level === 'valueStream') return `${filterValue} value stream`;
    return 'Plant total';
  }

  function fmtMonthQtys(months) {
    const parts = MONTHS_FULL
      .filter(month => months?.[month])
      .map(month => `${month.slice(0, 3)} ${fmtDetail(months[month], 0)}`);
    if (parts.length <= 6) return parts.join(', ');
    return `${parts.slice(0, 6).join(', ')} +${parts.length - 6} more`;
  }

  function buildReviewSection() {
    const mode = coverage.mode || coverageMode;
    if (mode === 'official') return '';

    const rows = scopedReviewDetails();
    const displayRows = rows.slice(0, 250);
    const uniqueItems = new Set(rows.map(row => row.itemNumber)).size;
    const totalHours = rows.reduce((sum, row) => sum + (row.demandHours || 0), 0);
    const totalHC = rows.reduce((sum, row) => sum + (row.demandHC || 0), 0);
    const title = mode === 'review' ? 'Review Items' : 'Unverified Items Included';

    return `
      <div class="card animate-in" style="margin-top:var(--space-md);padding:0;overflow:hidden;">
        <div style="padding:var(--space-md);border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;gap:var(--space-md);align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div class="card-title" style="margin-bottom:4px;">${title}</div>
            <div style="font-size:12px;color:var(--text-secondary);">
              ${uniqueItems.toLocaleString()} item${uniqueItems === 1 ? '' : 's'} · ${rows.length.toLocaleString()} demand row${rows.length === 1 ? '' : 's'} · ${fmtDetail(totalHours, 1)} hrs · ${fmtDetail(totalHC, 2)} HC
            </div>
          </div>
          ${rows.length > displayRows.length ? `<div class="badge badge-muted">Showing top ${displayRows.length.toLocaleString()} by hours</div>` : ''}
        </div>
        <div class="admin-table-wrap" style="max-height:420px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Month</th>
                <th>Value Stream</th>
                <th>Sequence</th>
                <th>Demand Type</th>
                <th class="num">Qty</th>
                <th>Std Type</th>
                <th class="num">Std Value</th>
                <th class="num">Hrs/Unit</th>
                <th class="num">Demand Hrs</th>
                <th class="num">Demand HC</th>
              </tr>
            </thead>
            <tbody>
              ${displayRows.length === 0 ? `<tr><td colspan="11" class="empty-state">No review items in this scope.</td></tr>` : ''}
              ${displayRows.map(row => `
                <tr>
                  <td><strong>${escapeHtml(row.itemNumber)}</strong></td>
                  <td>${escapeHtml(row.month)}</td>
                  <td>${escapeHtml(row.valueStream || '-')}</td>
                  <td>${escapeHtml(row.sequence)}</td>
                  <td>${escapeHtml(row.demandType)}</td>
                  <td class="num">${fmtDetail(row.qty, 0)}</td>
                  <td>${escapeHtml(row.standardType)}</td>
                  <td class="num">${fmtDetail(row.standardValue, 2)}</td>
                  <td class="num">${fmtDetail(row.hoursPerUnit, 6)}</td>
                  <td class="num">${fmtDetail(row.demandHours, 2)}</td>
                  <td class="num">${fmtDetail(row.demandHC, 3)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function buildNoStandardSection() {
    const allRows = breakdown.noStandardDemand || [];
    if (!allRows.length) return '';

    const rows = scopedNoStandardDemand();
    const displayRows = rows.slice(0, 250);
    const forecastItems = new Set(rows.filter(row => row.demandType === 'forecast').map(row => row.itemNumber)).size;
    const firmPOItems = new Set(rows.filter(row => row.demandType === 'firmPO').map(row => row.itemNumber)).size;
    const allForecastItems = new Set(allRows.filter(row => row.demandType === 'forecast').map(row => row.itemNumber)).size;
    const allFirmPOItems = new Set(allRows.filter(row => row.demandType === 'firmPO').map(row => row.itemNumber)).size;
    const totalQty = rows.reduce((sum, row) => sum + (row.totalQty || 0), 0);
    const isPlantScope = rows.length === allRows.length;

    return `
      <div class="card animate-in" style="margin-top:var(--space-md);padding:0;overflow:hidden;">
        <div style="padding:var(--space-md);border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;gap:var(--space-md);align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div class="card-title" style="margin-bottom:4px;">No Standard Demand</div>
            <div style="font-size:12px;color:var(--text-secondary);">
              Current scope (${escapeHtml(noStandardScopeLabel())}): ${firmPOItems.toLocaleString()} firm PO item${firmPOItems === 1 ? '' : 's'} · ${forecastItems.toLocaleString()} forecast item${forecastItems === 1 ? '' : 's'} · ${fmtDetail(totalQty, 0)} units with demand but no DB standard
              ${isPlantScope ? '' : `<br>Plant total: ${allFirmPOItems.toLocaleString()} firm PO item${allFirmPOItems === 1 ? '' : 's'} · ${allForecastItems.toLocaleString()} forecast item${allForecastItems === 1 ? '' : 's'}`}
            </div>
          </div>
          ${rows.length > displayRows.length ? `<div class="badge badge-muted">Showing top ${displayRows.length.toLocaleString()} by qty</div>` : ''}
        </div>
        <div class="admin-table-wrap" style="max-height:420px;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Demand Type</th>
                <th>Value Stream</th>
                <th>Requirements</th>
                <th>Items DB</th>
                <th>UOM</th>
                <th class="num">Total Qty</th>
                <th>Demand Months</th>
              </tr>
            </thead>
            <tbody>
              ${displayRows.length === 0 ? `<tr><td colspan="8" class="empty-state">No no-standard demand in this scope.</td></tr>` : ''}
              ${displayRows.map(row => `
                <tr>
                  <td><strong>${escapeHtml(row.itemNumber)}</strong></td>
                  <td>${escapeHtml(row.demandType)}</td>
                  <td>${escapeHtml(row.valueStream || '-')}</td>
                  <td>${row.inRequirements ? '<span class="badge badge-warn">In Requirements</span>' : '<span class="badge badge-muted">Not in Requirements</span>'}</td>
                  <td>${row.inItemsDb ? '<span class="badge badge-good">Found</span>' : '<span class="badge badge-danger">Missing</span>'}</td>
                  <td>${escapeHtml(row.uom || '-')}</td>
                  <td class="num">${fmtDetail(row.totalQty, 0)}</td>
                  <td>${escapeHtml(fmtMonthQtys(row.months))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function buildRow(label, values, cls = 'db-row-data') {
    return `<tr class="${cls}">
      <td class="db-label-col">${label}</td>
      ${values.map(v => `<td class="db-val">${fmt(v)}</td>`).join('')}
    </tr>`;
  }
  function buildRowDec(label, values, cls = 'db-row-data') {
    return `<tr class="${cls}">
      <td class="db-label-col">${label}</td>
      ${values.map(v => `<td class="db-val">${fmtDec(v)}</td>`).join('')}
    </tr>`;
  }
  function buildDeltaRow(label, values) {
    return `<tr class="db-row-delta">
      <td class="db-label-col"><strong>${label}</strong></td>
      ${values.map(v => {
        const cls = v > 0 ? 'db-delta-positive' : v < 0 ? 'db-delta-negative' : 'db-delta-zero';
        return `<td class="db-val ${cls}"><strong>${fmtDec(v)}</strong></td>`;
      }).join('')}
    </tr>`;
  }

  function displayLabel() {
    if (level === 'vsAndSequence') return `${filterValue} / ${seqFilter}`;
    if (level === 'sequence')      return `Sequence: ${filterValue}`;
    if (level === 'valueStream')   return `Value Stream: ${filterValue}`;
    return 'Plant Total';
  }

  function render() {
    const viewData = applyOT(getViewData());

    // Build sequence options for drill-down — scope to active VS when one is selected
    // Exclude machine sequences (Heads) — demand breakdown is human constraints only
    const seqUoms = breakdown.seqToUom || {};
    let seqOpts = [{ value: '', label: '— All sequences —' }];
    const activeVS = (level === 'valueStream' || level === 'vsAndSequence') ? filterValue : null;
    if (activeVS && breakdown.byVSAndSequence?.[activeVS]) {
      seqOpts = seqOpts.concat(
        Object.keys(breakdown.byVSAndSequence[activeVS])
          .filter(s => seqUoms[s] !== 'Heads')
          .sort()
          .map(s => ({ value: s, label: s }))
      );
    } else {
      seqOpts = seqOpts.concat(
        (breakdown.sequences || [])
          .filter(s => seqUoms[s] !== 'Heads')
          .map(s => ({ value: s, label: s }))
      );
    }

    container.innerHTML = `
      <div class="view-header animate-in">
        <h1 class="view-title">Demand Breakdown</h1>
        <p class="view-subtitle">Forecast vs Capacity — ${displayLabel()}${oracleFile ? ' · ' + oracleFile : ''}</p>
      </div>

      <div class="${(coverage.mode || coverageMode) === 'official' ? 'info-banner' : 'warn-banner'} animate-in">
        <strong>${coverageLabel(coverage.mode || coverageMode)}:</strong> ${coverageMessage()}
      </div>

      <div class="card animate-in" style="margin-bottom:var(--space-md);padding:var(--space-md);">
        <div style="display:flex;gap:var(--space-lg);flex-wrap:wrap;align-items:center;">
          <div>
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Level</span>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
              ${[
                { v: 'plant',       l: 'Plant Total' },
                ...( breakdown.valueStreams || []).map(vs => ({ v: `vs:${vs}`, l: vs })),
              ].map(({ v, l }) => {
                const isActive = v === 'plant' ? level === 'plant' : (level === 'valueStream' || level === 'vsAndSequence') && filterValue === l;
                return `<button class="month-btn${isActive ? ' active' : ''}" data-level="${v}">${l}</button>`;
              }).join('')}
            </div>
          </div>
          <div>
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Drill: Sequence</span>
            <select id="db-seq-select" class="form-select" style="margin-top:6px;width:220px;padding:6px 10px;">
              ${seqOpts.map(o => `<option value="${o.value}" ${o.value === (seqFilter || '') ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="card animate-in" style="overflow-x:auto;">
        <table class="db-table">
          <thead>
            <tr>
              <th class="db-label-col"></th>
              ${MONTHS_SHORT.map(m => `<th class="db-month-col">${m}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="db-section-header"><td colspan="13">Demand (Hours)</td></tr>
            ${buildRow('Total Demand (Hrs)', MONTHS_FULL.map(m => viewData[m]?.totalDemand || 0), 'db-row-total')}
            ${buildRow('  Firm PO', MONTHS_FULL.map(m => viewData[m]?.firmPO || 0), 'db-row-data db-row-sub')}
            ${buildRow('  Open Forecast', MONTHS_FULL.map(m => (viewData[m]?.totalDemand || 0) - (viewData[m]?.firmPO || 0)), 'db-row-data db-row-sub')}

            <tr class="db-section-header"><td colspan="13">Demand (Headcount Equiv.)</td></tr>
            ${buildRowDec('Total Demand (HC)', MONTHS_FULL.map(m => viewData[m]?.totalDemand_hc || 0), 'db-row-total')}
            ${buildRowDec('  Firm PO', MONTHS_FULL.map(m => viewData[m]?.firmPO_hc || 0), 'db-row-data db-row-sub')}
            ${buildRowDec('  Open Forecast', MONTHS_FULL.map(m => (viewData[m]?.totalDemand_hc || 0) - (viewData[m]?.firmPO_hc || 0)), 'db-row-data db-row-sub')}

            <tr class="db-section-header"><td colspan="13">Capacity (People)</td></tr>
            ${buildRowDec('Headcount', MONTHS_FULL.map(m => viewData[m]?.capacity || 0), 'db-row-data')}
            ${buildRow('Hrs Available', MONTHS_FULL.map(m => viewData[m]?.hrsAvail || 0), 'db-row-data')}

            <tr class="db-spacer"><td colspan="13"></td></tr>
            ${buildDeltaRow('Capacity Delta (HC)', MONTHS_FULL.map(m => viewData[m]?.delta_hc || 0))}

            <tr class="db-spacer"><td colspan="13"></td></tr>
            <tr class="db-row-ot">
              <td class="db-label-col">Over Time %</td>
              ${MONTHS_FULL.map(m => `
                <td class="db-val">
                  <input type="number" class="db-ot-input" data-month="${m}"
                         value="${otPercents[m] || ''}" placeholder="0" min="0" max="100" step="5" />
                </td>
              `).join('')}
            </tr>
            ${buildDeltaRow('Delta w/ OT (HC)', MONTHS_FULL.map(m => viewData[m]?.otDelta_hc || 0))}
          </tbody>
        </table>
      </div>

      ${buildReviewSection()}

      ${buildNoStandardSection()}

      ${false ? `
        <div class="warn-banner animate-in" style="margin-top:var(--space-md);">
          <strong>Scope note:</strong> ${breakdown.unmatched.firmPO} firm PO items and ${breakdown.unmatched.forecast} forecast items have no standards in the DB and are excluded — this is expected.
        </div>
      ` : ''}
    `;

    // Level filter
    container.querySelectorAll('[data-level]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.level;
        if (v === 'plant') { level = 'plant'; filterValue = null; seqFilter = null; }
        else { level = 'valueStream'; filterValue = v.replace('vs:', ''); seqFilter = null; }
        render();
      });
    });

    // Sequence drill-down
    const seqSel = container.querySelector('#db-seq-select');
    if (seqSel) {
      seqSel.addEventListener('change', e => {
        seqFilter = e.target.value || null;
        if (seqFilter) {
          if (level === 'valueStream') level = 'vsAndSequence';
          else if (level === 'plant' || level === 'sequence') level = 'sequence';
          // if already vsAndSequence, keep it — just update seqFilter
        } else {
          if (level === 'vsAndSequence') level = 'valueStream';
          else if (level === 'sequence') level = 'plant';
        }
        render();
      });
    }

    // OT% inputs
    container.querySelectorAll('.db-ot-input').forEach(inp => {
      inp.addEventListener('change', e => {
        const m = e.target.dataset.month;
        otPercents[m] = parseFloat(e.target.value) || 0;
        render();
      });
    });
  }

  render();
}
