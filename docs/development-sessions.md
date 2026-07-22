# Managed Development Sessions

`bun run dev`, `bun run dev:desktop`, and `bun run dev:desktop:deno` are managed development sessions. Multiple agents may run them in the same checkout at the same time.

## Startup path and speed

`bun run dev` / `xr` is not just Vite:

1. generate node registries
2. incremental package build / up-to-date checks (~50 packages)
3. start backend
4. start Vite
5. mark frontend ready when the document entry is openable

**React.lazy does not speed steps 1–4.** It only delays browser loading of view/module chunks *after* the server is up. The previous gap was that `App` still eagerly imported `WorkspaceLayout`, and the layout still eagerly imported `CardView` / Melodeck / overlays, so first open still paid a large static graph.

Warm iteration shortcuts:

- `bun run dev:quick` or `xr quick` — skip registry + package rebuild, start backend + Vite only (use when packages are already built)
- `bun run dev:lean` / `dev:quick:lean` — disable React Compiler in Vite for lower transform cost
- Keep `.cache/vite/managed`; avoid `dev:clean` unless deps are broken

Browser readiness probes only `/` + `/src/main.tsx`. Desktop attach still waits for the fuller shell graph including `@wailsio_runtime`.

## Addressing

- `FRONTEND_DEVSERVER_URL` selects an explicit frontend URL when a caller needs a known endpoint. The port must be free; XR refuses to start rather than binding elsewhere while HMR still points at the busy URL.
- Otherwise the launcher starts at `127.0.0.1:5173` and selects the next available port. The selected URL is printed as `[xiranite-frontend]` and is the only browser URL for that session.
- Vite HMR stays on the same HTTP port as the document server. A mismatched HMR port opens a websocket-only listener that answers normal page GETs with `426`/`404`.
- A session writes its backend configuration to `public/.well-known/xiranite/backend-<frontend-port>.json`, and records `frontendUrl` in `.cache/xiranite-dev-session.json` so `dev:stop` / `dev:reboot` can free that port.
- The browser reads the manifest matching `window.location.port`, so concurrent sessions do not share backend URLs or tokens.
- When the document entry is openable the supervisor also prints `[xiranite-frontend:ready]`.

Ports are transport addresses, not cache or session identities. Do not infer another session's backend from a frontend port; use the URL printed by that session or set `FRONTEND_DEVSERVER_URL` explicitly.

## Vite Dependency Cache

All managed sessions use `.cache/vite/managed`, independent of their frontend port. Vite validates the cache with its lockfile and dependency-optimization configuration hashes. A second agent on another port therefore reuses the completed dependency prebundle instead of rebuilding it.

The first session after a lockfile or Vite dependency configuration change must build the cache. Wait for `[xiranite-frontend:ready]` before browsing or rebooting; interrupting a cold prebundle leaves `deps_temp_*` directories and the next start has to rebuild again. Managed launchers clear abandoned `deps_temp_*` trees on start. While the first prebundle runs, do not run `dev:clean` or start another cache-repair workflow from a different agent. `dev:clean`, `dev:desktop:clean`, and `dev:vite:clean` delete the shared optimize-deps cache and must be coordinated with all active managed sessions.

## Stopping A Session

Use `bun run dev:stop` for the active managed session recorded in `.cache/xiranite-dev-session.json`. For an independently managed agent session, stop the owning supervisor rather than deleting its manifest or shared cache manually.
