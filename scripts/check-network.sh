#!/bin/sh
# MUNIC-PRO network gate: extension code may talk ONLY to SIGC's own origin,
# and only via relative URLs. With --staged, checks the content being
# committed (used by the pre-commit hook); otherwise checks the working tree.
#
# This is a heuristic tripwire, not a proof. The hard guarantees remain the
# absence of host_permissions in manifest.json and code review of extension/.
#
# Deliberately NOT a copy of sigc-pro's check-privacy.sh. That gate bans
# storage outright, because sigc-pro stores nothing; here the collection
# history IS the product, so IndexedDB is sanctioned by design. What carries
# over is the part that still applies: nothing may leave the SIGC origin.
#
# Sanctioned directories:
#   - extension/common/                   : fetch(), relative URLs only
#   - extension/features/situacao-fetch/  : fetch(), relative URLs only
#   - extension/features/situacao-store/  : indexedDB only, no network at all
#   - extension/features/situacao-export/ : Blob/download only, no network
#
# Also runs a repo-wide (not just extension/) check that no unlisted Chrome
# Web Store URL is ever committed — see the bottom of this script.
FETCH_DIRS='extension/common extension/features/situacao-fetch'
STORAGE_DIRS='extension/features/situacao-store'

# Banned everywhere in extension/: anything that can move bytes off-origin or
# execute arbitrary code. fetch() is banned outside FETCH_DIRS; indexedDB is
# banned outside STORAGE_DIRS.
#
# XMLHttpRequest is matched only as `new XMLHttpRequest` (real usage), never
# as a bare identifier — "X-Requested-With: XMLHttpRequest" is a required
# request header here, and it is a string literal, not a call.
EXFIL='sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|new[[:space:]]+XMLHttpRequest|new Image|import\(|eval\(|new Function'
NET='fetch\(|["'\'']fetch["'\'']'
STORE='indexedDB|chrome\.storage|localStorage|sessionStorage'
URL_PATTERN='https?://'

# Every request must be relative to location.origin, so an absolute URL
# anywhere in extension/ is a failure — there is no allowlist. MUNIC-PRO
# vendors no third-party libraries and loads no external resources (no map
# tiles, unlike sigc-pro); if that ever changes, this is the line to revisit.
# manifest.json is excluded from every sweep: content_scripts.matches MUST
# carry absolute URLs (they are host match patterns, not requests), and the
# manifest declares permissions rather than calling APIs. It is reviewed by
# eye — it is the one file where a permission can be added, so a gate that
# silently tolerated changes there would be the wrong guarantee anyway.
SKIP_MANIFEST='extension/manifest.json'

if [ "$1" = "--staged" ]; then
  grep_all() { git grep --cached -nE "$1" -- extension/ ":!$SKIP_MANIFEST" 2>/dev/null; }
  grep_out() {
    ex=":!$SKIP_MANIFEST"
    for d in $2; do ex="$ex ':!$d'"; done
    eval git grep --cached -nE "\"$1\"" -- extension/ $ex 2>/dev/null
  }
  grep_in() { git grep --cached -nE "$1" -- $2 2>/dev/null; }
else
  grep_all() { grep -rnE "$1" extension/ 2>/dev/null | grep -v "^$SKIP_MANIFEST:"; }
  grep_out() {
    pat=$(echo "$2" | tr ' ' '|')
    grep -rnE "$1" extension/ 2>/dev/null | grep -v "^$SKIP_MANIFEST:" | grep -vE "^($pat)/"
  }
  grep_in() { for d in $2; do grep -rnE "$1" "$d/" 2>/dev/null; done; }
fi

fail() {
  echo "NETWORK GATE FAILED — $1" >&2
  echo "$2" >&2
  exit 1
}

M=$(grep_all "$EXFIL")
[ -n "$(echo "$M" | tr -d '[:space:]')" ] && \
  fail "exfiltration / code-execution API in extension/:" "$M"

M=$(grep_all "$URL_PATTERN")
[ -n "$(echo "$M" | tr -d '[:space:]')" ] && \
  fail "absolute URL in extension/ (requests must be relative to location.origin):" "$M"

M=$(grep_out "$NET" "$FETCH_DIRS")
[ -n "$(echo "$M" | tr -d '[:space:]')" ] && \
  fail "fetch() outside a fetch-sanctioned directory ($FETCH_DIRS):" "$M"

M=$(grep_out "$STORE" "$STORAGE_DIRS")
[ -n "$(echo "$M" | tr -d '[:space:]')" ] && \
  fail "storage API outside a storage-sanctioned directory ($STORAGE_DIRS):" "$M"

M=$(grep_in "$NET" "$STORAGE_DIRS")
[ -n "$(echo "$M" | tr -d '[:space:]')" ] && \
  fail "fetch() in a storage-sanctioned directory (it must never touch the network):" "$M"

# Unlisted-distribution gate: the Chrome Web Store item is unlisted, so its
# URL must never land in this public repo (docs, README, Pages, anywhere) —
# publishing the link would effectively de-unlist it. Checked repo-wide, not
# just extension/.
STORE_PATTERN='chromewebstore\.google\.com/detail|chrome\.google\.com/webstore/detail'
if [ "$1" = "--staged" ]; then
  STORE_MATCHES=$(git grep --cached -nE "$STORE_PATTERN" -- . 2>/dev/null)
else
  STORE_MATCHES=$(grep -rnE "$STORE_PATTERN" . 2>/dev/null)
fi
[ -n "$STORE_MATCHES" ] && \
  fail "unlisted Chrome Web Store URL found in repo:" "$STORE_MATCHES"

echo "network gate: CLEAN"
