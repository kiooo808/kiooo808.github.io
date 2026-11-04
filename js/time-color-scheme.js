/* Choose a time-based default before Fluid paints; a manual choice lasts this visit. */
(function (scope) {
  'use strict';
  function themeForHour(hour) {
    return hour >= 6 && hour < 18 ? 'light' : 'dark';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { themeForHour };
  if (!scope.document) return;

  const root = scope.document.documentElement;
  const sessionKey = 'MyBlog_Visit_Color_Scheme';
  const fluidKey = 'Fluid_Color_Scheme';
  const automatic = themeForHour(new scope.Date().getHours());
  let manual;
  try { manual = scope.sessionStorage.getItem(sessionKey); } catch (_) {}
  const hasManual = manual === 'light' || manual === 'dark';
  root.setAttribute('data-default-color-scheme', automatic);
  root.setAttribute('data-user-color-scheme', hasManual ? manual : automatic);
  try {
    if (hasManual) scope.localStorage.setItem(fluidKey, manual);
    else scope.localStorage.removeItem(fluidKey);
  } catch (_) {}

  scope.document.addEventListener('click', function (event) {
    if (!event.target.closest('#color-toggle-btn, #mobile-color-toggle-btn')) return;
    scope.queueMicrotask(function () {
      const scheme = root.getAttribute('data-user-color-scheme');
      if (scheme === 'light' || scheme === 'dark') {
        try { scope.sessionStorage.setItem(sessionKey, scheme); } catch (_) {}
      }
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
