/**
 * `node:path` for a realm bundle: the alias target, not the implementation.
 *
 * The code moved to `packages/host-capabilities/src/path-realm.ts` with ADR-0079 — path arithmetic is not a
 * host operation, but it is host-shaped (the granted filesystem keys a node's plan rows on this `join`), so it
 * lives beside the capability surface it feeds rather than being written twice. This file stays as the alias
 * target for bundled npm dependencies and the packages that still import the builtin directly.
 *
 * The import is **relative on purpose**: the bundle build aliases the bare specifier
 * `@xiranite/host-capabilities` to that package's `src/realm.ts`, and esbuild applies an alias to any path
 * that starts with it followed by `/` — so `@xiranite/host-capabilities/path-realm` would become
 * `.../src/realm.ts/path-realm` and fail with "not a directory" (measured: every path-using node's bundle
 * then stopped building). A relative specifier cannot be rewritten by that rule.
 */
import * as pathRealm from "../../host-capabilities/src/path-realm.js"

export * from "../../host-capabilities/src/path-realm.js"
export default pathRealm
