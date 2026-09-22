import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// happy-dom has no IndexedDB. fake-indexeddb is a real, spec-compliant
// implementation, so the store tests exercise actual transactions and
// index lookups rather than a hand-rolled stub that could agree with a
// broken implementation.
import 'fake-indexeddb/auto';
