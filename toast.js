let toastTimeout = null;

export function showToast(message, duration = 2500) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    el.classList.remove('visible');
  }, duration);
}

const PENDING_TOAST_KEY = 'yomi_pending_toast';

export function setPendingToast(message) {
  sessionStorage.setItem(PENDING_TOAST_KEY, message);
}

export function showPendingToast() {
  const message = sessionStorage.getItem(PENDING_TOAST_KEY);
  if (!message) return;
  sessionStorage.removeItem(PENDING_TOAST_KEY);
  showToast(message);
}
