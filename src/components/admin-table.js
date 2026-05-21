/**
 * admin-table.js — Reusable inline-edit CRUD table component.
 *
 * Usage:
 *   renderAdminTable(container, {
 *     title: 'Capacity',
 *     fetchData: async () => [...rows],
 *     columns: [{ key, label, type:'text'|'number'|'select', options:[], readOnly:bool, width }],
 *     primaryKey: 'id',
 *     onAdd:    async (row) => newRow,
 *     onUpdate: async (id, row) => updatedRow,
 *     onDelete: async (id) => void,
 *     searchKeys: ['process', 'value_stream'],  // columns to search
 *     addDefaults: {},  // default values for new row form
 *     groupBy: 'process',  // optional: key to group rows under collapsible headers
 *   })
 */
export async function renderAdminTable(container, opts) {
  const {
    title, fetchData, columns, primaryKey = 'id',
    onAdd, onUpdate, onDelete, searchKeys = [], addDefaults = {},
    groupBy = null,
    addButtonLabel = '+ Add Row',  // custom label for the add button
    onAddClick = null,             // if provided, called instead of opening inline add form
  } = opts;

  container.innerHTML = `<div class="loading-spinner animate-in">Loading ${title}…</div>`;

  let rows = [];
  try {
    rows = await fetchData();
  } catch (err) {
    container.innerHTML = `<div class="error-banner">Failed to load ${title}: ${err.message}</div>`;
    return;
  }

  let search = '';
  let groupFilter = '';          // '' = show all groups
  let collapsedGroups = new Set();
  let editId = null;
  let editValues = {};
  let addMode = false;
  let addValues = { ...addDefaults };

  // Unique sorted group values (computed once from full rows)
  function groupValues() {
    if (!groupBy) return [];
    return [...new Set(rows.map(r => r[groupBy]))].sort();
  }

  function filteredRows() {
    let result = rows;
    if (groupFilter) result = result.filter(r => r[groupBy] === groupFilter);
    if (search) {
      const q = search.toLowerCase();
      const keys = searchKeys.length ? searchKeys : columns.filter(c => !c.readOnly).map(c => c.key);
      result = result.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(q)));
    }
    return result;
  }

  function renderCell(col, value, rowId, row) {
    if (editId === rowId) {
      return renderInput(col, editValues[col.key] ?? value, `edit-${col.key}`);
    }
    if (col.renderCell) {
      return col.renderCell(value, row);
    }
    if (col.percent && value !== null && value !== undefined) {
      const pct = Number(value) * 100;
      const fmt = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2).replace(/\.?0+$/, '');
      return `<td class="num">${fmt}<span style="font-size:10px;color:var(--text-muted);margin-left:1px;">%</span></td>`;
    }
    if (col.type === 'number' && value !== null && value !== undefined) {
      return `<td class="num">${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>`;
    }
    return `<td>${value ?? '<span style="opacity:0.4">—</span>'}</td>`;
  }

  function renderInput(col, value, name) {
    if (col.readOnly) return `<td><em style="opacity:0.5">${value ?? ''}</em></td>`;
    if (col.type === 'select' && col.options) {
      const opts = col.options.map(o => `<option value="${o}" ${o === String(value ?? '') ? 'selected' : ''}>${o}</option>`).join('');
      return `<td><select class="inline-edit-input" name="${name}" style="width:${col.width || 120}px">${opts}</select></td>`;
    }
    // percent columns: edit in % (multiply display, divide on save)
    const inputVal = col.percent && value !== null && value !== undefined
      ? String(+(Number(value) * 100).toFixed(6))
      : (value ?? '');
    const suffix = col.percent ? `<span style="font-size:11px;color:var(--text-muted);margin-left:3px;">%</span>` : '';
    return `<td style="white-space:nowrap;"><input type="${col.type === 'number' ? 'number' : 'text'}" class="inline-edit-input" name="${name}" value="${inputVal}" style="width:${col.width || 110}px" step="${col.percent ? '0.01' : 'any'}" />${suffix}</td>`;
  }

  function renderAddInput(col) {
    const rawValue = addValues[col.key] ?? col.addDefault ?? '';
    const displayValue = col.percent && rawValue !== ''
      ? String(+(Number(rawValue) * 100).toFixed(6))
      : rawValue;
    if (col.type === 'select' && col.options) {
      const opts = col.options.map(o => `<option value="${o}" ${o === String(rawValue) ? 'selected' : ''}>${o}</option>`).join('');
      return `<td><select class="inline-edit-input" name="add-${col.key}" style="width:${col.width || 120}px">${opts}</select></td>`;
    }
    const suffix = col.percent ? `<span style="font-size:11px;color:var(--text-muted);margin-left:3px;">%</span>` : '';
    return `<td style="white-space:nowrap;"><input type="${col.type === 'number' ? 'number' : 'text'}" class="inline-edit-input" name="add-${col.key}" value="${displayValue}" placeholder="${col.label}" style="width:${col.width || 110}px" step="${col.percent ? '0.01' : 'any'}" />${suffix}</td>`;
  }

  function renderGroupedRows(displayed) {
    const colCount = columns.length + 1;
    const groups = [...new Set(displayed.map(r => r[groupBy]))];
    if (groups.length === 0) {
      return `<tr><td colspan="${colCount}" class="empty-state">No rows${search ? ` matching "${search}"` : ''}${groupFilter ? ` in "${groupFilter}"` : ''}</td></tr>`;
    }

    return groups.map(groupVal => {
      const groupRows = displayed.filter(r => r[groupBy] === groupVal);
      const isCollapsed = collapsedGroups.has(groupVal);
      const escapedGroup = escapeAttr(groupVal);
      const allGroupRows = rows.filter(r => r[groupBy] === groupVal);

      const headerRow = `
        <tr class="group-header-row" data-group="${escapedGroup}" style="cursor:pointer;user-select:none;">
          <td colspan="${colCount}" class="group-header-cell">
            <span class="group-toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
            <strong>${escapeHTML(groupVal)}</strong>
            <span class="group-count-badge">${allGroupRows.length} row${allGroupRows.length !== 1 ? 's' : ''}</span>
            ${search || groupFilter ? `<span class="group-match-badge">${groupRows.length} shown</span>` : ''}
          </td>
        </tr>
      `;

      if (isCollapsed) return headerRow;

      const dataRows = groupRows.map(row => {
        const id = row[primaryKey];
        const isEditing = editId === id;
        return `
          <tr data-id="${id}" class="group-data-row">
            ${columns.map(col => renderCell(col, row[col.key], id, row)).join('')}
            <td>
              ${isEditing ? `
                <div class="row-actions">
                  <button class="btn btn-primary btn-sm at-save" data-id="${id}">✓</button>
                  <button class="btn btn-secondary btn-sm at-cancel">✕</button>
                </div>
              ` : `
                <div class="row-actions">
                  ${onUpdate ? `<button class="btn btn-secondary btn-sm at-edit" data-id="${id}">Edit</button>` : ''}
                  ${onDelete ? `<button class="btn btn-danger btn-sm at-del" data-id="${id}">Del</button>` : ''}
                </div>
              `}
            </td>
          </tr>
        `;
      }).join('');

      return headerRow + dataRows;
    }).join('');
  }

  function renderFlatRows(displayed) {
    const colCount = columns.length + 1;
    if (displayed.length === 0) {
      return `<tr><td colspan="${colCount}" class="empty-state">No rows${search ? ` matching "${search}"` : ''}</td></tr>`;
    }
    return displayed.map(row => {
      const id = row[primaryKey];
      const isEditing = editId === id;
      return `
        <tr data-id="${id}">
          ${columns.map(col => renderCell(col, row[col.key], id, row)).join('')}
          <td>
            ${isEditing ? `
              <div class="row-actions">
                <button class="btn btn-primary btn-sm at-save" data-id="${id}">✓</button>
                <button class="btn btn-secondary btn-sm at-cancel">✕</button>
              </div>
            ` : `
              <div class="row-actions">
                ${onUpdate ? `<button class="btn btn-secondary btn-sm at-edit" data-id="${id}">Edit</button>` : ''}
                ${onDelete ? `<button class="btn btn-danger btn-sm at-del" data-id="${id}">Del</button>` : ''}
              </div>
            `}
          </td>
        </tr>
      `;
    }).join('');
  }

  function buildHTML() {
    const displayed = filteredRows();
    const gVals = groupValues();

    const groupFilterSelect = groupBy && gVals.length > 0 ? `
      <select class="admin-search" id="at-group-filter" style="min-width:140px;" title="Filter by ${groupBy}">
        <option value="">All ${groupBy}s</option>
        ${gVals.map(v => `<option value="${escapeAttr(v)}" ${groupFilter === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}
      </select>
    ` : '';

    const collapseAllBtn = groupBy ? `
      <button class="btn btn-secondary btn-sm" id="at-collapse-all" title="Collapse / expand all groups">
        ${collapsedGroups.size > 0 ? '▶ Expand All' : '▼ Collapse All'}
      </button>
    ` : '';

    return `
      <div class="animate-in">
        <div class="admin-toolbar">
          <h2>${title} <span style="font-size:12px;font-weight:400;color:var(--text-muted);margin-left:8px;">${rows.length} rows</span></h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${groupFilterSelect}
            <input type="text" class="admin-search" id="at-search" placeholder="Search…" value="${escapeAttr(search)}" />
            ${collapseAllBtn}
            ${(onAdd || onAddClick) ? `<button class="btn btn-primary btn-sm" id="at-add-btn">${addMode ? '✕ Cancel' : addButtonLabel}</button>` : ''}
          </div>
        </div>

        <div class="admin-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                ${columns.map(c => `<th style="${c.width ? `min-width:${c.width}px` : ''}">${c.label}</th>`).join('')}
                <th style="width:90px">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${addMode ? `
                <tr style="background:rgba(59,130,246,0.06);">
                  ${columns.map(c => renderAddInput(c)).join('')}
                  <td>
                    <div class="row-actions">
                      <button class="btn btn-primary btn-sm" id="at-add-save">Save</button>
                      <button class="btn btn-secondary btn-sm" id="at-add-cancel">✕</button>
                    </div>
                  </td>
                </tr>
              ` : ''}
              ${groupBy ? renderGroupedRows(displayed) : renderFlatRows(displayed)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function mount() {
    container.innerHTML = buildHTML();

    // Search
    const searchEl = container.querySelector('#at-search');
    if (searchEl) {
      searchEl.addEventListener('input', e => { search = e.target.value; mount(); });
      // Focus cursor at end of input after re-render
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }

    // Group filter dropdown
    const groupFilterEl = container.querySelector('#at-group-filter');
    if (groupFilterEl) {
      groupFilterEl.addEventListener('change', e => {
        groupFilter = e.target.value;
        collapsedGroups.clear();
        mount();
      });
    }

    // Collapse all / expand all
    const collapseAllBtn = container.querySelector('#at-collapse-all');
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', () => {
        if (collapsedGroups.size > 0) {
          collapsedGroups.clear();
        } else {
          groupValues().forEach(v => collapsedGroups.add(v));
        }
        mount();
      });
    }

    // Group header toggle (click to collapse/expand)
    container.querySelectorAll('.group-header-row').forEach(row => {
      row.addEventListener('click', () => {
        const g = row.dataset.group;
        if (collapsedGroups.has(g)) collapsedGroups.delete(g);
        else collapsedGroups.add(g);
        mount();
      });
    });

    // Add mode toggle
    const addBtn = container.querySelector('#at-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (onAddClick) {
          // Delegate to custom handler; it can push new rows via the callback
          onAddClick((newRows) => {
            if (Array.isArray(newRows)) rows.unshift(...newRows);
            else if (newRows) rows.unshift(newRows);
            mount();
          });
          return;
        }
        addMode = !addMode;
        addValues = { ...addDefaults };
        editId = null;
        mount();
      });
    }

    // Add save
    const addSave = container.querySelector('#at-add-save');
    if (addSave) {
      addSave.addEventListener('click', async () => {
        const newRow = {};
        columns.forEach(col => {
          const el = container.querySelector(`[name="add-${col.key}"]`);
          if (el) newRow[col.key] = col.type === 'number'
            ? (el.value !== '' ? (col.percent ? Number(el.value) / 100 : Number(el.value)) : null)
            : el.value;
        });
        try {
          const created = await onAdd(newRow);
          rows.unshift(created);
          addMode = false;
          addValues = { ...addDefaults };
          mount();
        } catch (err) {
          alert(`Add failed: ${err.message}`);
        }
      });
    }

    const addCancel = container.querySelector('#at-add-cancel');
    if (addCancel) {
      addCancel.addEventListener('click', () => { addMode = false; mount(); });
    }

    // Edit buttons
    container.querySelectorAll('.at-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const row = rows.find(r => String(r[primaryKey]) === String(id));
        editId = id;
        editValues = { ...row };
        addMode = false;
        mount();
      });
    });

    // Save edit
    container.querySelectorAll('.at-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const updated = {};
        columns.forEach(col => {
          const el = container.querySelector(`[name="edit-${col.key}"]`);
          if (el) updated[col.key] = col.type === 'number'
            ? (el.value !== '' ? (col.percent ? Number(el.value) / 100 : Number(el.value)) : null)
            : el.value;
          else updated[col.key] = editValues[col.key];
        });
        try {
          const newRow = await onUpdate(id, updated);
          const idx = rows.findIndex(r => String(r[primaryKey]) === String(id));
          if (idx >= 0) rows[idx] = newRow;
          editId = null;
          mount();
        } catch (err) {
          alert(`Save failed: ${err.message}`);
        }
      });
    });

    // Cancel edit
    container.querySelectorAll('.at-cancel').forEach(btn => {
      btn.addEventListener('click', () => { editId = null; mount(); });
    });

    // Delete
    container.querySelectorAll('.at-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this row?')) return;
        const id = btn.dataset.id;
        try {
          await onDelete(id);
          rows = rows.filter(r => String(r[primaryKey]) !== String(id));
          if (editId === id) editId = null;
          mount();
        } catch (err) {
          alert(`Delete failed: ${err.message}`);
        }
      });
    });
  }

  mount();
}

// ── helpers ────────────────────────────────────────────────────────────────
function escapeHTML(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;');
}
