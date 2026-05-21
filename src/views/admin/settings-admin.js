import { api } from '../../data/api.js';

// Keys with descriptions and validation
const SETTING_META = {
  oe_factor:       { label: 'OE Factor',        desc: 'Overhead/efficiency buffer added to all demand calculations. Stored as a decimal; enter as a percentage (e.g. type 10 for 10%).', type: 'number', percent: true },
  year:            { label: 'Forecast Year',     desc: 'The year used when filtering Oracle forecast rows', type: 'text' },
  admin_password:  { label: 'Admin Password',    desc: 'Password for the Admin section (change from default "admin")', type: 'password' },
};

export async function renderSettingsAdmin(container) {
  container.innerHTML = `<div class="loading-spinner animate-in">Loading Settings…</div>`;

  let settings = {};
  try {
    settings = await api.settings();
  } catch (err) {
    container.innerHTML = `<div class="error-banner">${err.message}</div>`;
    return;
  }

  let saved = {};
  let errors = {};

  function render() {
    const allKeys = [...new Set([...Object.keys(SETTING_META), ...Object.keys(settings)])];
    container.innerHTML = `
      <div class="view-header animate-in">
        <h1 class="view-title">Settings</h1>
        <p class="view-subtitle">Global configuration values stored in the database</p>
      </div>
      <div class="card animate-in" style="max-width:560px;">
        ${allKeys.map(key => {
          const meta  = SETTING_META[key] || { label: key, desc: '', type: 'text' };
          const rawValue = settings[key] ?? '';
          const displayValue = meta.percent && rawValue !== ''
            ? String(+(parseFloat(rawValue) * 100).toFixed(6))
            : rawValue;
          const isSaved = saved[key];
          const err     = errors[key];
          return `
            <div class="form-group" data-key="${key}">
              <label class="form-label">${meta.label}</label>
              ${meta.desc ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">${meta.desc}</div>` : ''}
              <div style="display:flex;gap:8px;align-items:center;">
                <input type="${meta.type === 'password' ? 'password' : meta.type === 'number' ? 'number' : 'text'}"
                       class="form-input setting-input" data-key="${key}"
                       value="${meta.type === 'password' ? '' : displayValue}"
                       placeholder="${meta.type === 'password' ? '(unchanged)' : ''}"
                       step="${meta.percent ? '0.01' : 'any'}" style="flex:1;" />
                ${meta.percent ? `<span style="font-size:13px;color:var(--text-muted);">%</span>` : ''}
                <button class="btn btn-primary btn-sm setting-save" data-key="${key}">Save</button>
              </div>
              ${isSaved ? `<div style="font-size:11px;color:var(--status-good);margin-top:4px;">✓ Saved</div>` : ''}
              ${err     ? `<div style="font-size:11px;color:var(--status-danger);margin-top:4px;">${err}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.setting-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        const inp = container.querySelector(`.setting-input[data-key="${key}"]`);
        let val = inp.value.trim();
        if (!val && SETTING_META[key]?.type === 'password') return; // empty = no change
        if (!val) { errors[key] = 'Value cannot be empty'; render(); return; }
        // percent fields: user types % value, store as decimal
        if (SETTING_META[key]?.percent) val = String(parseFloat(val) / 100);
        btn.disabled = true;
        try {
          await api.updateSetting(key, val);
          settings[key] = val;
          saved[key] = true;
          errors[key] = null;
          setTimeout(() => { saved[key] = false; render(); }, 2000);
          render();
        } catch (err) {
          errors[key] = err.message;
          render();
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  render();
}
