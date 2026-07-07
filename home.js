// Yomi Home Screen — Figma Redesign branch

function getHistory() {
  try { return JSON.parse(localStorage.getItem('yomi_history')) || []; } catch { return []; }
}

function placeholderSvg() {
  return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>');
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
    return `<img class="product-card-img" src="${item.image}" alt="" onerror="this.onerror=null;this.src='${placeholderSvg()}'">`;
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
    </div>
  `).join('');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Navigate to scanner
function goScan() { window.location.href = 'scan.html?scan=1'; }

// One-time count-up on the "3M+" stat card when it scrolls into view. Purely
// decorative — falls back to the static "3M+" already in the HTML if
// IntersectionObserver is unavailable or the element never intersects.
function animateProductsCount() {
  const el = document.getElementById('stat-products-count');
  if (!el || typeof IntersectionObserver === 'undefined') return;
  const target = 3;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      let n = 0;
      const step = () => {
        n++;
        el.textContent = n + 'M+';
        if (n < target) setTimeout(step, 150);
      };
      el.textContent = '0M+';
      setTimeout(step, 150);
    });
  }, { threshold: 0.4 });
  observer.observe(el);
}

document.addEventListener('DOMContentLoaded', () => {
  renderGrid();
  animateProductsCount();

  document.getElementById('btn-scan').addEventListener('click', goScan);
  document.getElementById('nav-scan').addEventListener('click', goScan);

  // Product card click → scan that barcode
  document.getElementById('products-grid').addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });

  // Same navigation via keyboard (cards are role="button" tabindex="0")
  document.getElementById('products-grid').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.product-card');
    if (!card) return;
    e.preventDefault();
    window.location.href = 'scan.html?barcode=' + encodeURIComponent(card.dataset.barcode);
  });
});
