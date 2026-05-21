import { renderAdminTable } from '../../components/admin-table.js';
import { api } from '../../data/api.js';

const VS_OPTIONS = ['PI','PTFE','Ex','PL','AC/DC','Micro Cath'];
const UOM_OPTIONS = ['EA','FT','IN','CM','ME','MM'];
const STATUS_OPTIONS = ['Active','Inactive','Obsolete'];

export async function renderItemsAdmin(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">Items</h1>
      <p class="view-subtitle">Product catalog — key fields for demand calculation</p>
    </div>
    <div class="info-banner animate-in">
      Showing key columns. Full item records include additional dimensional fields (OD, ID, wall, etc.) editable via the inline form.
    </div>
    <div class="card animate-in" id="items-table"></div>
  `;

  await renderAdminTable(container.querySelector('#items-table'), {
    title: 'Items',
    fetchData: () => api.items(),
    primaryKey: 'item_number',
    searchKeys: ['item_number', 'description', 'value_stream', 'customer', 'product_family'],
    columns: [
      { key: 'item_number',    label: 'Item #',         type: 'text',   width: 120 },
      { key: 'description',    label: 'Description',    type: 'text',   width: 200 },
      { key: 'value_stream',   label: 'Value Stream',   type: 'select', options: VS_OPTIONS, width: 100 },
      { key: 'customer',       label: 'Customer',       type: 'text',   width: 120 },
      { key: 'product_family', label: 'Family',         type: 'text',   width: 100 },
      { key: 'uom',            label: 'UOM',            type: 'select', options: UOM_OPTIONS, width: 70 },
      { key: 'fg_length',      label: 'FG Length (in)', type: 'number', width: 100 },
      { key: 'status',         label: 'Status',         type: 'select', options: STATUS_OPTIONS, width: 90 },
    ],
    addDefaults: { uom: 'EA', status: 'Active', value_stream: 'PI' },
    onAdd:    (row) => api.addItem(row),
    onUpdate: (item, row) => api.updateItem(item, row),
    onDelete: (item) => api.deleteItem(item),
  });
}
