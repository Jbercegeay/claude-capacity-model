const FORMULAS = [
  {
    label: 'Demand Hours',
    formula: 'forecast qty x hours per unit',
    note: 'This is the base workload for an item, month, and sequence.',
  },
  {
    label: 'Finishing Hours/Unit',
    formula: '1 / finishing rate',
    note: 'Finishing standards are treated as units per hour.',
  },
  {
    label: 'Machine/Draw Hours/Unit',
    formula: 'length ft per unit / yield / rate',
    note: 'Machine and draw standards are treated as feet per hour.',
  },
  {
    label: 'Demand HC',
    formula: 'hours x (1 + OE factor) / daily cap / working days',
    note: 'This converts workload hours into headcount equivalent.',
  },
];

const DATA_SOURCES = [
  ['Oracle/TRN forecast upload', 'Item demand by month', 'Uploaded forecast report'],
  ['Item standards', 'Machine, draw, and finishing rates by item and sequence', 'SQLite DB'],
  ['Items catalog', 'Value stream, UOM, and finished-good length', 'SQLite DB'],
  ['Yields', 'Yield adjustment for machine and draw standards', 'SQLite DB'],
  ['Sequence daily caps', 'Daily productive hours per person or machine sequence', 'SQLite DB'],
  ['Days in month', 'Working days for 5 Day and 7 Day schedules', 'SQLite DB'],
  ['Requirements baseline', 'Current verified item list used to match the live portal', 'Legacy Capacity Dashboard cache'],
];

const CHECKLIST = [
  'Start in Official when comparing to the live Capacity Report.',
  'Use Review to isolate additional items that have standards but still need verification.',
  'Use Combined to preview future total demand after verified coverage expands.',
  'Use No Standard Demand as the work queue for items that cannot calculate hours yet.',
  'When a number looks unexpected, confirm schedule, value stream, sequence, scope, and forecast file first.',
];

export function renderReportGuide(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">Report Guide</h1>
      <p class="view-subtitle">Methodology, scope definitions, formulas, and data-health queues for the Capacity Model.</p>
    </div>

    <div class="guide-grid animate-in">
      <section class="card guide-card">
        <div class="guide-eyebrow">Report Purpose</div>
        <h2>Operational Detail</h2>
        <p>Shows demand headcount, capacity, gaps, and utilization by sequence and value stream. Use it to understand where capacity is tight.</p>
      </section>
      <section class="card guide-card">
        <div class="guide-eyebrow">Report Purpose</div>
        <h2>Demand Breakdown</h2>
        <p>Shows monthly demand hours, demand headcount, capacity, overtime scenarios, and item-level audit queues.</p>
      </section>
      <section class="card guide-card">
        <div class="guide-eyebrow">Data Health</div>
        <h2>Audit Queues</h2>
        <p>Separates verified demand, review demand, and demand that cannot calculate because standards are missing.</p>
      </section>
    </div>

    <section class="card guide-section animate-in">
      <div class="guide-section-header">
        <div>
          <div class="guide-eyebrow">Demand Scope</div>
          <h2>Official vs Review vs Combined</h2>
        </div>
      </div>
      <div class="guide-scope-grid">
        <div class="guide-scope-item">
          <span class="badge badge-good">Official</span>
          <h3>Requirements-covered items only</h3>
          <p>This is the default and the comparison mode for the live Capacity Report. It includes items found in the verified Requirements baseline.</p>
        </div>
        <div class="guide-scope-item">
          <span class="badge badge-warn">Review</span>
          <h3>Additional items with standards</h3>
          <p>These items have forecast demand and DB standards, but they are not in the verified Requirements baseline. Their item numbers appear in the Review Items table.</p>
        </div>
        <div class="guide-scope-item">
          <span class="badge badge-muted">Combined</span>
          <h3>Official plus review</h3>
          <p>This previews the future-state demand picture after additional item standards are verified and allowed into reporting.</p>
        </div>
      </div>
    </section>

    <section class="card guide-section animate-in">
      <div class="guide-eyebrow">Calculation Path</div>
      <h2>How Demand Becomes Capacity Need</h2>
      <div class="guide-formula-grid">
        ${FORMULAS.map(step => `
          <div class="guide-formula">
            <div class="guide-formula-label">${step.label}</div>
            <code>${step.formula}</code>
            <p>${step.note}</p>
          </div>
        `).join('')}
      </div>
      <div class="info-banner guide-callout">
        The model calculates hours at the item, sequence, and month level first, then aggregates those results into value stream, sequence, and plant views.
      </div>
    </section>

    <section class="card guide-section animate-in">
      <div class="guide-eyebrow">Known Example</div>
      <h2>January / PI / Check Flush</h2>
      <div class="guide-example-grid">
        <div><span>Official</span><strong>69.45 hrs</strong></div>
        <div><span>Review</span><strong>9.89 hrs</strong></div>
        <div><span>Combined</span><strong>79.34 hrs</strong></div>
      </div>
      <p class="guide-muted">This is the case that exposed the scope difference: the live portal matched Official, while the local model was originally showing Combined.</p>
    </section>

    <section class="card guide-section animate-in">
      <div class="guide-eyebrow">Data Sources</div>
      <h2>Where The Inputs Come From</h2>
      <div class="admin-table-wrap guide-table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Input</th><th>Used For</th><th>Current Source</th></tr>
          </thead>
          <tbody>
            ${DATA_SOURCES.map(row => `
              <tr><td><strong>${row[0]}</strong></td><td>${row[1]}</td><td>${row[2]}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card guide-section animate-in">
      <div class="guide-eyebrow">Audit Buckets</div>
      <h2>What The Tables Mean</h2>
      <div class="guide-two-col">
        <div>
          <h3>Review Items</h3>
          <p>Demand exists and DB standards exist, but the item is not part of the verified Requirements baseline. These standards need business review before they become official.</p>
        </div>
        <div>
          <h3>No Standard Demand</h3>
          <p>Demand exists, but no DB standard exists for the item. The model cannot calculate hours or assign the work to a sequence until standards are added.</p>
        </div>
      </div>
    </section>

    <section class="card guide-section animate-in">
      <div class="guide-eyebrow">Use Pattern</div>
      <h2>Practical Workflow</h2>
      <ol class="guide-steps">
        ${CHECKLIST.map(item => `<li>${item}</li>`).join('')}
      </ol>
    </section>

    <section class="card guide-section animate-in">
      <div class="guide-eyebrow">Future State</div>
      <h2>Excel-free Goal</h2>
      <p>The Requirements sheet is currently a verified benchmark used to preserve trust while the DB-backed model is built. The long-term goal is 100 percent item coverage from governed, dynamic, or maintained data sources so the local portal no longer depends on the capacity workbook for standards.</p>
    </section>
  `;
}
