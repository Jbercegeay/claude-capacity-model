import { renderAdminTable } from '../../components/admin-table.js';
import { api } from '../../data/api.js';

export async function renderOvensAdmin(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">Oven Info</h1>
      <p class="view-subtitle">PI and PTFE oven equipment specs (reference only)</p>
    </div>
    <div class="card animate-in" id="ovens-table"></div>
  `;

  await renderAdminTable(container.querySelector('#ovens-table'), {
    title: 'Oven Info',
    fetchData: () => api.ovenInfo(),
    primaryKey: 'id',
    searchKeys: ['oven_type', 'oven_number', 'size'],
    columns: [
      { key: 'id',          label: 'ID',          readOnly: true, width: 50 },
      { key: 'oven_type',   label: 'Type',         type: 'select', options: ['PI','PTFE'], width: 70 },
      { key: 'oven_number', label: 'Oven #',        type: 'text',   width: 80 },
      { key: 'size',        label: 'Size',          type: 'text',   width: 80 },
      { key: 'heads',       label: 'Heads',         type: 'number', width: 70 },
      { key: 'rollers',     label: 'Rollers',       type: 'number', width: 70 },
      { key: 'annealers',   label: 'Annealers',     type: 'number', width: 80 },
      { key: 'payoffs',     label: 'Payoffs',       type: 'number', width: 70 },
      { key: 'takeups',     label: 'Takeups',       type: 'number', width: 70 },
      { key: 'laser_mics',  label: 'Laser Mics',    type: 'number', width: 80 },
      { key: 'notes',       label: 'Notes',         type: 'text',   width: 160 },
    ],
    addDefaults: { oven_type: 'PI' },
    onAdd:    (row) => api.addOven(row),
    onUpdate: (id, row) => api.updateOven(id, row),
    onDelete: (id) => api.deleteOven(id),
  });
}
