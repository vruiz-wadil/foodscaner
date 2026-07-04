# Reportes Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `renderReports` from a table to expandable cards, matching the interaction pattern already used by `renderLogs` (scan_logs) — the admin panel's other "review and moderate" tab.

**Architecture:** Single-function rewrite reusing existing `.list-card`/`.scan-card` CSS classes (zero new CSS). The shared `docList` click handler already toggles `.scan-card` expand/collapse and handles `data-action="del"` generically by reading `currentCol` — no changes needed there, only the new markup shape activates it.

**Tech Stack:** Vanilla JS, no new dependencies.

## Global Constraints

- Zero new CSS — reuse `.list-card`, `.scan-card`, `.scan-card-summary`, `.scan-card-top`, `.scan-card-date`, `.scan-card-badges`, `.scan-card-barcode`, `.scan-card-name`, `.scan-card-meta`, `.scan-card-detail`, `.scan-card-detail-row`, `.scan-card-detail-label`, `.scan-card-actions`, `.log-badge`/`.log-badge-blue` exactly as they exist today.
- The `data-action="view"` button is removed from report cards — the expanded detail (including the image, shown inline) fully replaces what the modal used to show for this tab. The modal itself (`#modal-overlay`) is untouched and remains in use by other tabs (`products_ocr`, `products_nutrition`, cache AI entries).
- No changes to `admin/admin.js`'s `docList` click handler or to `TAB_CONFIG` — both already work correctly with the new card markup as-is.
- No new automated tests — matches the spec's stated approach (UI rewrite reusing already-tested interaction patterns from the scan_logs redesign; verification is manual + full-suite regression).

---

### Task 1: Rewrite `renderReports` as expandable cards

**Files:**
- Modify: `admin/admin.js` (`renderReports` function)

**Interfaces:**
- Consumes: `item.data` fields already produced by `/api/report` — `ts`, `barcode`, `productName`, `category`, `comment`, `image` (optional base64 string), `os`, `ip`, `ua`, `country`, `region`, `city`. No new backend fields required.
- Produces: no new exported interface — `renderReports(items)` keeps its existing signature, called from `TAB_CONFIG.reports.render` (unchanged).

- [ ] **Step 1: Replace `renderReports` in `admin/admin.js`**

Find the current function:

```js
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
    docList.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Fecha/Hora</th><th>Código</th><th>Categoría</th><th>Comentario</th><th>Sistema</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }
```

Replace it entirely with:

```js
  function renderReports(items) {
    if (!items.length) { docList.innerHTML = '<div class="empty-msg">Sin reportes todavía.</div>'; return; }
    docList.innerHTML = items.map(item => {
      const d = item.data || {};
      const fecha = d.ts ? new Date(d.ts).toLocaleString('es-MX') : '—';
      const loc = [d.city, d.region, d.country].filter(Boolean).join(', ') || '—';
      const bc = d.barcode || '';
      const badges = d.image ? '<span class="log-badge log-badge-blue">📷 Imagen</span>' : '';
      const metaParts = [
        `📍 ${escHtml(loc)}`,
        `🖥 ${escHtml(d.os || '—')}`,
        d.category ? `🏷 ${escHtml(d.category)}` : ''
      ].filter(Boolean);
      const imgHtml = d.image
        ? `<img src="data:image/jpeg;base64,${d.image}" style="max-width:100%;border-radius:6px;margin-top:8px;display:block;">`
        : '';
      const detailParts = [
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">Comentario:</span><span>${escHtml(d.comment || '—')}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">IP:</span><span>${escHtml(d.ip || '—')}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">User-Agent:</span><span>${escHtml(d.ua || '—')}</span></div>`,
        `<div class="scan-card-detail-row"><span class="scan-card-detail-label">ID:</span><span>${escHtml(item.id)}</span></div>`
      ].join('') + imgHtml;
      return `<div class="list-card scan-card" data-id="${escHtml(item.id)}">
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
```

- [ ] **Step 2: Verify syntax**

Run: `node --check admin/admin.js`
Expected: no output, exit code 0

- [ ] **Step 3: Manual verification**

Confirm a server is running (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/` should return `200`; if not, start one with `node api/index.js`). Open `http://localhost:3000/admin/`, log in, go to **Reportes**.

1. Confirm the tab renders cards (not a table), visually matching the style of the **Logs** tab's cards.
2. Confirm no "Ver" button appears anywhere in this tab.
3. Click a card that has an attached image (`d.image` present, indicated by the 📷 badge); confirm it expands to show the comment, IP, User-Agent, ID, and the image inline (not in a modal).
4. Click a card without an image; confirm it expands with no leftover empty space where the image would have gone.
5. Click the same card again to confirm it collapses.
6. Click "Eliminar" on one card; confirm the delete flow still works (confirmation dialog, removal from the list) exactly as it did before this change.
7. Switch to **Logs** and back to **Reportes**; confirm the filter (`FILTER_PLACEHOLDERS.reports`, unchanged by this task) and the list still behave correctly after the tab switch.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests remain green (no new tests added per Global Constraints)

- [ ] **Step 5: Commit**

```bash
git add admin/admin.js
git commit -m "feat: redesign Reportes as expandable cards, matching scan_logs pattern"
```

---

### Task 2: Deploy

**Files:**
- None new.

- [ ] **Step 1: Push**

```bash
git push origin master
```

- [ ] **Step 2: Deploy production**

```bash
vercel --prod
```

- [ ] **Step 3: Verify in production**

Repeat Task 1 Step 3's manual checks against `https://www.yomi.mx/admin/` with real production data — including at least one report that has an attached image, if one exists, to confirm the inline image preview renders correctly.
