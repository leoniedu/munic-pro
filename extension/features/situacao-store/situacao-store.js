// MAIN-world client for the situação history.
//
// The actual IndexedDB lives in the extension's own origin, owned by the
// ISOLATED-world situacao-bridge.js — this file runs in the MAIN world
// (alongside the page's own scripts) and never touches indexedDB itself.
// Every call here is a request/reply pair carried on a shared DOM
// attribute (document.documentElement.dataset), answered by the bridge.
//
// Why not window.postMessage: this portal is served through F5 BIG-IP
// APM's JavaScript rewriting layer (cache-fm-Modern.js), which wraps the
// page's own globals (F5_Invoke_addEventListener, F5_Invoke_setTimeout,
// ...). MAIN-world code runs inside that rewritten environment; the
// ISOLATED world does not. Live on this exact portal, a postMessage sent
// from here was never observed by the ISOLATED listener — every call
// timed out with "storage layer unavailable", confirmed via the console
// stack trace pointing at the rewriter. sigc-pro documents the same class
// of failure for a CustomEvent between the two worlds (see
// ultimo-movimento-map-relay.js) and fixed it by moving the handoff onto
// the DOM, which both worlds share regardless of the rewriter. This file
// does the same for the full request/response RPC.
//
// Concurrency: the request/reply attributes are each a SINGLE slot, so
// two requests in flight at once would clobber each other. Rather than
// keying the slot by request id (which would need array/object bookkeeping
// on both ends for a case that barely occurs), calls are queued here: at
// most one request is ever on the wire, and the next one is only written
// once the previous reply has arrived. The panel's own calls are already
// sequential (await chains), so the only real risk was a stray
// double-click firing two independent call chains — the queue serialises
// those too, at the cost of the second chain waiting slightly longer.
//
// Why not on the bridge side: only the ISOLATED end can safely order
// writes to the reply attribute; queueing has to happen wherever requests
// are minted, i.e. here.
//
// This directory is storage-sanctioned by scripts/check-network.sh and
// must never touch the network — no fetching of any kind belongs here.
// (This file itself now holds no storage API call at all — see
// situacao-bridge.js, which is the actual storage-sanctioned code.)
(function () {
  'use strict';

  if (window.__municProSituacaoStore) return;

  const ATTR_REQ = 'data-munic-pro-req';
  const ATTR_REPLY = 'data-munic-pro-reply';

  let nextId = 1;
  // At most one entry: the id/resolve/reject of the request currently on
  // the wire. Anything queued behind it waits in `queue` instead.
  let inFlight = null;
  const queue = [];

  // How long a call may wait for the ISOLATED side before giving up. The
  // bridge script loads at document_start and should always be listening
  // well before this MAIN-world script's document_idle features can call
  // it — this guards against that assumption being wrong, rather than
  // hanging a button click forever.
  const CALL_TIMEOUT_MS = 10000;

  // Distinguishes "the bridge script never even loaded" (documentElement
  // has neither of its attributes touched, ever) from "it loaded but this
  // one call is slow/stuck" — cheap to track because the reply attribute
  // is written by ANY completed call, not just the current one.
  let everSawReply = false;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      const raw = document.documentElement.getAttribute(ATTR_REPLY);
      if (!raw) continue;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      everSawReply = true;
      if (!inFlight || msg.id !== inFlight.id) continue; // stale/foreign reply
      const { resolve, reject } = inFlight;
      inFlight = null;
      document.documentElement.removeAttribute(ATTR_REPLY);
      if ('error' in msg) reject(new Error(msg.error));
      else resolve(msg.result);
      pump();
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ATTR_REPLY],
  });

  function pump() {
    if (inFlight || queue.length === 0) return;
    const next = queue.shift();
    inFlight = next;
    const timer = setTimeout(() => {
      if (!inFlight || inFlight.id !== next.id) return;
      inFlight = null;
      const reason = everSawReply
        ? 'A extensão não respondeu a tempo (camada de armazenamento ' +
          'ocupada ou travada).'
        : 'A extensão não respondeu (camada de armazenamento indisponível).';
      next.reject(new Error(
        `${reason} Recarregue a página; se persistir, recarregue a ` +
        'extensão em chrome://extensions.',
      ));
      pump();
    }, CALL_TIMEOUT_MS);
    next.clearTimer = () => clearTimeout(timer);
    document.documentElement.setAttribute(
      ATTR_REQ,
      JSON.stringify({ id: next.id, method: next.method, args: next.args }),
    );
  }

  function call(method, ...args) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const entry = {
        id,
        method,
        args,
        resolve: (v) => { entry.clearTimer(); resolve(v); },
        reject: (e) => { entry.clearTimer(); reject(e); },
        clearTimer: () => {},
      };
      queue.push(entry);
      pump();
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
