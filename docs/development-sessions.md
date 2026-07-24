# Managed Development Sessions

`bun run dev`, `bun run dev:desktop`, and `bun run dev:desktop:deno` are managed development sessions. The default session owns the fixed application URL `http://127.0.0.1:5173`; additional sessions must explicitly set another `XIRANITE_FRONTEND_PORT` or `FRONTEND_DEVSERVER_URL`.

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
- `bun run dev:lean` / `dev:quick:lean` — keep the development Compiler off and cap the Vite heap
- Keep `.cache/vite/managed`; avoid `dev:clean` unless deps are broken

Ordinary `vite serve` always disables React Compiler, even if `XIRANITE_REACT_COMPILER_MODE` is inherited. Production builds default to `infer`; only the dedicated compiler benchmark enables the diagnostic development override.

Browser readiness probes only `/` + `/src/main.tsx`. Desktop attach still waits for the fuller shell graph including `@wailsio_runtime`.
Vite must keep the configured non-runtime watcher ignores: `ref`, generated caches/artifacts, temporary trees, migration fixtures, and examples contain hundreds of thousands of files but are not HMR inputs.

## Addressing

- `FRONTEND_DEVSERVER_URL` selects an explicit frontend URL when a caller needs a known endpoint. The port must be free; XR refuses to start rather than binding elsewhere while HMR still points at the busy URL.
- Otherwise the launcher uses `127.0.0.1:5173` with strict port ownership. If it is occupied, startup fails instead of silently changing the application URL. Parallel sessions opt into another explicit port.
- Vite HMR stays on the same HTTP port as the document server. A mismatched HMR port opens a websocket-only listener that answers normal page GETs with `426`/`404`.
- Vite is the session gateway: the browser uses the frontend origin for API, Reader images, media ranges, and local files. It never receives the Bun listener URL.
- The supervisor writes the current internal Bun target to `.cache/backend-gateway/target-<frontend-port>.json`. Only Vite reads this file; it is not served from `public` and is atomically replaced after a backend restart.
- A managed session keeps one token and one public origin across backend restarts. `/health` returns a backend `instanceId`, so the frontend can recreate backend-owned sessions without treating a port as instance identity.
- The selected `frontendUrl` remains recorded in `.cache/xiranite-dev-session.json` so `dev:stop` / `dev:reboot` can free the explicitly owned port.
- When the document entry is openable the supervisor also prints `[xiranite-frontend:ready]`.

Ports are transport addresses, not backend instance identities. Use the fixed gateway URL printed by the session; backend replacement is identified by `/health.instanceId`.

## Backend source reloads

The development supervisor watches `packages/nodes/neoview/src` because backend source modules are loaded directly in development. It ignores tests and frontend-only entries, fingerprints file metadata to collapse duplicate Windows `fs.watch` events, and restarts only after a short debounce. Restarts are serialized: the old listener and repository close before the next backend starts, so two instances do not contend for the same SQLite/config files. Closing the watcher also invalidates in-flight file metadata callbacks, debounce timers, and queued follow-up restarts; a stopped supervisor cannot start another backend after shutdown. The fixed Vite gateway URL and token do not change when this internal backend is replaced.

Packaged Wails builds do not run this watcher. Wails starts the Bun child once per application launch and exposes the stable `https://wails.localhost` gateway; the only in-process restart path is the explicit runtime setting/API command. On Windows, Wails contains the Bun shim and the real Bun process in a `KILL_ON_JOB_CLOSE` Job Object, so a normal shutdown, crash, or forced host termination reclaims the complete backend process tree and its listener instead of leaving an orphan for the next launch.

## Vite Dependency Cache

All managed sessions use `.cache/vite/managed`, independent of their frontend port. Vite validates the cache with its lockfile and dependency-optimization configuration hashes. A second agent on another port therefore reuses the completed dependency prebundle instead of rebuilding it.

The first session after a lockfile or Vite dependency configuration change must build the cache. Wait for `[xiranite-frontend:ready]` before browsing or rebooting; interrupting a cold prebundle leaves `deps_temp_*` directories and the next start has to rebuild again. Managed launchers clear abandoned `deps_temp_*` trees on start. While the first prebundle runs, do not run `dev:clean` or start another cache-repair workflow from a different agent. `dev:clean`, `dev:desktop:clean`, and `dev:vite:clean` delete the shared optimize-deps cache and must be coordinated with all active managed sessions.

## Stopping A Session

Use `bun run dev:stop` for the active managed session recorded in `.cache/xiranite-dev-session.json`. For an independently managed agent session, stop the owning supervisor rather than deleting its manifest or shared cache manually.
