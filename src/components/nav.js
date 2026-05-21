import { getToken, setToken } from '../data/api.js';

const REPORT_ITEMS = [
  { id: 'operational',      icon: '▦', label: 'Operational Detail' },
  { id: 'demand-breakdown', icon: '≋', label: 'Demand Breakdown' },
  { id: 'report-guide',     icon: '?', label: 'Report Guide' },
];

const ADMIN_ITEMS = [
  { id: 'admin/changes',   icon: '✎', label: 'Forecast Changes', priority: 'P1' },
  { id: 'admin/groups',    icon: '⊕', label: 'Change Groups',    priority: 'P1' },
  { id: 'admin/capacity',  icon: '👥', label: 'Capacity',         priority: 'P2' },
  { id: 'admin/standards', icon: '⚙', label: 'Item Standards',   priority: 'P2' },
  { id: 'admin/yields',    icon: '🔬', label: 'Yields',           priority: 'P2' },
  { id: 'admin/employees', icon: '👤', label: 'Employees',        priority: 'P3' },
  { id: 'admin/items',     icon: '📦', label: 'Items',            priority: 'P3' },
  { id: 'admin/days',      icon: '📅', label: 'Days in Month',    priority: 'P3' },
  { id: 'admin/settings',  icon: '⚙', label: 'Settings',         priority: 'P3' },
  { id: 'admin/ovens',     icon: '🏭', label: 'Oven Info',        priority: 'P3' },
  { id: 'admin/oracle',    icon: '↑', label: 'Oracle Upload',    priority: 'P1' },
];

export function renderNav(sidebar, currentView, navigate, schedule, onScheduleChange, coverageMode = 'official', onCoverageChange) {
  const isAdmin = !!getToken();

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <h1>Capacity Model</h1>
      <div class="logo-sub">DB-Backed · Port 3381</div>
    </div>

    <div class="nav-section">
      <div class="nav-section-title">Reports</div>
      ${REPORT_ITEMS.map(item => `
        <div class="nav-item ${currentView === item.id ? 'active' : ''}" data-nav="${item.id}">
          <span class="nav-icon">${item.icon}</span>${item.label}
        </div>
      `).join('')}
    </div>

    <div class="nav-section">
      <div class="nav-section-title">Schedule</div>
      <div class="schedule-toggle">
        <button class="schedule-btn ${schedule === '5 Day' ? 'active' : ''}" data-sched="5 Day">5 Day</button>
        <button class="schedule-btn ${schedule === '7 Day' ? 'active' : ''}" data-sched="7 Day">7 Day</button>
      </div>
    </div>

    <div class="nav-section">
      <div class="nav-section-title">Demand Scope</div>
      <div class="schedule-toggle coverage-toggle">
        <button class="schedule-btn ${coverageMode === 'official' ? 'active' : ''}" data-coverage="official">Official</button>
        <button class="schedule-btn ${coverageMode === 'review' ? 'active' : ''}" data-coverage="review">Review</button>
        <button class="schedule-btn ${coverageMode === 'combined' ? 'active' : ''}" data-coverage="combined">Combined</button>
      </div>
    </div>

    ${isAdmin ? `
      <div class="nav-section">
        <div class="nav-section-title">Admin</div>
        ${ADMIN_ITEMS.map(item => `
          <div class="nav-item ${currentView === item.id ? 'active' : ''}" data-nav="${item.id}">
            <span class="nav-icon">${item.icon}</span>${item.label}
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="nav-section">
        <div style="padding: 0 var(--space-lg);">
          <div class="nav-item" data-nav="login" style="border-left:3px solid transparent;">
            <span class="nav-icon">🔒</span>Admin Login
          </div>
        </div>
      </div>
    `}

    <div class="nav-footer">
      <div class="nav-footer-label">Status</div>
      <div class="nav-footer-status" id="nav-db-status">checking…</div>
      ${isAdmin ? `<div style="margin-top:8px;"><span class="nav-item" style="padding:4px 0;font-size:11px;color:var(--text-muted);cursor:pointer;" id="nav-logout">Sign out</span></div>` : ''}
    </div>
  `;

  // Wire up nav clicks
  sidebar.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });

  // Schedule toggle
  sidebar.querySelectorAll('[data-sched]').forEach(btn => {
    btn.addEventListener('click', () => onScheduleChange && onScheduleChange(btn.dataset.sched));
  });

  // Demand scope toggle
  sidebar.querySelectorAll('[data-coverage]').forEach(btn => {
    btn.addEventListener('click', () => onCoverageChange && onCoverageChange(btn.dataset.coverage));
  });

  // Sign out
  const logoutBtn = sidebar.querySelector('#nav-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      setToken(null);
      navigate('operational');
    });
  }

  // DB health check
  fetch('/api/health').then(r => r.json()).then(data => {
    const el = sidebar.querySelector('#nav-db-status');
    if (el) {
      el.textContent = data.ok ? '● DB connected' : '● DB missing';
      el.className = 'nav-footer-status' + (data.ok ? '' : ' offline');
    }
  }).catch(() => {
    const el = sidebar.querySelector('#nav-db-status');
    if (el) { el.textContent = '● Server offline'; el.className = 'nav-footer-status offline'; }
  });
}
