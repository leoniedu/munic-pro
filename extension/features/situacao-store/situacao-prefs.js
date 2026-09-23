// Display preferences for the report panel — today only the list of
// hidden column names.
//
// Kept in the page's localStorage, not in the IndexedDB history: it is a
// view setting, not data, so losing it when the colleague clears site
// data (the F5 login-loop fix) costs one re-hide, and each of the three
// matched hosts keeping its own list is harmless. Routing it through the
// bridge would need a DB version bump for no real gain.
//
// Lives in this directory because scripts/check-network.sh sanctions
// storage APIs here and nowhere else. Every access is guarded: storage
// can throw (disabled, quota, sandboxed frame), and a failed read must
// leave every column visible rather than break the panel.
(function () {
  'use strict';

  if (window.__municProPrefs) return;

  const KEY_OCULTAS = 'munic-pro:colunas-ocultas';

  function getColunasOcultas() {
    try {
      const v = JSON.parse(window.localStorage.getItem(KEY_OCULTAS) || '[]');
      return Array.isArray(v) ? v.map(String) : [];
    } catch (err) {
      return [];
    }
  }

  function setColunasOcultas(nomes) {
    try {
      window.localStorage.setItem(KEY_OCULTAS, JSON.stringify(nomes));
    } catch (err) {
      console.warn('[munic-pro] não foi possível salvar as colunas ocultas:', err);
    }
  }

  window.__municProPrefs = { getColunasOcultas, setColunasOcultas, KEY_OCULTAS };
})();
