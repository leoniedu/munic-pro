# Deferred minors — for final-review triage

None of these blocked a task review. The final whole-branch review decides
which, if any, must be fixed before this is usable. No findings were parked
(no breaker tripped; every task's review closed clean or after one fix round).

1. **T1** `fetchViaGateway`'s URL dedup via `[...new Set(...)]` collapses to a
   single URL on the direct (intranet) host, so the "fallback" degenerates to a
   one-URL retry loop. Correct, but the intent would read clearer with a comment.
2. **T1** `mountWidget`'s single MutationObserver watches `document.body` with
   `{childList, subtree}` and re-ticks all mounts on any DOM mutation anywhere.
   Chatty on a busy page; this extension has exactly one mount.
3. **T3** No test for an `agencia_nome`-only change (`municipio_nome` is covered;
   same code path, same `VALUE_FIELDS` exclusion list).
4. **T3** `toClose` accumulates in two phases (changed keys, then vanished keys).
   No test produces closes from both phases in one call, so cross-phase ordering
   is untested. Not a current defect.
5. **T4** No `nChanged` assertion for the closes-only case (a vanished key with
   no other change); that test checks `getCurrent()` but not the counters.
6. **T5** No `buildBody` test for a non-numeric or undefined UF.
7. **T6** `weekColumns` compares `run_ts` with `String(a) > String(b)`. Correct
   for the ISO-8601 strings the contract specifies, but would silently misbehave
   if a `Date` object ever leaked in.
8. **T6** The 1000-iteration guard in `weekColumns` silently truncates histories
   beyond ~19 years, with no error or warning and no test; documented only in an
   inline comment.
9. **T6** `municipioGrid` has no test with more than one município.
10. **T7** `stateChangeCsv` tests mix `.trim().split('\r\n')` and
    `.split('\r\n')[0]` to extract data vs header lines. Works; inconsistent.

## Controller note on a systemic fragility

`scripts/check-network.sh` matches banned API names as plain text, with no
awareness of comments or string literals. Three consequences seen during
execution:

- The plan's own Task 4 comment contained the literal `fetch(` and would have
  failed the commit the plan mandates. Reworded (T4).
- `situacao-store.js:96` contains the word "fetch" in prose ("Applies one fetch
  to the store") and passes only because it lacks the open paren.
- Every task dispatch after T4 had to carry an explicit warning not to write
  `fetch(` or `new XMLHttpRequest` in a comment.

The gate is doing its job — it is a deliberate tripwire, not a parser — but its
comment-blindness is a maintenance trap worth a note in the repo, or a
refactor to strip comments before matching.
