import { fetchDbReport, fetchDemandBreakdown } from '../data/api.js';

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

export async function renderOperational(container, schedule, coverageMode = 'official') {
  const now = new Date();
  let month = MONTHS_FULL[now.getMonth()];
  let vsFilter = null; // null = show all value streams

  function utilBar(util) {
    if (util === null || util === undefined) return '—';
    const pct = Math.round(util * 100);
    const fillW = Math.min(pct, 100);
    const cls = pct >= 95 ? 'over' : pct >= 80 ? 'warn' : '';
    const color = pct >= 95 ? 'var(--status-danger)' : pct >= 80 ? 'var(--status-warn)' : 'var(--status-good)';
    return `<div class="sparkline-container">
      <div class="sparkline-track"><div class="sparkline-fill ${cls}" style="width:${fillW}%"></div></div>
      <div class="sparkline-text" style="color:${color}">${pct}%</div>
    </div>`;
  }

  function renderFilters(allValueStreams) {
    return `
      <div style="margin-bottom:var(--space-sm);" class="animate-in">
        <div class="month-filter-bar">
          <button class="month-btn ${month === 'Full Year' ? 'active' : ''}" data-month="Full Year"
                  style="font-weight:700;padding:4px 12px;">Full Year</button>
          <span style="color:var(--border-color);margin:0 4px;">|</span>
          ${MONTHS_SHORT.map((m, i) => `
            <button class="month-btn ${MONTHS_FULL[i] === month ? 'active' : ''}" data-month="${MONTHS_FULL[i]}">${m}</button>
          `).join('')}
        </div>
      </div>
      <div style="margin-bottom:var(--space-md);" class="animate-in">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px;">Value Stream</div>
        <div class="month-filter-bar">
          <button class="month-btn ${vsFilter === null ? 'active' : ''}" data-vs="">All</button>
          ${allValueStreams.map(vs => `
            <button class="month-btn ${vsFilter === vs ? 'active' : ''}" data-vs="${vs}">${vs}</button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function wireFilters() {
    container.querySelectorAll('[data-month]').forEach(btn => {
      btn.addEventListener('click', () => { month = btn.dataset.month; render(); });
    });
    container.querySelectorAll('[data-vs]').forEach(btn => {
      btn.addEventListener('click', () => { vsFilter = btn.dataset.vs || null; render(); });
    });
  }

  async function renderFullYear() {
    container.innerHTML = `<div class="loading-spinner animate-in">Computing Full Year…</div>`;

    let result;
    try {
      result = await fetchDemandBreakdown(schedule, coverageMode);
    } catch (err) {
      container.innerHTML = `
        <div class="view-header animate-in"><h1 class="view-title">Operational Detail</h1></div>
        <div class="error-banner animate-in">${err.message}</div>
        <div class="info-banner animate-in">Upload an Oracle TRN .xlsm file via Admin → Oracle Upload to enable this view.</div>
      `;
      return;
    }

    const { breakdown, oracleFile } = result;
    const allVS = breakdown.valueStreams || [];
    const seqUoms = breakdown.seqToUom || {};

    if (vsFilter) {
      // ── Specific VS selected: rows = sequences, columns = 12 months ──────────
      const sequences = Object.keys(breakdown.byVSAndSequence?.[vsFilter] || {}).sort();
      const getMonthData = (seq, m) => breakdown.byVSAndSequence[vsFilter]?.[seq]?.[m] || null;

      // Totals — HC sequences only
      const totals = {};
      for (const m of MONTHS_FULL) {
        totals[m] = { demand_hc: 0, capacity: 0 };
        for (const seq of sequences) {
          if (seqUoms[seq] === 'Heads') continue;
          const d = getMonthData(seq, m);
          if (d) { totals[m].demand_hc += d.totalDemand_hc || 0; totals[m].capacity += d.capacity || 0; }
        }
      }

      container.innerHTML = `
        <div class="view-header animate-in">
          <h1 class="view-title">Operational Detail</h1>
          <p class="view-subtitle">Full Year · ${schedule} · ${coverageLabel(coverageMode)} · ${vsFilter}${oracleFile ? ` · ${oracleFile}` : ''}</p>
        </div>
        ${renderFilters(allVS)}
        <div class="card animate-in" style="padding:0;overflow:hidden;">
          <div class="matrix-wrapper">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th class="matrix-sticky-col">Sequence</th>
                  ${MONTHS_SHORT.map(m => `<th colspan="2" class="matrix-vs-header">${m}</th>`).join('')}
                </tr>
                <tr class="matrix-sub-header">
                  <th class="matrix-sticky-col"></th>
                  ${MONTHS_SHORT.map(() => `<th>Dem HC</th><th>Util%</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${sequences.length === 0 ? `<tr><td colspan="${1 + 24}" class="empty-state">No data for ${vsFilter}</td></tr>` : ''}
                ${sequences.map(seq => {
                  const isMachine = seqUoms[seq] === 'Heads';
                  const seqLabel = isMachine
                    ? `${seq} <span style="font-size:10px;font-weight:700;color:var(--text-muted);background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;margin-left:3px;">M</span>`
                    : seq;
                  return `
                  <tr class="matrix-data-row">
                    <td class="matrix-sticky-col matrix-seq-label">${seqLabel}</td>
                    ${MONTHS_FULL.map(m => {
                      const d = getMonthData(seq, m);
                      if (!d) return `<td class="matrix-cell empty">—</td><td class="matrix-cell empty">—</td>`;
                      const util = d.capacity > 0 ? d.totalDemand_hc / d.capacity : null;
                      return `
                        <td class="matrix-cell">${(d.totalDemand_hc || 0).toFixed(1)}</td>
                        <td class="matrix-cell" style="min-width:80px;padding-right:8px">${utilBar(util)}</td>
                      `;
                    }).join('')}
                  </tr>`;
                }).join('')}
              </tbody>
              <tfoot>
                <tr class="matrix-totals-row">
                  <td class="matrix-sticky-col matrix-total-label">TOTAL</td>
                  ${MONTHS_FULL.map(m => {
                    const t = totals[m];
                    const util = t.capacity > 0 ? t.demand_hc / t.capacity : null;
                    return `
                      <td class="matrix-cell matrix-total">${t.demand_hc.toFixed(1)}</td>
                      <td class="matrix-cell matrix-total" style="min-width:80px;padding-right:8px">${utilBar(util)}</td>
                    `;
                  }).join('')}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `;
    } else {
      // ── All VS: rows = sequences, columns = VS groups (same as single-month)
      //    Each cell = annual total demand HC / annual capacity / gap / avg util%
      const sequences = breakdown.sequences || [];
      const vsToShow  = allVS;

      // Build annual totals per sequence × VS (sum across 12 months)
      const annualMatrix = {};
      for (const seq of sequences) {
        annualMatrix[seq] = {};
        for (const vs of vsToShow) {
          let demHC = 0, capHC = 0;
          for (const m of MONTHS_FULL) {
            const d = breakdown.byVSAndSequence?.[vs]?.[seq]?.[m];
            if (d) { demHC += d.totalDemand_hc || 0; capHC += d.capacity || 0; }
          }
          annualMatrix[seq][vs] = { demand_hc: demHC, capacity: capHC };
        }
      }

      // Grand totals per VS (annual) — HC sequences only
      const grandTotals = {};
      for (const vs of vsToShow) {
        grandTotals[vs] = { demand_hc: 0, capacity: 0 };
        for (const seq of sequences) {
          if (seqUoms[seq] === 'Heads') continue;
          grandTotals[vs].demand_hc += annualMatrix[seq]?.[vs]?.demand_hc || 0;
          grandTotals[vs].capacity  += annualMatrix[seq]?.[vs]?.capacity  || 0;
        }
      }

      container.innerHTML = `
        <div class="view-header animate-in">
          <h1 class="view-title">Operational Detail</h1>
          <p class="view-subtitle">Full Year · ${schedule} · ${coverageLabel(coverageMode)} · All Value Streams${oracleFile ? ` · ${oracleFile}` : ''}</p>
        </div>
        ${renderFilters(allVS)}
        <div class="card animate-in" style="padding:0;overflow:hidden;">
          <div class="matrix-wrapper">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th class="matrix-sticky-col">Sequence</th>
                  ${vsToShow.map((vs, vi) => `<th colspan="4" class="matrix-vs-header" style="${vi > 0 ? '' : 'border-left:none!important;'}">${vs}</th>`).join('')}
                </tr>
                <tr class="matrix-sub-header">
                  <th class="matrix-sticky-col"></th>
                  ${vsToShow.map((_, vi) => `<th class="vs-group-start">Dem HC</th><th>Cap HC</th><th>Gap</th><th>Util%</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${sequences.length === 0 ? `<tr><td colspan="${1 + vsToShow.length * 4}" class="empty-state">No data available</td></tr>` : ''}
                ${sequences.map(seq => {
                  const isMachine = seqUoms[seq] === 'Heads';
                  const seqLabel = isMachine
                    ? `${seq} <span style="font-size:10px;font-weight:700;color:var(--text-muted);background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;margin-left:3px;">M</span>`
                    : seq;
                  return `
                  <tr class="matrix-data-row">
                    <td class="matrix-sticky-col matrix-seq-label">${seqLabel}</td>
                    ${vsToShow.map((vs, vi) => {
                      const tint = vi % 2 === 1 ? 'background:rgba(79,142,247,0.07);' : '';
                      const cell = annualMatrix[seq]?.[vs];
                      if (!cell || (cell.demand_hc === 0 && cell.capacity === 0)) {
                        return `<td class="matrix-cell vs-group-start empty" style="${tint}">—</td><td class="matrix-cell empty" style="${tint}">—</td><td class="matrix-cell empty" style="${tint}">—</td><td class="matrix-cell empty" style="${tint}">—</td>`;
                      }
                      const gap = cell.capacity - cell.demand_hc;
                      const util = cell.capacity > 0 ? cell.demand_hc / cell.capacity : null;
                      const gapColor = gap < 0 ? 'var(--status-danger)' : gap < 0.5 ? 'var(--status-warn)' : 'inherit';
                      return `
                        <td class="matrix-cell vs-group-start" style="${tint}">${cell.demand_hc.toFixed(1)}</td>
                        <td class="matrix-cell" style="${tint}">${cell.capacity.toFixed(1)}</td>
                        <td class="matrix-cell" style="${tint};color:${gapColor}">${gap.toFixed(1)}</td>
                        <td class="matrix-cell" style="${tint};min-width:90px;padding-right:8px">${utilBar(util)}</td>
                      `;
                    }).join('')}
                  </tr>`;
                }).join('')}
              </tbody>
              <tfoot>
                <tr class="matrix-totals-row">
                  <td class="matrix-sticky-col matrix-total-label">TOTAL</td>
                  ${vsToShow.map((vs, vi) => {
                    const tint = vi % 2 === 1 ? 'background:rgba(79,142,247,0.10);' : '';
                    const t = grandTotals[vs];
                    const gap  = t.capacity - t.demand_hc;
                    const util = t.capacity > 0 ? t.demand_hc / t.capacity : null;
                    const gapColor = gap < 0 ? 'var(--status-danger)' : gap < 0.5 ? 'var(--status-warn)' : 'inherit';
                    return `
                      <td class="matrix-cell matrix-total vs-group-start" style="${tint}">${t.demand_hc.toFixed(1)}</td>
                      <td class="matrix-cell matrix-total" style="${tint}">${t.capacity.toFixed(1)}</td>
                      <td class="matrix-cell matrix-total" style="${tint};color:${gapColor}">${gap.toFixed(1)}</td>
                      <td class="matrix-cell matrix-total" style="${tint};min-width:90px;padding-right:8px">${utilBar(util)}</td>
                    `;
                  }).join('')}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `;
    }
    wireFilters();
  }

  async function renderSingleMonth() {
    container.innerHTML = `<div class="loading-spinner animate-in">Computing Operational Detail…</div>`;

    let data;
    try {
      data = await fetchDbReport(schedule, month, coverageMode);
    } catch (err) {
      container.innerHTML = `
        <div class="view-header animate-in"><h1 class="view-title">Operational Detail</h1></div>
        <div class="error-banner animate-in">Failed to load: ${err.message}</div>
      `;
      return;
    }

    const { sequences, matrix, hasOracleForecast, oracleFile } = data;
    const seqUoms  = data.sequenceUoms  || {};
    const seqDepts = data.sequenceDepts || {};
    const seqSubs  = data.sequenceSubs  || {};
    const allValueStreams = data.valueStreams;
    const valueStreams = vsFilter ? allValueStreams.filter(vs => vs === vsFilter) : allValueStreams;

    // Group sequences by department (preserve sort within each group)
    const deptGroups = {};
    for (const seq of sequences) {
      const dept = seqDepts[seq] || 'Other';
      if (!deptGroups[dept]) deptGroups[dept] = [];
      deptGroups[dept].push(seq);
    }
    const sortedDepts = Object.keys(deptGroups).sort();

    // TOTAL rows only sum People (HC) sequences — machine counts don't add to HC totals
    const grandTotals = {};
    for (const vs of valueStreams) {
      grandTotals[vs] = { demand_hc: 0, capacity: 0 };
      for (const seq of sequences) {
        if (seqUoms[seq] === 'Heads') continue;
        const cell = matrix[seq]?.[vs];
        if (cell) {
          grandTotals[vs].demand_hc += cell.demand_hc;
          grandTotals[vs].capacity  += cell.capacity;
        }
      }
    }

    function renderSeqRows(seqList) {
      return seqList.map(seq => {
        const isMachine = seqUoms[seq] === 'Heads';
        return `
        <tr class="matrix-data-row">
          <td class="matrix-sticky-col matrix-seq-label">${seq}</td>
          ${valueStreams.map((vs, vi) => {
            const tint = vi % 2 === 1 ? 'background:rgba(79,142,247,0.07);' : '';
            const cell = matrix[seq]?.[vs];
            if (!cell) {
              return `<td class="matrix-cell vs-group-start empty" style="${tint}">—</td><td class="matrix-cell empty" style="${tint}">—</td><td class="matrix-cell empty" style="${tint}">—</td><td class="matrix-cell empty" style="${tint}">—</td>`;
            }
            const gap = cell.capacity - cell.demand_hc;
            const gapColor = gap < 0 ? 'var(--status-danger)' : gap < 0.5 ? 'var(--status-warn)' : 'inherit';
            return `
              <td class="matrix-cell vs-group-start" style="${tint}">${cell.demand_hc.toFixed(1)}</td>
              <td class="matrix-cell" style="${tint}">${cell.capacity.toFixed(1)}</td>
              <td class="matrix-cell" style="${tint};color:${gapColor}">${gap.toFixed(1)}</td>
              <td class="matrix-cell" style="${tint};min-width:90px;padding-right:8px">${utilBar(cell.util_pct)}</td>
            `;
          }).join('')}
        </tr>`;
      }).join('');
    }

    container.innerHTML = `
      <div class="view-header animate-in">
        <h1 class="view-title">Operational Detail</h1>
        <p class="view-subtitle">Sequence × Value Stream · ${schedule} · ${coverageLabel(coverageMode)} · ${month}${oracleFile ? ` · ${oracleFile}` : ''}</p>
      </div>

      ${!hasOracleForecast ? `<div class="warn-banner animate-in">No Oracle forecast uploaded — showing capacity only (demand = 0). Upload a TRN .xlsm via Admin → Oracle Upload.</div>` : ''}

      ${renderFilters(allValueStreams)}

      <div class="card animate-in" style="padding:0;overflow:hidden;">
        <div class="matrix-wrapper">
          <table class="matrix-table">
            <thead>
              <tr>
                <th class="matrix-sticky-col">Sequence</th>
                ${valueStreams.map((vs, vi) => `<th colspan="4" class="matrix-vs-header" style="${vi > 0 ? '' : 'border-left:none!important;'}">${vs}</th>`).join('')}
              </tr>
              <tr class="matrix-sub-header">
                <th class="matrix-sticky-col"></th>
                ${valueStreams.map(() => `<th class="vs-group-start">Dem HC</th><th>Cap HC</th><th>Gap</th><th>Util%</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${sequences.length === 0 ? `<tr><td colspan="${1 + valueStreams.length * 4}" class="empty-state">No data available</td></tr>` : ''}
              ${sortedDepts.map(dept => `
                <tr class="matrix-dept-row">
                  <td class="matrix-sticky-col matrix-dept-label" colspan="${1 + valueStreams.length * 4}">${dept.toUpperCase()}</td>
                </tr>
                ${renderSeqRows(deptGroups[dept])}
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="matrix-totals-row">
                <td class="matrix-sticky-col matrix-total-label">TOTAL</td>
                ${valueStreams.map((vs, vi) => {
                  const tint = vi % 2 === 1 ? 'background:rgba(79,142,247,0.10);' : '';
                  const t = grandTotals[vs];
                  const gap  = t.capacity - t.demand_hc;
                  const util = t.capacity > 0 ? t.demand_hc / t.capacity : null;
                  const gapColor = gap < 0 ? 'var(--status-danger)' : gap < 0.5 ? 'var(--status-warn)' : 'inherit';
                  return `
                    <td class="matrix-cell matrix-total vs-group-start" style="${tint}">${t.demand_hc.toFixed(1)}</td>
                    <td class="matrix-cell matrix-total" style="${tint}">${t.capacity.toFixed(1)}</td>
                    <td class="matrix-cell matrix-total" style="${tint};color:${gapColor}">${gap.toFixed(1)}</td>
                    <td class="matrix-cell matrix-total" style="${tint};min-width:90px;padding-right:8px">${utilBar(util)}</td>
                  `;
                }).join('')}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
    wireFilters();
  }

  async function render() {
    if (month === 'Full Year') {
      await renderFullYear();
    } else {
      await renderSingleMonth();
    }
  }

  await render();
}
