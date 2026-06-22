// Yomi Home Screen — Figma Redesign branch

function getHistory() {
  try { return JSON.parse(localStorage.getItem('yomi_history')) || []; } catch { return []; }
}

function badgeHtml(rating) {
  if (!rating) return '';
  const r = String(rating).toLowerCase();
  if (r === 'sano' || r === 'saludable' || r.includes('recomendar'))
    return '<span class="badge badge-sano">SANO</span>';
  if (r === 'evitar' || r.includes('evitar') || r.includes('no recom'))
    return '<span class="badge badge-evitar">EVITAR</span>';
  if (r === 'regular' || r.includes('modera') || r.includes('limitar'))
    return '<span class="badge badge-regular">REGULAR</span>';
  return '';
}

function imgHtml(item) {
  if (item.image) {
    return `<img class="product-card-img" src="${item.image}" alt="" onerror="this.replaceWith(document.querySelector('#img-placeholder-tpl').content.cloneNode(true))">`;
  }
  return `<div class="product-card-img-placeholder">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0d3d35" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  </div>`;
}

function renderGrid() {
  const grid   = document.getElementById('products-grid');
  const empty  = document.getElementById('products-empty');
  const history = getHistory();

  if (!history.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = history.slice(0, 4).map(item => `
    <div class="product-card" data-barcode="${item.barcode}" role="button" tabindex="0">
      ${imgHtml(item)}
      <div class="product-card-body">
        <p class="product-card-name">${escHtml(item.name || item.barcode)}</p>
        <p class="product-card-brand">${escHtml(item.brand || '')}</p>
        <div class="product-card-badge-row">
          ${badgeHtml(item.rating)}
        </div>
      </div>
      <button class="product-card-bookmark" aria-label="Guardar">+</button>
    </div>
  `).join('');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Navigate to scanner
function goScan() { window.location.href = 'scan.html?scan=1'; }

document.addEventListener('DOMContentLoaded', () => {
  renderGrid();

  document.getElementById('btn-scan').addEventListener('click', goScan);
  document.getElementById('nav-scan').addEventListener('click', goScan);

  // Product card click → scan that barcode
  document.getElementById('products-grid').addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    if (e.target.closest('.product-card-bookmark')) return; // ignore bookmark tap
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });
});
