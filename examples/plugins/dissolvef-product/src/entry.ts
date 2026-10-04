/**
 * The remote's `./entry` expose: the repository's own dissolvef entry, re-exported untouched.
 *
 * The one thing this module does besides re-exporting is initialise **its own copy** of i18n. The
 * node's labels come from `tNode`/`useNodeI18n` over `@/i18n`, and a remote bundles its own copy of
 * that module: without this line the node renders with empty titles (measured: the collapsed view's
 * title span was empty and i18next logged "you will need to pass in an i18next instance").
 *
 * Where that belongs long-term is the shared-singleton list in `docs/plugin-architecture.md` §2.3 —
 * `@/i18n` has to be an MF `shared` entry offered by the host, so host and plugin read one language
 * state. Until the host registers it, initialising the remote's copy is the smallest fix that makes the
 * node legible, and it is why this example is marked "internal node as remote" rather than "external
 * plugin": a third-party plugin has no access to `@/i18n` at all and would ship its own strings.
 */

import { initI18n } from "@/i18n"

// Deliberately **not** awaited: as a top-level `await` this module stops being synchronously
// evaluatable, and in a backgrounded tab `initI18n` never settles, so the host would sit on the
// Suspense skeleton forever (measured). Firing it and letting `useTranslation` re-render when the
// instance initialises keeps the entry a plain module while still producing real labels.
void initI18n()

export { default } from "@/nodes/dissolvef/entry"
