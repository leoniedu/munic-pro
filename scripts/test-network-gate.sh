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

cleanup() {
  for f in $TMPDIR_FILES; do
    git rm -q --cached --ignore-unmatch "$f" 2>/dev/null || true
    rm -f "$f"
  done
}
trap cleanup EXIT

fixture() {
  path="$1"; content="$2"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" > "$path"
  TMPDIR_FILES="$TMPDIR_FILES $path"
  # Staged, not merely written: the gate's working-tree scan reads
  # `git ls-files` so that gitignored scratch cannot fail it, which means
  # an untracked fixture is invisible to the very check it exercises.
  git add -f "$path" 2>/dev/null || true
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

fixture extension/features/situacao-export/zz-gate-test.js \
  "const x = '<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">';"
expect_pass "an Office Open XML namespace URI (an identifier, never fetched)"

fixture extension/features/situacao-export/zz-gate-test.js \
  "const x = '<a xmlns=\"http://schemas.openxmlformats.org/x\"/>' + 'https://example.com/y';"
expect_fail "a real URL on the same line as an OOXML namespace"

fixture extension/features/situacao-export/zz-gate-test.js \
  "const u = 'http://schemas.openxmlformats.org.evil.com/x';"
expect_fail "a host that only starts like the OOXML namespace"

fixture extension/features/situacao-store/zz-gate-test.js \
  "fetch('/x');"
expect_fail "fetch() inside the storage-sanctioned directory"

fixture extension/features/situacao-report/zz-gate-test.js \
  "indexedDB.open('x');"
expect_fail "storage API outside the storage-sanctioned directory"

# situacao-store/ now holds both the ISOLATED-world bridge (owns
# indexedDB) and the MAIN-world client (postMessage only). The directory
# stays sanctioned as a whole, so a new file dropped into it — named like
# the real bridge or not — must still be allowed to use indexedDB.
fixture extension/features/situacao-store/zz-gate-bridge-test.js \
  "indexedDB.open('munic-pro', 1);"
expect_pass "indexedDB in a new file inside the storage-sanctioned directory (ISOLATED-world bridge)"

# The MAIN-world client must never regress into calling indexedDB
# directly — the whole point of the split is that MAIN-world code opens
# a database on the PAGE's origin, not the extension's. This gate cannot
# tell MAIN-world files apart from ISOLATED-world ones within the same
# sanctioned directory (that guarantee lives in a source-shape test in
# tests/situacao-store.test.js instead), but it must still catch
# indexedDB used OUTSIDE the sanctioned directory altogether — e.g. if a
# MAIN-world report or fetch file grew a direct call.
fixture extension/features/situacao-report/zz-gate-main-regression-test.js \
  "async function bad() { return indexedDB.open('munic-pro', 1); }"
expect_fail "indexedDB called from a MAIN-world (non-storage) directory"

# The options page (extension/options/) renders the Status/Backup/Import/
# Clear UI but must never open the browser's structured-storage database
# itself -- that stays confined to situacao-store/, same as MAIN-world
# content-script code. This is the same "storage API outside a
# storage-sanctioned directory" rule, exercised against the new directory
# specifically, so a future change to STORAGE_DIRS that dropped it is
# caught here rather than only in code review.
fixture extension/options/zz-gate-test.js \
  "indexedDB.open('munic-pro', 1);"
expect_fail "storage API used directly from the options page's own directory"

# The options page's storage logic instead lives inside the already
# storage-sanctioned situacao-store/ directory (situacao-options-store.js),
# alongside the ISOLATED-world bridge. A new file dropped there must still
# be allowed to open the database, regardless of which of the two doors
# (content-script bridge or options page) it serves.
fixture extension/features/situacao-store/zz-gate-options-test.js \
  "indexedDB.open('munic-pro', 1);"
expect_pass "indexedDB in a new file inside the storage-sanctioned directory (options-page store)"

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
