#!/bin/sh
# Self-test for check-network.sh: proves the gate still fails on each class
# of violation it exists to catch, and still passes on legitimate code.
#
# Run by the pre-commit hook whenever the gate or this file changes — a gate
# that silently stopped detecting anything would be worse than no gate, since
# "network gate: CLEAN" would then be a false assurance.
set -e
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
GATE="$ROOT/scripts/check-network.sh"
TMPDIR_FILES=""

cleanup() { for f in $TMPDIR_FILES; do rm -f "$f"; done; }
trap cleanup EXIT

fixture() {
  path="$1"; content="$2"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" > "$path"
  TMPDIR_FILES="$TMPDIR_FILES $path"
}

expect_fail() {
  desc="$1"
  if "$GATE" >/dev/null 2>&1; then
    echo "GATE SELF-TEST FAILED — gate passed but should have caught: $desc" >&2
    exit 1
  fi
  echo "  ok — caught: $desc"
  cleanup
  TMPDIR_FILES=""
}

expect_pass() {
  desc="$1"
  if ! "$GATE" >/dev/null 2>&1; then
    echo "GATE SELF-TEST FAILED — gate rejected legitimate code: $desc" >&2
    "$GATE" >&2 || true
    exit 1
  fi
  echo "  ok — allowed: $desc"
  cleanup
  TMPDIR_FILES=""
}

echo "network gate self-test:"

# Baseline: the real tree must be clean, or every result below is meaningless.
expect_pass "the working tree as committed"

fixture extension/features/situacao-fetch/zz-gate-test.js \
  "const u = 'https://example.com/x';"
expect_fail "absolute URL in a fetch-sanctioned directory"

fixture extension/features/situacao-report/zz-gate-test.js \
  "fetch('/x');"
expect_fail "fetch() outside a fetch-sanctioned directory"

fixture extension/features/situacao-store/zz-gate-test.js \
  "fetch('/x');"
expect_fail "fetch() inside the storage-sanctioned directory"

fixture extension/features/situacao-report/zz-gate-test.js \
  "indexedDB.open('x');"
expect_fail "storage API outside the storage-sanctioned directory"

fixture extension/common/zz-gate-test.js \
  "navigator.sendBeacon('/x');"
expect_fail "sendBeacon anywhere in extension/"

fixture extension/common/zz-gate-test.js \
  "new WebSocket('/x');"
expect_fail "WebSocket anywhere in extension/"

fixture extension/common/zz-gate-test.js \
  "eval('x');"
expect_fail "eval anywhere in extension/"

fixture extension/features/situacao-fetch/zz-gate-test.js \
  "fetch('/Relatorio/x', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });"
expect_pass "same-origin fetch with the XMLHttpRequest header, in a sanctioned directory"

fixture extension/features/situacao-store/zz-gate-test.js \
  "indexedDB.open('munic-pro', 1);"
expect_pass "indexedDB in the storage-sanctioned directory"

# Built at runtime, not written as a literal in this file's own source —
# otherwise this very script would trip the gate it is testing.
STORE_HOST_A=$(printf '%s' 'chromewebstoreXgoogleXcomZdetailZabc' | tr XZ ./)
fixture docs/zz-gate-test.html \
  "<a href='https://${STORE_HOST_A}'>install</a>"
expect_fail "unlisted Chrome Web Store URL (chromewebstore host) anywhere in repo"

STORE_HOST_B=$(printf '%s' 'chromeXgoogleXcomZwebstoreZdetailZabc' | tr XZ ./)
fixture README-zz-gate-test.md \
  "See https://${STORE_HOST_B}"
expect_fail "unlisted Chrome Web Store URL (chrome.google.com/webstore host) anywhere in repo"

echo "network gate self-test: PASS"
