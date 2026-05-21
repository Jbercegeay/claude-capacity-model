import { renderAdminTable } from '../../components/admin-table.js';
import { api } from '../../data/api.js';

export async function renderYieldsAdmin(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">MFG Yields</h1>
      <p class="view-subtitle">Yield % per item — displayed and edited as a percentage; stored as a decimal multiplier for calculations</p>
    </div>
    <div class="card animate-in" id="yields-table"></div>
  `;

  await renderAdminTable(container.querySelector('#yields-table'), {
    title: 'Yields',
    fetchData: () => api.yields(),
    primaryKey: 'item_number',
    searchKeys: ['item_number', 'description'],
    columns: [
      { key: 'item_number', label: 'Item #',      type: 'text',   width: 140 },
      { key: 'yield',       label: 'Yield %',       type: 'number', width: 90, percent: true },
      { key: 'description', label: 'Description',  type: 'text',   width: 220 },
    ],
    addDefaults: { yield: 1.0 },   // stored as decimal; UI converts ×100 for display
    onAdd:    (row) => api.addYield(row),
    onUpdate: (item, row) => api.updateYield(item, row),
    onDelete: (item) => api.deleteYield(item),
  });
}
