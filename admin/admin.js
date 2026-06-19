(() => {
  const loginOverlay = document.getElementById('login-overlay');
  const loginBtn = document.getElementById('login-btn');
  const tokenInput = document.getElementById('token-input');
  const loginError = document.getElementById('login-error');
  const logoutBtn = document.getElementById('logout-btn');
  const tabsEl = document.getElementById('tabs');
  const filterInput = document.getElementById('filter-input');
  const docList = document.getElementById('doc-list');
  const loadMoreEl = document.getElementById('load-more');
  const statsBar = document.getElementById('stats-bar');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalContent = document.getElementById('modal-content');
  const modalClose = document.getElementById('modal-close');

  let token = sessionStorage.getItem('admin_token') || '';
  let currentCol = 'scan_logs';
  let nextPageToken = null;
  let allItems = [];

  function apiFetch(path, opts = {}) {
    return fetch(path, { ...opts, headers: { 'x-admin-token': token, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  }

  async function checkLogin() {
    if (!token) { showLogin(); return; }
    const r = await apiFetch('/api/admin/login-check');
    if (r.ok) { hideLogin(); loadCollection(); }
    else { token = ''; sessionStorage.removeItem('admin_token'); showLogin(); }
  }

  function showLogin() { loginOverlay.style.display = 'flex'; }
  function hideLogin() { loginOverlay.style.display = 'none'; }

  loginBtn.addEventListener('click', async () => {
    const t = tokenInput.value.trim();
    if (!t) return;
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Verificando…';
    const r = await fetch('/api/admin/login-check', { headers: { 'x-admin-token': t } });
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
    if (r.ok) {
      token = t;
      sessionStorage.setItem('admin_token', token);
      hideLogin();
      loadCollection();
    } else {
      loginError.textContent = 'Token incorrecto.';
    }
  });

  tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });

  logoutBtn.addEventListener('click', () => {
    token = '';
    sessionStorage.removeItem('admin_token');
    showLogin();
  });

  tabsEl.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCol = btn.dataset.col;
    filterInput.value = '';
    allItems = [];
    nextPageToken = null;
    loadCollection();
  });

  filterInput.addEventListener('input', () => renderList());

  async function loadCollection(append = false) {
    if (!append) { allItems = []; nextPageToken = null; docList.innerHTML = '<div class="empty-msg">Cargando…</div>'; loadMoreEl.innerHTML = ''; }
    const url = '/api/admin/' + currentCol + (nextPageToken ? '?pageToken=' + encodeURIComponent(nextPageToken) : '');
    const r = await apiFetch(url);
    if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al cargar.</div>'; return; }
    const data = await r.json();
    allItems = allItems.concat(data.items || []);
    nextPageToken = data.nextPageToken || null;
    renderList();
    loadMoreEl.innerHTML = nextPageToken
      ? '<button class="btn" id="btn-load-more" style="font-size:0.85rem;">Cargar más</button>'
      : '';
    if (nextPageToken) document.getElementById('btn-load-more').addEventListener('click', () => loadCollection(true));
  }

  function renderLogs(items) {
    if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin logs todavía.</div>'; return; }
    const rows = items.map(item => {
      const d = item.data || {};
      const fecha = d.ts ? new Date(d.ts).toLocaleString('es-MX') : '—';
      const loc = [d.city, d.region, d.country].filter(Boolean).join(', ') || '—';
      return `<tr>
        <td class="mono">${escHtml(fecha)}</td>
        <td class="mono">${escHtml(d.barcode || '—')}</td>
        <td class="mono">${escHtml(d.ip || '—')}</td>
        <td>${escHtml(loc)}</td>
        <td>${escHtml(d.os || '—')}</td>
        <td><button class="del-log btn-del" data-action="del" data-id="${escHtml(item.id)}">✕</button></td>
      </tr>`;
    }).join('');
    docList.innerHTML = `<table class="log-table">
      <thead><tr><th>Fecha/Hora</th><th>Código</th><th>IP</th><th>Ubicación</th><th>Sistema</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function summaryOf(item) {
    const d = item.data;
    if (!d) return '—';
    if (d.ingredients_ocr) return d.ingredients_ocr.substring(0, 60) + '…';
    if (d.nutritionData) return 'cal:' + (d.nutritionData.calorias || '?') + ' prot:' + (d.nutritionData.proteinas || '?');
    if (d.response?.product?.name) return d.response.product.name.substring(0, 60);
    if (d.response?.content) return String(d.response.content).substring(0, 60) + '…';
    return JSON.stringify(d).substring(0, 60) + '…';
  }

  function renderList() {
    const q = filterInput.value.trim().toLowerCase();
    const items = q ? allItems.filter(i => {
      if (currentCol === 'scan_logs') {
        const d = i.data || {};
        return i.id.includes(q) || (d.barcode||'').includes(q) || (d.ip||'').toLowerCase().includes(q) || (d.os||'').toLowerCase().includes(q);
      }
      return i.id.toLowerCase().includes(q);
    }) : allItems;
    statsBar.textContent = items.length + (currentCol === 'scan_logs' ? ' escaneo' : ' documento') + (items.length !== 1 ? 's' : '') + (q ? ' (filtrado)' : '');
    if (currentCol === 'scan_logs') { renderLogs(items); return; }
    if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin resultados.</div>'; return; }
    docList.innerHTML = items.map(item => `
      <div class="doc-item" data-id="${escHtml(item.id)}">
        <div>
          <div class="doc-id">${escHtml(item.id)}</div>
          <div class="doc-meta">${escHtml(summaryOf(item))}</div>
        </div>
        <div class="doc-actions">
          <button class="btn-view" data-action="view" data-id="${escHtml(item.id)}">Ver</button>
          <button class="btn-del" data-action="del" data-id="${escHtml(item.id)}">Eliminar</button>
        </div>
      </div>`).join('');
  }

  docList.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'view') {
      const item = allItems.find(i => i.id === id);
      if (!item) return;
      modalTitle.textContent = id;
      modalContent.textContent = JSON.stringify(item.data, null, 2);
      modalOverlay.classList.add('open');
    } else if (btn.dataset.action === 'del') {
      if (!confirm('¿Eliminar "' + id + '" de ' + currentCol + '?')) return;
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/' + currentCol + '/' + encodeURIComponent(id), { method: 'DELETE' });
      if (r.ok) {
        allItems = allItems.filter(i => i.id !== id);
        renderList();
      } else {
        alert('Error al eliminar.');
        btn.disabled = false;
        btn.textContent = 'Eliminar';
      }
    }
  });

  modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });

  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  checkLogin();
})();
