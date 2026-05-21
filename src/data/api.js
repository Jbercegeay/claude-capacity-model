/**
 * api.js — Thin API client for the Claude Capacity Model server (port 3381).
 * All write operations require the admin token stored in localStorage.
 */

export function getToken() {
  return localStorage.getItem('cap-admin-token') || '';
}

export function setToken(t) {
  if (t) localStorage.setItem('cap-admin-token', t);
  else localStorage.removeItem('cap-admin-token');
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'X-Admin-Token': getToken() };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function adminLogin(password) {
  return apiFetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export function fetchDbReport(schedule = '5 Day', month = null, coverage = 'official') {
  const p = new URLSearchParams({ schedule, coverage });
  if (month) p.set('month', month);
  return apiFetch(`/api/db-report?${p}`);
}

export function fetchDemandBreakdown(schedule = '5 Day', coverage = 'official', opts = {}) {
  const p = new URLSearchParams({ schedule, coverage });
  if (opts.includeMachines) p.set('includeMachines', 'true');
  return apiFetch(`/api/db-demand-breakdown?${p}`);
}

// ─── Read endpoints ───────────────────────────────────────────────────────────
export const api = {
  settings:        () => apiFetch('/api/settings'),
  capacity:        () => apiFetch('/api/capacity'),
  daysInMonth:     () => apiFetch('/api/days-in-month'),
  sequenceCaps:    () => apiFetch('/api/sequence-caps'),
  standards:       (q = {}) => apiFetch('/api/standards?' + new URLSearchParams(q)),
  yields:          () => apiFetch('/api/yields'),
  items:           () => apiFetch('/api/items'),
  employees:       (dept) => apiFetch('/api/employees' + (dept ? `?department=${encodeURIComponent(dept)}` : '')),
  ovenInfo:        () => apiFetch('/api/oven-info'),
  oracleForecast:  () => apiFetch('/api/oracle-forecast'),
  forecastChanges: () => apiFetch('/api/admin/forecast-changes', { headers: authHeaders() }),
  changeGroups:    () => apiFetch('/api/forecast-change-groups'),
  auditLog:        (t) => apiFetch('/api/audit-log' + (t ? `?table=${t}&limit=200` : '?limit=200')),

  // ─── Forecast Changes ────────────────────────────────────────────────────────
  addForecastChange: (body) => apiFetch('/api/admin/forecast-changes', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateForecastChange: (id, body) => apiFetch(`/api/admin/forecast-changes/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteForecastChange: (id) => apiFetch(`/api/admin/forecast-changes/${id}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Change Groups ────────────────────────────────────────────────────────────
  addChangeGroup: (body) => apiFetch('/api/forecast-change-groups', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateChangeGroup: (id, body) => apiFetch(`/api/forecast-change-groups/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteChangeGroup: (id) => apiFetch(`/api/forecast-change-groups/${id}`, { method: 'DELETE', headers: authHeaders() }),
  addGroupMember: (groupId, body) => apiFetch(`/api/forecast-change-groups/${groupId}/members`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteGroupMember: (id) => apiFetch(`/api/forecast-change-group-members/${id}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Capacity ────────────────────────────────────────────────────────────────
  addCapacity:    (body) => apiFetch('/api/capacity', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateCapacity: (id, body) => apiFetch(`/api/capacity/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteCapacity: (id) => apiFetch(`/api/capacity/${id}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Item Standards ──────────────────────────────────────────────────────────
  addStandard:    (body) => apiFetch('/api/standards', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateStandard: (id, body) => apiFetch(`/api/standards/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteStandard: (id) => apiFetch(`/api/standards/${id}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Yields ──────────────────────────────────────────────────────────────────
  addYield:    (body) => apiFetch('/api/yields', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateYield: (item, body) => apiFetch(`/api/yields/${encodeURIComponent(item)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteYield: (item) => apiFetch(`/api/yields/${encodeURIComponent(item)}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Employees ───────────────────────────────────────────────────────────────
  addEmployee:    (body) => apiFetch('/api/employees', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateEmployee: (id, body) => apiFetch(`/api/employees/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteEmployee: (id) => apiFetch(`/api/employees/${id}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Items ────────────────────────────────────────────────────────────────────
  addItem:    (body) => apiFetch('/api/items', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateItem: (item, body) => apiFetch(`/api/items/${encodeURIComponent(item)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteItem: (item) => apiFetch(`/api/items/${encodeURIComponent(item)}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Days in Month ────────────────────────────────────────────────────────────
  upsertDays: (body) => apiFetch('/api/days-in-month', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),

  // ─── Settings ─────────────────────────────────────────────────────────────────
  updateSetting: (key, value) => apiFetch(`/api/settings/${encodeURIComponent(key)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ value }) }),

  // ─── Oven Info ────────────────────────────────────────────────────────────────
  addOven:    (body) => apiFetch('/api/oven-info', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }),
  updateOven: (id, body) => apiFetch(`/api/oven-info/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) }),
  deleteOven: (id) => apiFetch(`/api/oven-info/${id}`, { method: 'DELETE', headers: authHeaders() }),

  // ─── Oracle Forecast upload ────────────────────────────────────────────────────
  uploadOracle: (file) => {
    const fd = new FormData();
    fd.append('forecast', file);
    return apiFetch('/api/oracle-forecast', { method: 'POST', body: fd });
  },
};
