import { adminLogin, setToken } from '../data/api.js';

export function renderLogin(container, onSuccess) {
  container.innerHTML = `
    <div class="login-wrap animate-in">
      <div class="login-card">
        <div class="login-title">Admin Login</div>
        <div class="login-sub">Enter your admin password to access data management pages.</div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" class="form-input" id="login-pw" placeholder="admin" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary" style="width:100%" id="login-btn">Sign In</button>
        <div class="login-error" id="login-err" style="display:none"></div>
        <div style="margin-top:var(--space-md);font-size:11px;color:var(--text-muted);">
          Default password: <code>admin</code> — change it in Admin → Settings.
        </div>
      </div>
    </div>
  `;

  const pw  = container.querySelector('#login-pw');
  const btn = container.querySelector('#login-btn');
  const err = container.querySelector('#login-err');

  async function doLogin() {
    err.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const res = await adminLogin(pw.value.trim() || 'admin');
      setToken(res.token);
      onSuccess();
    } catch (e) {
      err.textContent = 'Incorrect password.';
      err.style.display = 'block';
      pw.value = '';
      pw.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  btn.addEventListener('click', doLogin);
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  pw.focus();
}
