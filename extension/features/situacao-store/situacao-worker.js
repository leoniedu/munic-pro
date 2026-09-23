// Service worker: the owner of the live history database.
//
// It runs on the extension's own origin, so the database it opens is the
// one the options page sees too — one history for every portal host, and
// one that survives clearing the portal's site data (the F5 login-loop
// fix). Content scripts cannot open it themselves: their IndexedDB is the
// portal's. situacao-bridge.js forwards every request here with
// chrome.runtime.sendMessage, which needs no manifest permission.
//
// A module worker, loading the shared code with static imports: the
// classic worker's script loader is on the network gate's banned list.
//
// This directory is storage-sanctioned by scripts/check-network.sh and
// must never touch the network.
import './situacao-diff.js';
import './situacao-db.js';

const DB = globalThis.__municProSituacaoDb.criarDb(indexedDB);

// mergeSnapshot is here for the bridge's one-time migration; the bridge
// does not expose it to the page.
const METHODS = {
  saveSnapshot: DB.saveSnapshot,
  getCurrent: DB.getCurrent,
  getAll: DB.getAll,
  getRuns: DB.getRuns,
  clearAll: DB.clearAll,
  mergeSnapshot: DB.mergeSnapshot,
  getPref: DB.getPref,
  setPref: DB.setPref,
};

function handleMessage(msg, sender, sendResponse) {
  if (!msg || msg.municPro !== 'db') return false;
  const fn = METHODS[msg.method];
  if (typeof fn !== 'function') {
    sendResponse({ error: `Método desconhecido: ${msg.method}` });
    return false;
  }
  Promise.resolve()
    .then(() => fn(...(msg.args || [])))
    .then((result) => sendResponse({ result }))
    .catch((err) => sendResponse({ error: String((err && err.message) || err) }));
  // Keeps the channel open for the async reply.
  return true;
}

chrome.runtime.onMessage.addListener(handleMessage);

globalThis.__municProSituacaoWorker = { handleMessage, METHODS };
