# Managed Development Sessions

`bun run dev`, `bun run dev:desktop`, and `bun run dev:desktop:deno` are managed development sessions. Multiple agents may run them in the same checkout at the same time.

## Addressing

- `FRONTEND_DEVSERVER_URL` selects an explicit frontend URL when a caller needs a known endpoint.
- Otherwise the launcher starts at `127.0.0.1:5173` and selects the next available port. The selected URL is printed as `[xiranite-frontend]` and is the only browser URL for that session.
- A session writes its backend configuration to `public/.well-known/xiranite/backend-<frontend-port>.json`.
- The browser reads the manifest matching `window.location.port`, so concurrent sessions do not share backend URLs or tokens.

Ports are transport addresses, not cache or session identities. Do not infer another session's backend from a frontend port; use the URL printed by that session or set `FRONTEND_DEVSERVER_URL` explicitly.

## Vite Dependency Cache

All managed sessions use `.cache/vite/managed`, independent of their frontend port. Vite validates the cache with its lockfile and dependency-optimization configuration hashes. A second agent on another port therefore reuses the completed dependency prebundle instead of rebuilding it.

The first session after a lockfile or Vite dependency configuration change must build the cache. While that happens, do not run `dev:clean` or start another cache-repair workflow from a different agent. `dev:clean`, `dev:desktop:clean`, and `dev:vite:clean` delete the shared optimize-deps cache and must be coordinated with all active managed sessions.

## Stopping A Session

Use `bun run dev:stop` for the active managed session recorded in `.cache/xiranite-dev-session.json`. For an independently managed agent session, stop the owning supervisor rather than deleting its manifest or shared cache manually.
