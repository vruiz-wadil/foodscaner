import { onAuthChange, getCachedProfile } from './authClient.js';

export function firstNameOf(profile) {
  const displayName = profile && profile.profile && profile.profile.displayName;
  if (displayName && displayName.trim()) return displayName.trim().split(/\s+/)[0];
  const email = profile && profile.email;
  if (email && email.includes('@')) return email.split('@')[0];
  return 'Cuenta';
}

export function computeBadgeState(profile) {
  if (!profile) {
    return { label: 'Hazte Premium', href: 'premium-offer.html', variant: 'cta' };
  }
  if (profile.membershipStatus === 'active') {
    return { label: firstNameOf(profile), href: 'account.html', variant: 'premium' };
  }
  return { label: 'Hazte Premium', href: 'onboarding-membership.html', variant: 'cta' };
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Un solo path de corona — outline (fill="none") en los estados CTA, relleno
// (fill="currentColor") en el estado Premium. Mismo ícono, dos estados, para
// que el CTA nunca parezca que el usuario ya es miembro.
function crownSvg(filled) {
  const fill = filled ? 'currentColor' : 'none';
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 18h20l-2-9-5 4-3-7-3 7-5-4-2 9z"/></svg>`;
}

export function renderBadge(el, profile) {
  const state = computeBadgeState(profile);
  el.href = state.href;
  el.className = `header-badge ${state.variant}`;
  const icon = crownSvg(state.variant === 'premium');
  const tag = state.variant === 'premium' ? '<span class="header-badge-tag">Premium</span>' : '';
  el.innerHTML = `${icon}<span>${escapeHtml(state.label)}</span>${tag}`;
}

export function mountHeaderBadge() {
  const el = document.getElementById('header-badge');
  if (!el) return;

  function update() {
    renderBadge(el, getCachedProfile());
  }

  update();
  onAuthChange(() => update());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountHeaderBadge);
  } else {
    mountHeaderBadge();
  }
}
