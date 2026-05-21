import { api } from '../../data/api.js';

export async function renderChangeGroups(container) {
  container.innerHTML = `<div class="loading-spinner animate-in">Loading Change Groups…</div>`;

  let groups = [], members = [];
  try {
    const res = await api.changeGroups();
    groups  = res.groups  || [];
    members = res.members || [];
  } catch (err) {
    container.innerHTML = `<div class="error-banner">${err.message}</div>`;
    return;
  }

  let expandedGroup = null;

  function render() {
    container.innerHTML = `
      <div class="view-header animate-in">
        <h1 class="view-title">Change Groups</h1>
        <p class="view-subtitle">Group-sum rules — sum member item demands and assign to a target item</p>
      </div>

      <div class="card animate-in" style="margin-bottom:var(--space-md);">
        <div class="admin-toolbar">
          <h2>Groups <span style="font-size:12px;font-weight:400;color:var(--text-muted);margin-left:8px;">${groups.length} groups</span></h2>
          <button class="btn btn-primary btn-sm" id="cg-add-btn">+ Add Group</button>
        </div>

        <div id="cg-add-form" style="display:none;background:rgba(59,130,246,0.06);border-radius:8px;padding:var(--space-md);margin-bottom:var(--space-md);">
          <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:var(--space-sm);">
            <div><label class="form-label">Group Name</label><input class="form-input" id="cg-name" placeholder="e.g. Fastpass Group" /></div>
            <div><label class="form-label">Target Item #</label><input class="form-input" id="cg-target" placeholder="e.g. 316292" /></div>
            <div><label class="form-label">Comment</label><input class="form-input" id="cg-comment" placeholder="Optional note" /></div>
          </div>
          <div style="margin-top:var(--space-sm);display:flex;gap:var(--space-sm);">
            <button class="btn btn-primary btn-sm" id="cg-add-save">Save Group</button>
            <button class="btn btn-secondary btn-sm" id="cg-add-cancel">Cancel</button>
          </div>
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th><th>Group Name</th><th>Target Item</th>
              <th>Members</th><th>Comment</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${groups.length === 0 ? `<tr><td colspan="6" class="empty-state">No groups</td></tr>` : ''}
            ${groups.map(g => {
              const grpMembers = members.filter(m => m.group_id === g.id);
              const isExpanded = expandedGroup === g.id;
              return `
                <tr>
                  <td>${g.id}</td>
                  <td style="font-weight:600">${g.group_name}</td>
                  <td><code style="background:rgba(79,142,247,0.1);padding:2px 6px;border-radius:4px;">${g.target_item}</code></td>
                  <td>
                    <button class="btn btn-secondary btn-sm cg-expand" data-gid="${g.id}">
                      ${grpMembers.length} members ${isExpanded ? '▲' : '▼'}
                    </button>
                  </td>
                  <td style="color:var(--text-muted)">${g.comment || '—'}</td>
                  <td>
                    <div class="row-actions">
                      <button class="btn btn-danger btn-sm cg-del" data-gid="${g.id}">Del</button>
                    </div>
                  </td>
                </tr>
                ${isExpanded ? `
                  <tr>
                    <td colspan="6" style="padding:0;">
                      <div style="background:rgba(0,0,0,0.2);padding:var(--space-md);border-radius:0 0 8px 8px;">
                        <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:var(--space-sm);">MEMBERS</div>
                        <table class="data-table" style="font-size:12px;">
                          <thead><tr><th>ID</th><th>Item #</th><th>Actions</th></tr></thead>
                          <tbody>
                            ${grpMembers.map(m => `
                              <tr>
                                <td>${m.id}</td>
                                <td>${m.item_number}</td>
                                <td><button class="btn btn-danger btn-sm cg-mem-del" data-mid="${m.id}">Del</button></td>
                              </tr>
                            `).join('')}
                            <tr>
                              <td colspan="2">
                                <input class="form-input" style="width:160px" placeholder="Add item #" id="add-mem-${g.id}" />
                              </td>
                              <td>
                                <button class="btn btn-primary btn-sm cg-mem-add" data-gid="${g.id}">Add Member</button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ` : ''}
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Add group toggle
    container.querySelector('#cg-add-btn').addEventListener('click', () => {
      const form = container.querySelector('#cg-add-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    container.querySelector('#cg-add-cancel').addEventListener('click', () => {
      container.querySelector('#cg-add-form').style.display = 'none';
    });

    // Save new group
    container.querySelector('#cg-add-save').addEventListener('click', async () => {
      const name   = container.querySelector('#cg-name').value.trim();
      const target = container.querySelector('#cg-target').value.trim();
      const comment = container.querySelector('#cg-comment').value.trim();
      if (!name || !target) { alert('Group name and target item required'); return; }
      try {
        const g = await api.addChangeGroup({ group_name: name, target_item: target, comment });
        groups.push(g);
        container.querySelector('#cg-add-form').style.display = 'none';
        render();
      } catch (err) { alert(err.message); }
    });

    // Expand/collapse
    container.querySelectorAll('.cg-expand').forEach(btn => {
      btn.addEventListener('click', () => {
        const gid = Number(btn.dataset.gid);
        expandedGroup = expandedGroup === gid ? null : gid;
        render();
      });
    });

    // Delete group
    container.querySelectorAll('.cg-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this group and all its members?')) return;
        const gid = Number(btn.dataset.gid);
        try {
          await api.deleteChangeGroup(gid);
          groups = groups.filter(g => g.id !== gid);
          members = members.filter(m => m.group_id !== gid);
          if (expandedGroup === gid) expandedGroup = null;
          render();
        } catch (err) { alert(err.message); }
      });
    });

    // Delete member
    container.querySelectorAll('.cg-mem-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mid = Number(btn.dataset.mid);
        try {
          await api.deleteGroupMember(mid);
          members = members.filter(m => m.id !== mid);
          render();
        } catch (err) { alert(err.message); }
      });
    });

    // Add member
    container.querySelectorAll('.cg-mem-add').forEach(btn => {
      btn.addEventListener('click', async () => {
        const gid = btn.dataset.gid;
        const input = container.querySelector(`#add-mem-${gid}`);
        const item = input?.value.trim();
        if (!item) { alert('Enter an item number'); return; }
        try {
          const m = await api.addGroupMember(gid, { item_number: item });
          members.push(m);
          render();
        } catch (err) { alert(err.message); }
      });
    });
  }

  render();
}
