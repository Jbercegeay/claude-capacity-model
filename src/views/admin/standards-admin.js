import { renderAdminTable } from '../../components/admin-table.js';
import { api } from '../../data/api.js';

const UNIT_LABELS = {
  machine:   'ft / hr',
  draw:      'ft / hr',
  finishing: 'units / hr',
};

// All known sequences grouped by their dominant standard_type
const SEQUENCE_DEFAULTS = [
  // machine
  { sequence: 'Annealer',            type: 'machine'  },
  { sequence: 'Braid',               type: 'machine'  },
  { sequence: 'Etch',                type: 'machine'  },
  { sequence: 'Ex 1',                type: 'machine'  },
  { sequence: 'Ex 12',               type: 'machine'  },
  { sequence: 'Ex 6',                type: 'machine'  },
  { sequence: 'Ex 8,10',             type: 'machine'  },
  { sequence: 'FEP',                 type: 'machine'  },
  { sequence: 'Micro',               type: 'machine'  },
  { sequence: 'Pebax',               type: 'machine'  },
  { sequence: 'PI Base L',           type: 'machine'  },
  { sequence: 'PI Base M',           type: 'machine'  },
  { sequence: 'PI Base S',           type: 'machine'  },
  { sequence: 'PI Overcoat/ Rebake', type: 'machine'  },
  { sequence: 'PL Overcoat',         type: 'machine'  },
  { sequence: 'PTFE',                type: 'machine'  },
  { sequence: 'PTFE L',              type: 'machine'  },
  { sequence: 'SPI',                 type: 'machine'  },
  { sequence: 'Teco',                type: 'machine'  },
  // draw
  { sequence: 'Draw',                type: 'draw'     },
  // finishing
  { sequence: 'Accu-Cut',            type: 'finishing'},
  { sequence: 'CTL',                 type: 'finishing'},
  { sequence: 'Check Flush',         type: 'finishing'},
  { sequence: 'Ex CTL',              type: 'finishing'},
  { sequence: 'Ex Inspection',       type: 'finishing'},
  { sequence: 'Flush',               type: 'finishing'},
  { sequence: 'Inspection',          type: 'finishing'},
  { sequence: 'Long Pull',           type: 'finishing'},
  { sequence: 'Machine Cut',         type: 'finishing'},
  { sequence: 'Medtronic Pull',      type: 'finishing'},
  { sequence: 'Packaging',           type: 'finishing'},
  { sequence: 'PL Inspection',       type: 'finishing'},
  { sequence: 'Pressure Test',       type: 'finishing'},
  { sequence: 'Roll Cut',            type: 'finishing'},
  { sequence: 'Table Pull',          type: 'finishing'},
  { sequence: 'Wrapping',            type: 'finishing'},
];

const TYPE_GROUPS = [
  { label: 'Machine',   key: 'machine'  },
  { label: 'Draw',      key: 'draw'     },
  { label: 'Finishing', key: 'finishing'},
];

export async function renderStandardsAdmin(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">Item Standards</h1>
      <p class="view-subtitle">Throughput rates per item × sequence — units vary by type</p>
    </div>
    <div class="info-banner animate-in" style="margin-bottom:var(--space-md);">
      <strong>Machine</strong> = ft / hr &nbsp;·&nbsp;
      <strong>Draw</strong> = ft / hr &nbsp;·&nbsp;
      <strong>Finishing</strong> = units / hr
    </div>
    <div class="card animate-in" id="std-table"></div>
  `;

  // Track a reference to the live rows array so onAddClick can push into it
  let tableRows = null;

  await renderAdminTable(container.querySelector('#std-table'), {
    title: 'Item Standards',
    fetchData: async () => {
      const data = await api.standards();
      tableRows = data;
      return data;
    },
    primaryKey: 'id',
    searchKeys: ['item_number', 'sequence', 'standard_type'],
    groupBy: 'item_number',
    addButtonLabel: '+ Add Item',
    onAddClick: (pushRows) => showAddItemModal(pushRows),
    columns: [
      { key: 'id',              label: 'ID',           readOnly: true, width: 50 },
      { key: 'item_number',     label: 'Item #',        type: 'text',   width: 130 },
      { key: 'sequence',        label: 'Sequence',      type: 'text',   width: 140 },
      { key: 'standard_type',   label: 'Type',          type: 'select', options: ['machine','draw','finishing'], width: 90 },
      {
        key: 'seconds_per_unit',
        label: 'Rate / Standard',
        type: 'number',
        width: 150,
        renderCell: (value, row) => {
          const unit = UNIT_LABELS[row.standard_type] || '';
          const num  = value != null
            ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
            : '<span style="opacity:0.4;color:#f87171;">blank</span>';
          return `<td class="num">
            ${num}
            <span style="font-size:10px;font-weight:600;color:var(--text-muted);margin-left:4px;">${unit}</span>
          </td>`;
        },
      },
    ],
    onUpdate: (id, row) => api.updateStandard(id, row),
    onDelete: (id) => api.deleteStandard(id),
  });
}

// ── Add Item modal ─────────────────────────────────────────────────────────────
function showAddItemModal(pushRows) {
  const overlay = document.createElement('div');
  overlay.className = 'fc-modal-overlay';
  overlay.innerHTML = `
    <div class="fc-modal std-add-modal">
      <h3 style="margin-bottom:4px;">Add Item</h3>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:var(--space-md);">
        Check each sequence this item runs through. Rates will be blank — fill them in after saving.
      </p>

      <div class="std-modal-item-row">
        <label style="font-size:12px;font-weight:600;color:var(--text-secondary);width:60px;flex-shrink:0;">Item #</label>
        <input type="text" id="std-modal-item" placeholder="e.g. 110095" class="std-modal-item-input" />
      </div>

      <div class="std-seq-section">
        <div class="std-seq-toolbar">
          <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">Sequences</span>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="std-check-all">Check All</button>
            <button type="button" class="btn btn-secondary btn-sm" id="std-uncheck-all">Uncheck All</button>
          </div>
        </div>

        ${TYPE_GROUPS.map(group => {
          const seqs = SEQUENCE_DEFAULTS.filter(s => s.type === group.key);
          return `
            <div class="std-type-group">
              <div class="std-type-label">${group.label}</div>
              <div class="std-seq-grid">
                ${seqs.map(s => `
                  <label class="std-seq-check">
                    <input type="checkbox" name="seq" value="${escAttr(s.sequence)}" data-type="${s.type}" checked />
                    <span>${escHTML(s.sequence)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div id="std-modal-preview" class="std-modal-preview"></div>
      <div id="std-modal-error" style="color:#ef4444;font-size:12px;margin-top:8px;min-height:18px;"></div>

      <div class="fc-modal-actions" style="margin-top:var(--space-md);">
        <button class="btn btn-primary" id="std-modal-save">Create Item</button>
        <button class="btn btn-secondary" id="std-modal-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const itemInput  = overlay.querySelector('#std-modal-item');
  const errEl      = overlay.querySelector('#std-modal-error');
  const previewEl  = overlay.querySelector('#std-modal-preview');
  const checkboxes = () => [...overlay.querySelectorAll('input[type=checkbox][name=seq]')];

  function updatePreview() {
    const checked = checkboxes().filter(c => c.checked);
    previewEl.textContent = checked.length
      ? `${checked.length} sequence${checked.length !== 1 ? 's' : ''} will be created`
      : 'No sequences selected.';
  }
  updatePreview();

  overlay.querySelector('#std-check-all').addEventListener('click', () => {
    checkboxes().forEach(c => c.checked = true);
    updatePreview();
  });
  overlay.querySelector('#std-uncheck-all').addEventListener('click', () => {
    checkboxes().forEach(c => c.checked = false);
    updatePreview();
  });
  overlay.addEventListener('change', e => { if (e.target.name === 'seq') updatePreview(); });

  overlay.querySelector('#std-modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#std-modal-save').addEventListener('click', async () => {
    errEl.textContent = '';
    const item = itemInput.value.trim();
    if (!item) { errEl.textContent = 'Item # is required.'; itemInput.focus(); return; }

    const selected = checkboxes().filter(c => c.checked);
    if (selected.length === 0) { errEl.textContent = 'Select at least one sequence.'; return; }

    const saveBtn = overlay.querySelector('#std-modal-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating…';

    const created = [];
    const failed  = [];
    for (const cb of selected) {
      try {
        const row = await api.addStandard({
          item_number:     item,
          sequence:        cb.value,
          standard_type:   cb.dataset.type,
          seconds_per_unit: null,
        });
        created.push(row);
      } catch (err) {
        failed.push(`${cb.value}: ${err.message}`);
      }
    }

    if (failed.length > 0) {
      errEl.textContent = `${created.length} created, ${failed.length} failed: ${failed.join('; ')}`;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Create Item';
    } else {
      overlay.remove();
      pushRows(created);
    }
  });

  itemInput.focus();
}

function escHTML(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s ?? '').replace(/"/g,'&quot;'); }
