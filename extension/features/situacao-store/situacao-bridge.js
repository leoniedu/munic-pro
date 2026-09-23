// ISOLATED-world relay between the page and the history database.
//
// The report runs in the MAIN world (situacao-report.js reads the page's
// own jQuery/DataTables, situacao-fetch.js reuses the page's
// authenticated session), which has no chrome.runtime. This script runs
// in the ISOLATED world, which does, and relays each request to
// situacao-worker.js — the service worker that owns the database on the
// extension's own origin.
//
// Content scripts cannot own that database themselves: in both worlds,
// IndexedDB belongs to the PORTAL's origin. Earlier versions did open it
// here, on the assumption that this was the extension's origin; the
// result was one silently diverging history per portal host, an options
// page that saw none of them, and a history erased by clearing the
// portal's site data (the standard fix for an F5 login loop).
// migrarLegado() below moves any such history over, once.
//
// Why not postMessage: this portal is served through F5 BIG-IP APM's
// JavaScript rewriting layer (cache-fm-Modern.js), which wraps the page's
// own globals — F5_Invoke_addEventListener, F5_Invoke_setTimeout, etc.
// MAIN-world scripts run inside that rewritten environment; the ISOLATED
// world does not. A postMessage/addEventListener('message') round trip
// between the two does not reliably survive it — confirmed live on this
// exact portal (the MAIN side timed out on every call, "storage layer
// unavailable"). sigc-pro hit the same class of problem for a MAIN<->
// ISOLATED handoff (see ultimo-movimento-map-relay.js) and its fix was to
// use the DOM instead of an event: both worlds share `document`, and a
// DOM attribute has no delivery race the way postMessage does. This file
// applies the same fix to a full request/response RPC.
//
// This directory is storage-sanctioned by scripts/check-network.sh and
// must never touch the network — no fetching of any kind belongs here.
(function () {
  'use strict';

  if (window.__municProSituacaoBridge) return;

  // Transport contract with situacao-store.js (MAIN world), carried on
  // document.documentElement's attributes rather than postMessage:
  //   request attribute (municProReq):  JSON { id, method, args }
  //   reply attribute   (municProReply): JSON { id, result } or { id, error }
  //
  // Each attribute is a SINGLE slot holding the CURRENT in-flight
  // request/reply. situacao-store.js is responsible for not clobbering a
  // slot that already holds an unanswered request — see its own comment
  // for how it serialises calls to guarantee that.
  const ATTR_REQ = 'data-munic-pro-req';
  const ATTR_REPLY = 'data-munic-pro-reply';

  const { criarDb, apagarBanco, DB_NAME } = globalThis.__municProSituacaoDb;

  // One request to situacao-worker.js, which owns the database.
  function viaWorker(method, args) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ municPro: 'db', method, args }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) { reject(new Error(err.message)); return; }
        if (!resp) { reject(new Error('o service worker não respondeu.')); return; }
        if ('error' in resp) reject(new Error(resp.error));
        else resolve(resp.result);
      });
    });
  }

  // Moves a history earlier versions kept on the PORTAL's origin into the
  // extension's, then deletes the old copy. Those versions opened
  // IndexedDB here, in the content script, believing it to be the
  // extension's origin; it was the portal's — so each portal host held
  // its own history, the options page saw none of it, and clearing site
  // data erased it.
  //
  // The old database is deleted only after the merge succeeded: a failure
  // leaves it in place to be retried by the next request. The merge is
  // idempotent (natural keys), so a retry after a partial failure cannot
  // duplicate rows.
  async function migrarLegado(factory) {
    if (typeof factory.databases === 'function') {
      const dbs = await factory.databases();
      if (!dbs.some((d) => d.name === DB_NAME)) return { migrated: false };
    }
    const legado = criarDb(factory);
    const [rows, runs] = await Promise.all([legado.getAll(), legado.getRuns()]);
    let result = null;
    if (rows.length || runs.length) {
      result = await viaWorker('mergeSnapshot', [{ rows, runs }]);
    }
    await apagarBanco(factory);
    return { migrated: true, result };
  }

  // Every request waits for this, so the first save of a session can never
  // race the merge (it would open rows the merge then collides with).
  //
  // Started by the first request, not at load: this script loads on every
  // page of three whole hosts, and off the report page it must open no
  // database at all (the Web Store host-permission justification says
  // so). Requests come only from the report page. The portal-origin
  // factory is whatever this content script sees as indexedDB.
  let pronto = null;
  function migrado() {
    if (!pronto) {
      pronto = migrarLegado(indexedDB).catch((err) => {
        pronto = null; // retried by the next request
        console.warn('[munic-pro] migração do histórico antigo falhou; ' +
          'será tentada de novo:', err);
      });
    }
    return pronto;
  }

  // The methods the page may call. mergeSnapshot is deliberately absent:
  // only the migration above uses it.
  const METHOD_NAMES = [
    'saveSnapshot', 'getCurrent', 'getAll', 'getRuns', 'clearAll',
    'getPref', 'setPref',
  ];
  const METHODS = Object.fromEntries(METHOD_NAMES.map((name) =>
    [name, async (...args) => { await migrado(); return viaWorker(name, args); }]));

  function writeReply(payload) {
    document.documentElement.setAttribute(ATTR_REPLY, JSON.stringify(payload));
  }

  function handleRequest(msg) {
    // Cleared as soon as it's read, not after the reply is written: this
    // is what lets the NEXT request use the exact same JSON (e.g. the
    // same no-arg method called twice in a row) and still produce a DOM
    // mutation — setAttribute() with an unchanged value is a no-op and
    // fires no MutationObserver callback, so the slot must go through an
    // absent state in between.
    document.documentElement.removeAttribute(ATTR_REQ);

    const { id, method, args } = msg;
    const fn = METHODS[method];
    if (typeof fn !== 'function') {
      writeReply({ id, error: `Método desconhecido: ${method}` });
      return;
    }

    Promise.resolve()
      .then(() => fn(...(args || [])))
      .then((result) => writeReply({ id, result }))
      .catch((err) => {
        writeReply({ id, error: String((err && err.message) || err) });
      });
  }

  // A MutationObserver on documentElement's attributes, filtered to the
  // one request attribute, rather than a 'message' listener: both worlds
  // share the DOM, so this fires regardless of whatever the page's F5
  // rewriter does to window-level events. MutationObserver callbacks are
  // microtask-queued by the spec, not synchronous with the attribute
  // write, so this never assumes the reaction happens inside the same
  // tick as situacao-store.js's write.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      const raw = document.documentElement.getAttribute(ATTR_REQ);
      if (!raw) continue; // cleared already, or another attribute's mutation
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue; // not one of ours / malformed — ignore rather than throw
      }
      handleRequest(msg);
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ATTR_REQ],
  });

  // Exposed for tests: the relayed methods, and the migration so it can be
  // run against a seeded portal-origin database.
  window.__municProSituacaoBridge = {
    ...METHODS, migrarLegado, ATTR_REQ, ATTR_REPLY,
  };
})();
