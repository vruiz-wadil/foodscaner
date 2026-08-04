// analytics.js — Vercel Analytics + Speed Insights (sitio estático, sin bundler)
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

(function loadScript(src) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  document.head.appendChild(s);
})('/_vercel/insights/script.js');

(function loadScript(src) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  document.head.appendChild(s);
})('/_vercel/speed-insights/script.js');

window.track = function (eventName, props) {
  window.va('event', { name: eventName, data: props || {} });
};
