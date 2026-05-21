import './style.css';
import { getToken } from './data/api.js';
import { renderNav } from './components/nav.js';
import { renderLogin } from './views/login.js';
import { renderOperational } from './views/operational.js';
import { renderDemandBreakdown } from './views/demand-breakdown.js';
import { renderReportGuide } from './views/report-guide.js';
import { renderForecastChanges } from './views/admin/forecast-changes.js';
import { renderChangeGroups } from './views/admin/change-groups.js';
import { renderCapacityAdmin } from './views/admin/capacity-admin.js';
import { renderStandardsAdmin } from './views/admin/standards-admin.js';
import { renderYieldsAdmin } from './views/admin/yields-admin.js';
import { renderEmployeesAdmin } from './views/admin/employees-admin.js';
import { renderItemsAdmin } from './views/admin/items-admin.js';
import { renderDaysAdmin } from './views/admin/days-admin.js';
import { renderSettingsAdmin } from './views/admin/settings-admin.js';
import { renderOvensAdmin } from './views/admin/ovens-admin.js';
import { renderOracleUpload } from './views/admin/oracle-upload.js';

// ─── App state ────────────────────────────────────────────────────────────────
let currentView = 'operational';
let schedule    = '5 Day';
let coverageMode = 'official';

const ADMIN_VIEWS = new Set([
  'admin/changes','admin/groups','admin/capacity','admin/standards',
  'admin/yields','admin/employees','admin/items','admin/days',
  'admin/settings','admin/ovens','admin/oracle',
]);

const sidebar       = document.getElementById('sidebar');
const viewContainer = document.getElementById('view-container');

// ─── Routing ──────────────────────────────────────────────────────────────────
function navigate(viewId) {
  // Guard admin routes
  if (ADMIN_VIEWS.has(viewId) && !getToken()) {
    currentView = 'login';
    render();
    return;
  }
  currentView = viewId;
  render();
}

async function render() {
  renderNav(sidebar, currentView, navigate, schedule, (s) => {
    schedule = s;
    render();
  }, coverageMode, (mode) => {
    coverageMode = mode;
    render();
  });

  viewContainer.innerHTML = '';

  switch (currentView) {
    case 'login':
      renderLogin(viewContainer, () => navigate('admin/changes'));
      break;

    case 'operational':
      await renderOperational(viewContainer, schedule, coverageMode);
      break;

    case 'demand-breakdown':
      await renderDemandBreakdown(viewContainer, schedule, coverageMode);
      break;

    case 'report-guide':
      renderReportGuide(viewContainer);
      break;

    case 'admin/changes':
      await renderForecastChanges(viewContainer);
      break;

    case 'admin/groups':
      await renderChangeGroups(viewContainer);
      break;

    case 'admin/capacity':
      await renderCapacityAdmin(viewContainer);
      break;

    case 'admin/standards':
      await renderStandardsAdmin(viewContainer);
      break;

    case 'admin/yields':
      await renderYieldsAdmin(viewContainer);
      break;

    case 'admin/employees':
      await renderEmployeesAdmin(viewContainer);
      break;

    case 'admin/items':
      await renderItemsAdmin(viewContainer);
      break;

    case 'admin/days':
      await renderDaysAdmin(viewContainer);
      break;

    case 'admin/settings':
      await renderSettingsAdmin(viewContainer);
      break;

    case 'admin/ovens':
      await renderOvensAdmin(viewContainer);
      break;

    case 'admin/oracle':
      await renderOracleUpload(viewContainer);
      break;

    default:
      viewContainer.innerHTML = `<div class="empty-state">Page not found: ${currentView}</div>`;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
render();
