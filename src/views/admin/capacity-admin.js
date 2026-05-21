import { renderAdminTable } from '../../components/admin-table.js';
import { api } from '../../data/api.js';

export async function renderCapacityAdmin(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">Capacity</h1>
      <p class="view-subtitle">Headcount / machine heads per Process × Value Stream</p>
    </div>
    <div class="card animate-in" id="cap-table"></div>
  `;

  await renderAdminTable(container.querySelector('#cap-table'), {
    title: 'Capacity',
    fetchData: () => api.capacity(),
    primaryKey: 'id',
    searchKeys: ['process', 'value_stream'],
    groupBy: 'process',
    columns: [
      { key: 'id',           label: 'ID',           readOnly: true, width: 50 },
      { key: 'process',      label: 'Process',       type: 'text',   width: 140 },
      { key: 'value_stream', label: 'Value Stream',  type: 'text',   width: 110 },
      { key: 'capacity',     label: 'Capacity',      type: 'number', width: 90 },
      { key: 'uom',          label: 'UOM',           type: 'select', options: ['People','Heads'], width: 90 },
    ],
    addDefaults: { uom: 'People', capacity: 0 },
    onAdd:    (row) => api.addCapacity(row),
    onUpdate: (id, row) => api.updateCapacity(id, row),
    onDelete: (id) => api.deleteCapacity(id),
  });
}
