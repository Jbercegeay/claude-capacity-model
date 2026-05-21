import { api } from '../../data/api.js';

const MONTHS_FULL = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const SCHEDULES = ['5 Day','7 Day'];

export async function renderDaysAdmin(container) {
  container.innerHTML = `<div class="loading-spinner animate-in">Loading Days in Month…</div>`;

  let rows = [];
  try {
    rows = await api.daysInMonth();
  } catch (err) {
    container.innerHTML = `<div class="error-banner">${err.message}</div>`;
    return;
  }

  // Build map: schedule → month → days
  const data = {};
  for (const row of rows) {
    if (!data[row.schedule]) data[row.schedule] = {};
    data[row.schedule][row.month] = row.days;
  }

  let saving = {};

  function render() {
    container.innerHTML = `
      <div class="view-header animate-in">
        <h1 class="view-title">Days in Month</h1>
        <p class="view-subtitle">Working days per schedule × month (used in demand → headcount conversion)</p>
      </div>
      <div class="card animate-in">
        <table class="data-table">
          <thead>
            <tr>
              <th>Schedule</th>
              ${MONTHS_FULL.map(m => `<th>${m.slice(0,3)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${SCHEDULES.map(sched => `
              <tr>
                <td style="font-weight:600">${sched}</td>
                ${MONTHS_FULL.map(month => {
                  const val = data[sched]?.[month] ?? '';
                  const key = `${sched}|${month}`;
                  return `
                    <td>
                      <input type="number" class="inline-edit-input days-input"
                             data-sched="${sched}" data-month="${month}"
                             value="${val}" min="0" max="31"
                             style="width:52px;${saving[key] ? 'opacity:0.5' : ''}" />
                    </td>
                  `;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="margin-top:var(--space-md);font-size:12px;color:var(--text-muted);">Changes save automatically on blur.</div>
      </div>
    `;

    container.querySelectorAll('.days-input').forEach(inp => {
      inp.addEventListener('blur', async () => {
        const sched = inp.dataset.sched;
        const month = inp.dataset.month;
        const days  = parseInt(inp.value);
        if (isNaN(days) || days < 0) return;
        const key = `${sched}|${month}`;
        saving[key] = true;
        inp.style.opacity = '0.5';
        try {
          await api.upsertDays({ schedule: sched, month, days });
          if (!data[sched]) data[sched] = {};
          data[sched][month] = days;
        } catch (err) {
          alert(`Save failed: ${err.message}`);
        } finally {
          saving[key] = false;
          inp.style.opacity = '1';
        }
      });
    });
  }

  render();
}
