// MUNIC-PRO shared runtime: F5 gateway URL construction, CSV building,
// file download, ISO-week formatting. Loaded before all feature scripts
// (MAIN world), so every feature sees window.__municPro.
//
// Deliberately a copy of sigc-pro's equivalents rather than a shared
// package: the two extensions ship independently and have no build step,
// and a shared dependency would buy less than it costs. Divergence is
// expected and fine.
(function () {
  'use strict';

  if (window.__municPro) return;

  function normalizeLabel(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // F5 BIG-IP URL-rewriting prefix ("/f5-w-<hex>$$"); the hex decodes to
  // the real backend origin. null on the direct host (intranet/VPN),
  // which is how the same code serves both routes with no configuration.
  function f5Prefix(pathname) {
    const m = /^\/f5-w-([0-9a-f]+)\$\$/.exec(String(pathname || ''));
    return m ? { prefix: m[0], hex: m[1] } : null;
  }

  // simple=true: plain prefixed path. simple=false: the fuller shape
  // captured from live 2026 traffic (an f5-h-$$ segment inserted after
  // the first path segment, plus F5_origin/F5CH). On the direct host
  // both modes collapse to origin+path.
  //
  // Built by string concatenation, never via URLSearchParams: the "$$"
  // in the F5 segments gets percent-escaped by a query-param builder,
  // and the gateway then 404s.
  //
  // The separator is "?" when the path has no query string and "&" when
  // it does. sigc-pro hardcodes ";" because its only caller's path
  // always carries "?slug=...", where ";" reads as a separator inside
  // the existing query. MUNIC's paths are bare, so ";" there would make
  // F5_origin part of the path segment and 404.
  function gatewayUrl(origin, pathname, path, simple) {
    const f5 = f5Prefix(pathname);
    if (!f5) return `${origin}${path}`;
    if (simple) return `${origin}${f5.prefix}${path}`;
    const firstSeg = String(path).split('/')[1] || '';
    const sep = String(path).includes('?') ? '&' : '?';
    return `${origin}${f5.prefix}/${firstSeg}/f5-h-$$${path}` +
      `${sep}F5_origin=${f5.hex}&F5CH=I`;
  }

  // Which form the live gateway needs isn't knowable in advance, so try
  // the simple prefixed URL first and fall back to the full captured one.
  async function fetchViaGateway(path, options) {
    const urls = [...new Set([
      gatewayUrl(location.origin, location.pathname, path, true),
      gatewayUrl(location.origin, location.pathname, path, false),
    ])];
    let lastErr = new Error('sem resposta');
    for (const url of urls) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function escapeCsvField(v) {
    v = String(v ?? '');
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  // pt-BR Excel expects `;`-delimited CSV (comma is the decimal separator
  // in that locale, so comma-delimited CSVs misparse on import).
  function buildCsv(header, rows) {
    const lines = [header, ...rows].map((r) => r.map(escapeCsvField).join(';'));
    return lines.join('\r\n') + '\r\n';
  }

  function downloadFile(filename, text, mimeType, opts) {
    // UTF-8 BOM so Excel doesn't mangle accented CSVs; pass
    // { bom: false } for formats that declare their own encoding (JSON).
    const bom = !(opts && opts.bom === false);
    const blob = new Blob([bom ? '﻿' + text : text], {
      type: mimeType || 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // A zone-less ISO string in LOCAL time. toISOString() would convert to
  // UTC, and stripping the Z then makes every consumer re-parse it as
  // local — shifting evening runs in a negative-offset zone onto the next
  // day, and with them the ISO week the report buckets by.
  function localTimestamp(now) {
    const d = now || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function timestampSlug() {
    const now = new Date();
    return {
      data: now.toISOString().slice(0, 10),
      hora: now.toTimeString().slice(0, 8).replace(/:/g, ''),
    };
  }

  // ISO-8601 week: weeks start Monday, and a week belongs to the year
  // containing its Thursday. Used for the Município tab's columns (one
  // per week, last run of that week), so it has to agree with what a
  // human would call "week 39" — hence Thursday-anchored rather than a
  // naive day-of-year division.
  function isoWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    // Shift to the Thursday of this ISO week. getDay() is 0 for Sunday,
    // so map Sunday to 7 first.
    const day = d.getDay() || 7;
    d.setDate(d.getDate() + 4 - day);
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const week = Math.ceil(((d - jan1) / 86400000 + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  // Keeps a widget present next to a page element. SIGC re-renders its
  // filter area, which silently removes a plainly-inserted button, so a
  // one-shot insert at document_idle does not survive.
  //
  // insert:'after' puts the widget as the anchor's NEXT SIBLING — for
  // anchoring beside a button such as Filtrar, where appending into the
  // anchor's parent would land after unrelated trailing siblings.
  // insert:'append' (default) puts it inside the anchor.
  //
  // Copied from sigc-pro's equivalent, minus its multi-feature context
  // cache: MUNIC-PRO has one mount.
  const mounts = [];
  let mountObserver = null;

  function tickMount(m) {
    // try/catch per mount: a broken mount must never break the others.
    try {
      const existing = document.getElementById(m.id);
      const anchorEl = m.anchor();
      const ok = anchorEl && (!m.when || m.when());
      if (ok && !existing) {
        if (m.insert === 'after') anchorEl.insertAdjacentElement('afterend', m.build());
        else anchorEl.appendChild(m.build());
      } else if (!ok && existing) {
        existing.remove();
      }
    } catch (err) {
      console.error('[munic-pro] mount failed', err);
    }
  }

  function tickAllMounts() {
    for (const m of mounts) tickMount(m);
  }

  function mountWidget(spec) {
    mounts.push(spec);
    tickMount(spec);
    if (!mountObserver) {
      mountObserver = new MutationObserver(tickAllMounts);
      mountObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.__municPro = {
    normalizeLabel,
    f5Prefix,
    gatewayUrl,
    fetchViaGateway,
    buildCsv,
    downloadFile,
    timestampSlug,
    localTimestamp,
    isoWeek,
    mountWidget,
  };
})();
