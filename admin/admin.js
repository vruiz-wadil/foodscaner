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
  const sectionTitle = document.getElementById('section-title');
  const toolbarEl = document.getElementById('toolbar');

  let token = sessionStorage.getItem('admin_token') || '';
  let currentCol = 'resumen';
  let nextPageToken = null;
  let allItems = [];
  let reportBarcodes = null;
  let lastCacheData = null;

  const SECTION_TITLES = { resumen: 'Resumen', scan_logs: 'Logs de escaneo', reports: 'Reportes', products_ocr: 'OCR ingredientes', products_nutrition: 'OCR nutrición', cache: 'Cache' };

  async function loadStats() {
    docList.innerHTML = '<div class="empty-msg">Cargando…</div>';
    statsBar.textContent = '';
    loadMoreEl.innerHTML = '';
    const r = await apiFetch('/api/admin/stats');
    if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al cargar.</div>'; return; }
    renderStats(await r.json());
  }

  function renderStats(s) {
    document.querySelectorAll('.nav-count').forEach(el => {
      const c = s.counts && s.counts[el.dataset.count];
      el.textContent = (c != null) ? c : '';
    });
    const max = Math.max(1, ...s.byDay.map(d => d.count));
    const bars = s.byDay.map(d =>
      `<div class="bar" style="height:${Math.max(2, Math.round(d.count / max * 100))}%" title="${escHtml(d.date)}: ${d.count}"></div>`
    ).join('');
    const topRows = s.topProducts.map(p => `<tr>
      <td class="mono"><a class="barcode-link" target="_blank" rel="noopener" href="https://www.yomi.mx/scan.html?barcode=${encodeURIComponent(p.barcode)}">${escHtml(p.barcode)}</a></td>
      <td>${escHtml(p.name || '—')}</td>
      <td class="mono">${p.count}</td>
    </tr>`).join('');
    const breakdown = list => (list && list.length)
      ? list.slice(0, 8).map(r => {
          const pct = s.total ? Math.round(r.count / s.total * 100) : 0;
          return `<div class="bk-row"><span class="bk-key" title="${escHtml(r.key)}">${escHtml(r.key)}</span><span class="bk-bar"><span style="width:${pct}%"></span></span><span class="bk-n">${r.count}</span></div>`;
        }).join('')
      : '<div class="empty-msg" style="padding:10px 0;">Sin datos.</div>';
    docList.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card"><div class="num">${s.total}</div><div class="lbl">Escaneos</div></div>
        <div class="stat-card"><div class="num">${s.today}</div><div class="lbl">Hoy</div></div>
        <div class="stat-card"><div class="num">${s.uniqueProducts}</div><div class="lbl">Productos únicos</div></div>
        <div class="stat-card"><div class="num">${s.notFoundPct}%</div><div class="lbl">No encontrados</div></div>
        <div class="stat-card"><div class="num">${s.ocrPct}%</div><div class="lbl">Con OCR</div></div>
      </div>
      <h3 class="stats-h">Escaneos por día (30 días)</h3>
      <div class="chart">${bars}</div>
      <div class="stats-cols">
        <div>
          <h3 class="stats-h">Top productos</h3>
          <table class="log-table"><thead><tr><th>Código</th><th>Producto</th><th>#</th></tr></thead>
          <tbody>${topRows || '<tr><td colspan="3" class="empty-msg">Sin datos.</td></tr>'}</tbody></table>
        </div>
        <div>
          <h3 class="stats-h">País</h3>${breakdown(s.byCountry)}
          <h3 class="stats-h">Sistema</h3>${breakdown(s.byOS)}
        </div>
      </div>`;
  }

  async function loadBarcodeFlags() {
    if (reportBarcodes) return; // cached for session
    const rr = await apiFetch('/api/admin/reports');
    reportBarcodes = new Set(rr.ok ? (await rr.json()).items.map(i => (i.data||{}).barcode).filter(Boolean) : []);
  }

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
    sectionTitle.textContent = SECTION_TITLES[currentCol] || currentCol;
    toolbarEl.style.display = currentCol === 'resumen' ? 'none' : 'flex';
    filterInput.value = '';
    allItems = [];
    lastCacheData = null;
    nextPageToken = null;
    loadCollection();
  });

  filterInput.addEventListener('input', () => {
    if (currentCol === 'cache') {
      if (lastCacheData) renderCacheAll(lastCacheData, filterInput.value.trim().toLowerCase());
    } else {
      renderList();
    }
  });

  async function loadCollection(append = false) {
    if (currentCol === 'resumen') { await loadStats(); return; }
    if (!append) { allItems = []; nextPageToken = null; docList.innerHTML = '<div class="empty-msg">Cargando…</div>'; loadMoreEl.innerHTML = ''; }
    if (currentCol === 'scan_logs' && !append) await loadBarcodeFlags();

    if (currentCol === 'cache') {
      const r = await apiFetch('/api/admin/cache-all');
      if (!r.ok) { docList.innerHTML = '<div class="empty-msg">Error al cargar.</div>'; return; }
      const data = await r.json();
      lastCacheData = data;
      const q = filterInput.value.trim().toLowerCase();
      renderCacheAll(data, q);
      const total = (data.product.length + data.ai.length);
      statsBar.textContent = total + ' entradas cacheadas' + (q ? ' (filtrado)' : '');
      loadMoreEl.innerHTML = '';
      return;
    }

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

  function renderReports(items) {
    if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin reportes todavía.</div>'; return; }
    const rows = items.map(item => {
      const d = item.data || {};
      const fecha = d.ts ? new Date(d.ts).toLocaleString('es-MX') : '—';
      const commentShort = (d.comment || '').substring(0, 50) + ((d.comment || '').length > 50 ? '…' : '');
      return `<tr>
        <td class="mono">${escHtml(fecha)}</td>
        <td class="mono">${escHtml(d.barcode || '—')}</td>
        <td>${escHtml(d.category || '—')}</td>
        <td>${escHtml(commentShort || '—')}</td>
        <td>${escHtml(d.os || '—')}</td>
        <td>
          <button class="btn-view" data-action="view" data-id="${escHtml(item.id)}">Ver</button>
          <button class="del-log btn-del" data-action="del" data-id="${escHtml(item.id)}">✕</button>
        </td>
      </tr>`;
    }).join('');
    docList.innerHTML = `<table class="log-table">
      <thead><tr><th>Fecha/Hora</th><th>Código</th><th>Categoría</th><th>Comentario</th><th>Sistema</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderCacheAll(data, filterText = '') {
    let { product = [], ai = [] } = data;
    if (filterText) {
      product = product.filter(i => (i.barcode || '').toLowerCase().includes(filterText) || (i.name || '').toLowerCase().includes(filterText) || (i.source || '').toLowerCase().includes(filterText));
      ai = ai.filter(i => (i.key || '').toLowerCase().includes(filterText) || (i.displayName || '').toLowerCase().includes(filterText) || (i.model || '').toLowerCase().includes(filterText) || (i.barcodes || []).some(b => b.includes(filterText)));
    }
    let html = '';

    // Product section
    html += '<div class="cache-section"><h3>📦 Productos</h3>';
    if (!product.length) {
      html += '<div class="empty-msg">Sin productos cacheados.</div>';
    } else {
      html += product.map(item => {
        const badge = item.inL1 && item.inL2 ? 'L1+L2' : item.inL1 ? 'L1' : 'L2';
        const badgeCls = item.inL1 && item.inL2 ? 'cache-badge-both' : item.inL1 ? 'cache-badge-l1' : 'cache-badge-l2';
        const layer = item.inL1 && item.inL2 ? 'all' : item.inL1 ? 'l1' : 'l2';
        const date = item.cachedAt ? new Date(item.cachedAt * 1000).toLocaleString('es-MX') : '—';
        return `<div class="doc-item">
          <div>
            <div class="doc-id">${escHtml(item.barcode)}</div>
            <div class="doc-meta">${item.name ? escHtml(item.name) + ' · ' : ''}<span class="cache-source">${escHtml(item.source)}</span> · ${escHtml(date)}</div>
          </div>
          <div class="doc-actions">
            <span class="cache-badge ${badgeCls}">${badge}</span>
            <button class="btn-del" data-action="del-cache" data-type="product" data-key="${escHtml(item.barcode)}" data-layer="${escHtml(layer)}">✕</button>
          </div>
        </div>`;
      }).join('');
    }
    html += '</div>';

    // AI section
    html += '<div class="cache-section"><h3>🤖 Análisis IA</h3>';
    if (!ai.length) {
      html += '<div class="empty-msg">Sin análisis IA cacheados.</div>';
    } else {
      html += ai.map(item => {
        const badge = item.inL1 && item.inL2 ? 'L1+L2' : item.inL1 ? 'L1' : 'L2';
        const badgeCls = item.inL1 && item.inL2 ? 'cache-badge-both' : item.inL1 ? 'cache-badge-l1' : 'cache-badge-l2';
        const layer = item.inL1 && item.inL2 ? 'all' : item.inL1 ? 'l1' : 'l2';
        const date = item.cachedAt ? new Date(item.cachedAt * 1000).toLocaleString('es-MX') : '—';
        const displayName = item.displayName.length > 60 ? item.displayName.substring(0, 60) + '…' : item.displayName;
        const barcodesLabel = (item.barcodes && item.barcodes.length) ? item.barcodes.join(', ') : '—';
        return `<div class="doc-item">
          <div>
            <div class="doc-id">${escHtml(displayName)}</div>
            <div class="doc-meta">${escHtml(barcodesLabel)} · ${escHtml(item.model || '—')} · ${escHtml(date)}</div>
          </div>
          <div class="doc-actions">
            <span class="cache-badge ${badgeCls}">${badge}</span>
            <button class="btn-view" data-action="view-cache" data-key="${escHtml(item.key)}">Ver</button>
            <button class="btn-del" data-action="del-cache" data-type="ai" data-key="${escHtml(item.key)}" data-layer="${escHtml(layer)}">✕</button>
          </div>
        </div>`;
      }).join('');
    }
    html += '</div>';

    docList.innerHTML = html;
  }

  const SOURCE_LABELS = { cache: '💾 Cache', ia: '🤖 IA', db: '🌐 DB' };
  const CACHE_LABELS = { L1: '💾 L1', L2: '💾 L2', none: '—' };
  const ING_LABELS = { ocr: '📷 OCR', db: '🌐 DB', ai: '🤖 IA', none: '—' };
  const NUT_LABELS = { ocr: '📊 OCR', db: '🌐 DB', ai: '🤖 IA', none: '—' };

  function renderLogs(items) {
    if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin logs todavía.</div>'; return; }
    docList.innerHTML = items.map(item => {
      const d = item.data || {};
      const fecha = d.ts ? new Date(d.ts).toLocaleString('es-MX') : '—';
      const loc = [d.city, d.region, d.country].filter(Boolean).join(', ') || '—';
      const bc = d.barcode || '';
      const badges = [
        d.notFound       ? '<span class="log-badge log-badge-red">🔍 No encontrado</span>'    : '',
        d.hasOcr         ? '<span class="log-badge log-badge-blue">📷 Ing OCR</span>'          : '',
        d.hasNutritionOcr? '<span class="log-badge log-badge-blue">📊 Nut OCR</span>'          : '',
        reportBarcodes?.has(bc) ? '<span class="log-badge log-badge-orange">🚩 Reporte</span>' : ''
      ].filter(Boolean).join(' ');
      const cacheLabel = CACHE_LABELS[d.cacheLevel] || '—';
      const ingLabel = ING_LABELS[d.ingredientSource] || '—';
      const nutLabel = NUT_LABELS[d.nutritionSource] || '—';
      const sourcesLabel = (d.sourcesTried && d.sourcesTried.length)
        ? d.sourcesTried.map(s => s.source + (s.found ? ' ✓' : ' ✗')).join(' · ')
        : '—';
      const durationLabel = d.durationMs != null ? `⏱ ${(d.durationMs / 1000).toFixed(1)}s` : '';
      const metaParts = [
        `📍 ${escHtml(loc)}`,
        `🖥 ${escHtml(d.os || '—')}`,
        `💾 ${escHtml(cacheLabel)}`,
        d.ingredientSource ? `🔍 ${ingLabel}` : '',
        d.nutritionSource ? `📊 ${nutLabel}` : '',
        durationLabel
      ].filter(Boolean);
      const detailParts = [
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">IP:</span><span>${escHtml(d.ip || '—')}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">User-Agent:</span><span>${escHtml(d.ua || '—')}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Fuentes:</span><span>${escHtml(sourcesLabel)}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Cache:</span><span>${escHtml(cacheLabel)}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Ingredientes:</span><span>${ingLabel}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Nutrición:</span><span>${nutLabel}</span></div>`,
        d.confidenceNotes ? `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Notas:</span><span>${escHtml(d.confidenceNotes)}</span></div>` : '',
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">ID:</span><span>${escHtml(item.id)}</span></div>`
      ].filter(Boolean).join('');
      return `<div class="scan-card" data-id="${escHtml(item.id)}">
        <div class="scan-card-summary">
          <div class="scan-card-top">
            <span class="scan-card-date">${escHtml(fecha)}</span>
            <div class="scan-card-badges">${badges}</div>
          </div>
          ${bc ? `<a href="https://www.yomi.mx/scan.html?barcode=${encodeURIComponent(bc)}" target="_blank" rel="noopener" class="scan-card-barcode">${escHtml(bc)}</a>` : ''}
          ${d.productName ? `<div class="scan-card-name">${escHtml(d.productName)}</div>` : ''}
          <div class="scan-card-meta">${metaParts.map(p => `<span>${p}</span>`).join('')}</div>
        </div>
        <div class="scan-card-detail" hidden>${detailParts}
          <div class="scan-card-actions">
            <button class="btn-del" data-action="del" data-id="${escHtml(item.id)}">Eliminar</button>
          </div>
        </div>
      </div>`;
    }).join('');
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
        return i.id.includes(q) || (d.barcode||'').includes(q) || (d.ip||'').toLowerCase().includes(q) || (d.os||'').toLowerCase().includes(q) || (d.productName||'').toLowerCase().includes(q) || (d.cacheLevel||'').toLowerCase().includes(q) || (d.sourcesTried||[]).some(s => (s.source||'').toLowerCase().includes(q));
      }
      if (currentCol === 'reports') {
        const d = i.data || {};
        return (d.barcode||'').includes(q) || (d.category||'').toLowerCase().includes(q) || (d.comment||'').toLowerCase().includes(q);
      }
      return i.id.toLowerCase().includes(q);
    }) : allItems;
    const noun = currentCol === 'scan_logs' ? 'escaneo' : currentCol === 'reports' ? 'reporte' : 'documento';
    statsBar.textContent = items.length + ' ' + noun + (items.length !== 1 ? 's' : '') + (q ? ' (filtrado)' : '');
    if (currentCol === 'scan_logs') { renderLogs(items); return; }
    if (currentCol === 'reports') { renderReports(items); return; }
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
    // Toggle scan card expand/collapse
    const card = e.target.closest('.scan-card');
    if (card && !e.target.closest('[data-action]') && !e.target.closest('a')) {
      const detail = card.querySelector('.scan-card-detail');
      if (detail) detail.hidden = !detail.hidden;
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.dataset.action === 'view') {
      const item = allItems.find(i => i.id === id);
      if (!item) return;
      modalTitle.textContent = id;
      const d = item.data || {};
      const imgB64 = d.image;
      const dataWithoutImg = imgB64 ? { ...d, image: '[base64 image]' } : d;
      modalContent.textContent = JSON.stringify(dataWithoutImg, null, 2);
      let existingImg = modalOverlay.querySelector('.report-preview-img');
      if (existingImg) existingImg.remove();
      if (imgB64) {
        const img = document.createElement('img');
        img.className = 'report-preview-img';
        img.src = 'data:image/jpeg;base64,' + imgB64;
        img.style.cssText = 'max-width:100%;border-radius:6px;margin-top:12px;display:block;';
        modalOverlay.querySelector('.modal-body').appendChild(img);
      }
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
    } else if (btn.dataset.action === 'del-cache') {
      const type = btn.dataset.type;
      const key = btn.dataset.key;
      const layer = btn.dataset.layer;
      if (!confirm('¿Eliminar "' + key.substring(0, 40) + '" del cache?')) return;
      btn.disabled = true;
      btn.textContent = '…';
      const r = await apiFetch('/api/admin/cache-all/' + type + '/' + encodeURIComponent(key) + '?layer=' + layer, { method: 'DELETE' });
      if (r.ok) {
        loadCollection();
      } else {
        alert('Error al eliminar.');
        btn.disabled = false;
        btn.textContent = '✕';
      }
    } else if (btn.dataset.action === 'view-cache') {
      const key = btn.dataset.key;
      modalTitle.textContent = key;
      modalContent.textContent = key;
      modalOverlay.classList.add('open');
    }
  });

  modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });

  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  toolbarEl.style.display = 'none';
  checkLogin();
})();
