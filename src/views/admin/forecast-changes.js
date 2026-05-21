import { api } from '../../data/api.js';

const MONTH_ORDER = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

export async function renderForecastChanges(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">Forecast Changes</h1>
      <p class="view-subtitle">Manual overrides on top of the Oracle forecast — per item × month</p>
    </div>
    <div class="info-banner animate-in fc-origin-banner" style="margin-bottom:var(--space-md);">
      <strong>Where do these come from?</strong>
      These rows override the <em>Oracle forecast quantity</em> for a specific item and month.
      The Oracle forecast (uploaded via the Oracle Upload page) is your baseline demand.
      Add a row here to replace Oracle's qty for that item × month with your own number —
      useful for items where the forecast is known to be wrong or needs a manual adjustment.
      Zero means "force this month to zero demand regardless of Oracle."
    </div>
    <div class="card animate-in" id="fc-pivot-card">
      <div class="loading-spinner">Loading forecast changes…</div>
    </div>
  `;

  const card = container.querySelector('#fc-pivot-card');

  let rows = [];
  try {
    rows = await api.forecastChanges();
  } catch (err) {
    card.innerHTML = `<div class="error-banner">Failed to load forecast changes: ${err.message}</div>`;
    return;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let search = '';
  let showNonZeroOnly = false;
  let editCell = null;   // { item_number, month } or null
  let editQty = '';
  let editComment = '';
  let saving = false;

  // ── Derived helpers ────────────────────────────────────────────────────────
  function months() {
    const present = new Set(rows.map(r => r.month));
    return MONTH_ORDER.filter(m => present.has(m));
  }

  function lookup() {
    const map = {};
    for (const r of rows) {
      if (!map[r.item_number]) map[r.item_number] = {};
      map[r.item_number][r.month] = r;
    }
    return map;
  }

  function visibleItems(lkp, mths) {
    let items = [...new Set(rows.map(r => r.item_number))].sort();
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i => i.toLowerCase().includes(q));
    }
    if (showNonZeroOnly) {
      items = items.filter(item =>
        mths.some(m => lkp[item]?.[m]?.override_qty !== 0 && lkp[item]?.[m] !== undefined)
      );
    }
    return items;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function mount() {
    const mths = months();
    const lkp  = lookup();
    const items = visibleItems(lkp, mths);
    const totalRows = [...new Set(rows.map(r => r.item_number))].length;
    const nonZeroCount = rows.filter(r => r.override_qty !== 0).length;

    card.innerHTML = `
      <div class="animate-in">
        <div class="admin-toolbar">
          <h2>Forecast Overrides
            <span class="fc-stat">${totalRows} items</span>
            <span class="fc-stat fc-stat-highlight">${nonZeroCount} non-zero overrides</span>
          </h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="text" class="admin-search" id="fc-search" placeholder="Search item #…" value="${escAttr(search)}" />
            <label class="fc-toggle-label">
              <input type="checkbox" id="fc-nonzero" ${showNonZeroOnly ? 'checked' : ''} />
              Non-zero only
            </label>
            <button class="btn btn-primary btn-sm" id="fc-add-btn">+ Add Override</button>
          </div>
        </div>

        ${items.length === 0 ? `
          <div class="empty-state" style="padding:32px;">
            No items${search ? ` matching "${escHTML(search)}"` : ''}${showNonZeroOnly ? ' with non-zero overrides' : ''}.
          </div>
        ` : `
          <div class="admin-table-wrap">
            <table class="data-table fc-pivot-table">
              <thead>
                <tr>
                  <th class="fc-item-col">Item #</th>
                  ${mths.map(m => `<th class="fc-month-col">${m.slice(0,3)}</th>`).join('')}
                  <th class="fc-notes-col">Notes</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => renderItemRow(item, mths, lkp)).join('')}
              </tbody>
            </table>
          </div>
          <div class="fc-legend">
            <span class="fc-cell-sample fc-cell-nonzero">■</span> Override active &nbsp;
            <span class="fc-cell-sample fc-cell-zero">■</span> Forced to zero &nbsp;
            <span class="fc-cell-sample fc-cell-empty">—</span> No override (Oracle used) &nbsp;
            Click any cell to edit
          </div>
        `}
      </div>
    `;

    bindEvents(mths, lkp, items);
  }

  function renderItemRow(item, mths, lkp) {
    const itemData = lkp[item] || {};
    // Collect all comments for this item
    const comments = mths
      .map(m => itemData[m])
      .filter(r => r?.comment)
      .map(r => `${r.month.slice(0,3)}: ${r.comment}`)
      .join('; ');

    const cells = mths.map(m => {
      const rec = itemData[m];
      const isEditing = editCell?.item_number === item && editCell?.month === m;

      if (isEditing) {
        return `
          <td class="fc-cell fc-cell-editing" data-item="${escAttr(item)}" data-month="${escAttr(m)}">
            <div class="fc-edit-wrap">
              <input type="number" class="fc-qty-input" id="fc-edit-qty"
                value="${escAttr(String(editQty))}" step="any" style="width:80px;" />
              <input type="text" class="fc-comment-input" id="fc-edit-comment"
                value="${escAttr(editComment)}" placeholder="comment…" style="width:110px;" />
              <div style="display:flex;gap:4px;margin-top:4px;">
                <button class="btn btn-primary btn-sm" id="fc-edit-save" style="padding:2px 8px;">✓</button>
                <button class="btn btn-secondary btn-sm" id="fc-edit-cancel" style="padding:2px 8px;">✕</button>
                ${rec ? `<button class="btn btn-danger btn-sm" id="fc-edit-delete" style="padding:2px 8px;">Del</button>` : ''}
              </div>
            </div>
          </td>
        `;
      }

      if (!rec) {
        return `<td class="fc-cell fc-cell-empty" data-item="${escAttr(item)}" data-month="${escAttr(m)}">—</td>`;
      }
      const qty = rec.override_qty;
      const cls = qty !== 0 ? 'fc-cell-nonzero' : 'fc-cell-zero';
      const hasComment = rec.comment ? ' fc-has-comment' : '';
      const title = rec.comment ? `title="${escAttr(rec.comment)}"` : '';
      return `<td class="fc-cell ${cls}${hasComment}" data-item="${escAttr(item)}" data-month="${escAttr(m)}" ${title}>
        ${qty !== 0 ? Number(qty).toLocaleString() : '0'}${rec.comment ? ' <span class="fc-comment-dot" title="' + escAttr(rec.comment) + '">●</span>' : ''}
      </td>`;
    }).join('');

    return `
      <tr data-item="${escAttr(item)}">
        <td class="fc-item-cell">${escHTML(item)}</td>
        ${cells}
        <td class="fc-notes-cell" style="font-size:11px;color:var(--text-muted);max-width:180px;">${escHTML(comments) || ''}</td>
      </tr>
    `;
  }

  // ── Add Override modal ─────────────────────────────────────────────────────
  function showAddModal() {
    const existing = [...new Set(rows.map(r => r.item_number))].sort();
    const monthOpts = MONTH_ORDER.map(m => `<option value="${m}">${m}</option>`).join('');
    const itemOpts = existing.map(i => `<option value="${escAttr(i)}">${escHTML(i)}</option>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'fc-modal-overlay';
    overlay.innerHTML = `
      <div class="fc-modal">
        <h3 style="margin-bottom:var(--space-md);">Add Forecast Override</h3>
        <div class="fc-modal-field">
          <label>Item #</label>
          <input type="text" id="fc-modal-item" list="fc-item-list" placeholder="e.g. 110095" style="width:180px;" />
          <datalist id="fc-item-list">${itemOpts}</datalist>
        </div>
        <div class="fc-modal-field">
          <label>Month</label>
          <select id="fc-modal-month" style="width:140px;">${monthOpts}</select>
        </div>
        <div class="fc-modal-field">
          <label>Override Qty</label>
          <input type="number" id="fc-modal-qty" value="0" step="any" style="width:120px;" />
        </div>
        <div class="fc-modal-field">
          <label>Comment</label>
          <input type="text" id="fc-modal-comment" placeholder="reason for override…" style="width:220px;" />
        </div>
        <div class="fc-modal-actions">
          <button class="btn btn-primary" id="fc-modal-save">Save Override</button>
          <button class="btn btn-secondary" id="fc-modal-cancel">Cancel</button>
        </div>
        <div id="fc-modal-error" style="color:#ef4444;font-size:12px;margin-top:8px;"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#fc-modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#fc-modal-save').addEventListener('click', async () => {
      const item = overlay.querySelector('#fc-modal-item').value.trim();
      const month = overlay.querySelector('#fc-modal-month').value;
      const qty = overlay.querySelector('#fc-modal-qty').value;
      const comment = overlay.querySelector('#fc-modal-comment').value.trim();
      const errEl = overlay.querySelector('#fc-modal-error');
      if (!item) { errEl.textContent = 'Item # is required.'; return; }
      try {
        const created = await api.addForecastChange({ item_number: item, month, override_qty: Number(qty), comment });
        rows.push(created);
        overlay.remove();
        mount();
      } catch (err) {
        errEl.textContent = `Save failed: ${err.message}`;
      }
    });
  }

  // ── Event binding ──────────────────────────────────────────────────────────
  function bindEvents(mths, lkp, items) {
    // Search
    card.querySelector('#fc-search')?.addEventListener('input', e => {
      search = e.target.value;
      editCell = null;
      mount();
    });

    // Non-zero filter
    card.querySelector('#fc-nonzero')?.addEventListener('change', e => {
      showNonZeroOnly = e.target.checked;
      editCell = null;
      mount();
    });

    // Add button
    card.querySelector('#fc-add-btn')?.addEventListener('click', showAddModal);

    // Cell clicks — open inline edit
    card.querySelectorAll('.fc-cell').forEach(td => {
      td.addEventListener('click', () => {
        const item  = td.dataset.item;
        const month = td.dataset.month;
        const rec   = lkp[item]?.[month];
        editCell    = { item_number: item, month };
        editQty     = rec ? String(rec.override_qty) : '0';
        editComment = rec?.comment || '';
        mount();
        // Focus qty input after re-render
        card.querySelector('#fc-edit-qty')?.focus();
      });
    });

    // Save inline edit
    card.querySelector('#fc-edit-save')?.addEventListener('click', async () => {
      if (saving || !editCell) return;
      saving = true;
      const { item_number, month } = editCell;
      const rec = lkp[item_number]?.[month];
      const qty = parseFloat(editQty);
      const comment = card.querySelector('#fc-edit-comment')?.value.trim() || '';
      try {
        if (rec) {
          const updated = await api.updateForecastChange(rec.id, { override_qty: isNaN(qty) ? 0 : qty, comment });
          const idx = rows.findIndex(r => r.id === rec.id);
          if (idx >= 0) rows[idx] = { ...rows[idx], override_qty: isNaN(qty) ? 0 : qty, comment: comment || null, ...updated };
        } else {
          const created = await api.addForecastChange({ item_number, month, override_qty: isNaN(qty) ? 0 : qty, comment });
          rows.push(created);
        }
        editCell = null;
      } catch (err) {
        alert(`Save failed: ${err.message}`);
      }
      saving = false;
      mount();
    });

    // Cancel inline edit
    card.querySelector('#fc-edit-cancel')?.addEventListener('click', () => {
      editCell = null;
      mount();
    });

    // Delete inline
    card.querySelector('#fc-edit-delete')?.addEventListener('click', async () => {
      if (!editCell) return;
      const { item_number, month } = editCell;
      const rec = lkp[item_number]?.[month];
      if (!rec || !confirm(`Delete override for ${item_number} / ${month}?`)) return;
      try {
        await api.deleteForecastChange(rec.id);
        rows = rows.filter(r => r.id !== rec.id);
        editCell = null;
        mount();
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      }
    });

    // Keep qty/comment values in sync while typing (prevent losing on unrelated re-renders)
    card.querySelector('#fc-edit-qty')?.addEventListener('input', e => { editQty = e.target.value; });
    card.querySelector('#fc-edit-comment')?.addEventListener('input', e => { editComment = e.target.value; });

    // Enter key to save
    card.querySelector('#fc-edit-qty')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') card.querySelector('#fc-edit-save')?.click();
      if (e.key === 'Escape') card.querySelector('#fc-edit-cancel')?.click();
    });
  }

  mount();
}

function escHTML(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s ?? '').replace(/"/g,'&quot;'); }
