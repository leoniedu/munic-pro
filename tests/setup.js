import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// bun test runs in UTC unless TZ is set, but the extension formats local
// time for colleagues in Brazil, and the local-vs-UTC tests pin the clock
// to an instant where the two disagree on the date. Pinned here so the
// suite means the same thing on every machine.
process.env.TZ = 'America/Sao_Paulo';

// happy-dom has no IndexedDB. fake-indexeddb is a real, spec-compliant
// implementation, so the store tests exercise actual transactions and
// index lookups rather than a hand-rolled stub that could agree with a
// broken implementation.
import 'fake-indexeddb/auto';
