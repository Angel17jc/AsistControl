/* global window, document */
// Applies the appearance chosen in "Mi cuenta" before the page paints, so a dark choice does
// not flash white and the default (light, the brand's white) does not flash dark.
// Kept in sync with src/lib/theme.ts, which owns the preference afterwards. Served as-is (not
// bundled), so it stays plain browser JavaScript.
(function () {
  var preference = 'light';
  try {
    preference = window.localStorage.getItem('asistcontrol.theme') || 'light';
  } catch {
    // Storage blocked: the default is fine.
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
