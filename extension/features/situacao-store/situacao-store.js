// MAIN-world client for the situação history.
//
// The actual IndexedDB lives in the extension's own origin, owned by the
// ISOLATED-world situacao-bridge.js — this file runs in the MAIN world
// (alongside the page's own scripts) and never touches indexedDB itself.
// Every call here is a window.postMessage request answered by the bridge.
//
// Why the split exists: indexedDB.open() from the MAIN world opens a
// database on the PAGE's origin, not the extension's. The manifest matches
// three hosts, so that used to mean up to three separate, silently
// diverging histories — and clearing site data for the page (the standard
// fix for an F5 login loop) destroyed the history along with it. Routing
// every call through the ISOLATED world keeps the data in the extension's
// own origin, one history, regardless of which matched host is open.
//
// This directory is storage-sanctioned by scripts/check-network.sh and
// must never touch the network — no fetching of any kind belongs here.
// (This file itself now holds no storage API call at all — see
// situacao-bridge.js, which is the actual storage-sanctioned code.)
(function () {
  'use strict';

  if (window.__municProSituacaoStore) return;

  const SOURCE_MAIN = 'munic-pro-main';
  const SOURCE_ISOLATED = 'munic-pro-isolated';

  let nextId = 1;
  const pending = new Map();

  window.addEventListener('message', (event) => {
    // Same-origin only: a legitimate reply comes from this same page's
    // ISOLATED-world content script, which always posts to location.origin.
    if (event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== SOURCE_ISOLATED) return;
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    if ('error' in msg) waiting.reject(new Error(msg.error));
    else waiting.resolve(msg.result);
  });

  // How long a call may wait for the ISOLATED side before giving up. The
  // bridge script loads at document_start and should always be listening
  // well before this MAIN-world script's document_idle features can call
  // it — this guards against that assumption being wrong, rather than
  // hanging a button click forever.
  const CALL_TIMEOUT_MS = 10000;

  function call(method, ...args) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(
          'A extensão não respondeu (camada de armazenamento indisponível).',
        ));
      }, CALL_TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      window.postMessage({ source: SOURCE_MAIN, id, method, args }, location.origin);
    });
  }

  function saveSnapshot(rows, runTs, warnings) {
    return call('saveSnapshot', rows, runTs, warnings);
  }

  function getCurrent() {
    return call('getCurrent');
  }

  function getAll() {
    return call('getAll');
  }

  function getRuns() {
    return call('getRuns');
  }

  function clearAll() {
    return call('clearAll');
  }

  window.__municProSituacaoStore = {
    saveSnapshot,
    getCurrent,
    getAll,
    getRuns,
    clearAll,
  };
})();
