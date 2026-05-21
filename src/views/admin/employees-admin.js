import { renderAdminTable } from '../../components/admin-table.js';
import { api } from '../../data/api.js';

const DEPTS   = ['PI Ovens','PI Finishing','PTFE Ovens','PTFE Finishing','Precision','Braid SPI','Extrusion'];
const SHIFTS  = ['A/1st','B/2nd','C/3rd','D','Weekend Day','Floater'];
const STATUSES = ['Active','FMLA','Partial FMLA','Recruiting','Exempt','NPI'];

export async function renderEmployeesAdmin(container) {
  container.innerHTML = `
    <div class="view-header animate-in">
      <h1 class="view-title">Employees</h1>
      <p class="view-subtitle">Employee roster by department, shift, and status</p>
    </div>
    <div class="card animate-in" id="emp-table"></div>
  `;

  await renderAdminTable(container.querySelector('#emp-table'), {
    title: 'Employees',
    fetchData: () => api.employees(),
    primaryKey: 'id',
    searchKeys: ['name', 'department', 'shift', 'function', 'status'],
    columns: [
      { key: 'id',         label: 'ID',         readOnly: true, width: 50 },
      { key: 'name',       label: 'Name',        type: 'text',   width: 150 },
      { key: 'department', label: 'Department',  type: 'select', options: DEPTS,    width: 120 },
      { key: 'shift',      label: 'Shift',       type: 'select', options: SHIFTS,   width: 90 },
      { key: 'function',   label: 'Function',    type: 'text',   width: 120 },
      { key: 'status',     label: 'Status',      type: 'select', options: STATUSES, width: 100 },
    ],
    addDefaults: { department: 'PI Ovens', shift: 'A/1st', status: 'Active' },
    onAdd:    (row) => api.addEmployee(row),
    onUpdate: (id, row) => api.updateEmployee(id, row),
    onDelete: (id) => api.deleteEmployee(id),
  });
}
