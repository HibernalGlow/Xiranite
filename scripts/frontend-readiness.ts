const DEFAULT_ATTEMPTS = 1_200
const DEFAULT_DELAY_MS = 100
const DEFAULT_STABILITY_DELAY_MS = 300

/** Enough to open the SPA document and start the browser entry. */
export const FRONTEND_LISTEN_PATHS = [
  "/",
  "/src/main.tsx",
] as const

/**
 * Full application shell used by desktop attach flows. Browser `dev` should not
 * wait for this: WorkspaceLayout/CardView/Melodeck transforms are large and are
 * better done on first navigation after the server is already openable.
 */
export const FRONTEND_SHELL_PATHS = [
  "/",
  "/src/main.tsx",
  "/src/components/workspace/WorkspaceLayout.tsx",
  "/node_modules/.vite/deps/@wailsio_runtime.js",
] as const

/** @deprecated Prefer FRONTEND_LISTEN_PATHS or FRONTEND_SHELL_PATHS. */
export const FRONTEND_READINESS_PATHS = FRONTEND_LISTEN_PATHS

export type FrontendReadinessMode = "listen" | "shell"
/** @deprecated Prefer mode: "listen" | "shell". */
export type FrontendReadinessProfile = "listen" | "browser" | "desktop" | "shell"

export interface FrontendReadinessOptions {
  attempts?: number
  delayMs?: number
  stabilityDelayMs?: number
  /** Preferred selector: listen = openable document; shell = desktop attach graph. */
  mode?: FrontendReadinessMode
  /** Back-compat alias used by existing launchers. */
  profile?: FrontendReadinessProfile
  paths?: readonly string[]
  fetcher?: typeof fetch
  sleep?: (milliseconds: number) => Promise<unknown>
  /** Optional epoch ms used to report supervisor/session age in logs. */
  sinceMs?: number
}

export interface FrontendReadinessResult {
  frontendUrl: string
  mode: FrontendReadinessMode
  paths: readonly string[]
  /** Successful probe rounds that returned ready (including stability re-check). */
  probesSucceeded: number
  /** Total loop iterations until ready (1-based). */
  attemptsUsed: number
  /** Wall time spent inside waitForFrontendReady. */
  durationMs: number
  stabilityDelayMs: number
  /** Time since `sinceMs` if provided (e.g. supervisor start). */
  sinceStartMs?: number
}

export async function waitForFrontendReady(
  frontendUrl: string,
  options: FrontendReadinessOptions = {},
): Promise<FrontendReadinessResult> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const stabilityDelayMs = options.stabilityDelayMs ?? DEFAULT_STABILITY_DELAY_MS
  const mode = resolveReadinessMode(options)
  const paths = options.paths ?? (mode === "shell" ? FRONTEND_SHELL_PATHS : FRONTEND_LISTEN_PATHS)
  const fetcher = options.fetcher ?? fetch
  const sleep = options.sleep ?? Bun.sleep
  const startedAt = Date.now()

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probeFrontend(frontendUrl, paths, fetcher)) {
      await sleep(stabilityDelayMs)
      if (await probeFrontend(frontendUrl, paths, fetcher)) {
        const durationMs = Date.now() - startedAt
        return {
          frontendUrl,
          mode,
          paths,
          probesSucceeded: 2,
          attemptsUsed: attempt + 1,
          durationMs,
          stabilityDelayMs,
          sinceStartMs: options.sinceMs === undefined ? undefined : Date.now() - options.sinceMs,
        }
      }
    }

    await sleep(delayMs)
  }

  const durationMs = Date.now() - startedAt
  const since = options.sinceMs === undefined ? "" : `, since-start=${Date.now() - options.sinceMs}ms`
  throw new Error(
    `Timed out waiting for the frontend (${mode}) after ${durationMs}ms`
      + ` (${attempts} attempts, paths=${paths.join(",")}${since}): ${frontendUrl}`,
  )
}

/** One-line log for supervisors / TUI after a successful probe. */
export function formatFrontendReadyLog(result: FrontendReadinessResult): string {
  const parts = [
    `[xiranite-frontend:ready] ${result.frontendUrl}`,
    `probe=${result.durationMs}ms`,
    `attempts=${result.attemptsUsed}`,
    `mode=${result.mode}`,
    `paths=${result.paths.join(",")}`,
  ]
  if (result.sinceStartMs !== undefined) parts.push(`since-start=${result.sinceStartMs}ms`)
  return parts.join(" ")
}

export function formatFrontendWaitLog(frontendUrl: string, options: FrontendReadinessOptions = {}): string {
  const mode = resolveReadinessMode(options)
  const paths = options.paths ?? (mode === "shell" ? FRONTEND_SHELL_PATHS : FRONTEND_LISTEN_PATHS)
  return `[xiranite-frontend:wait] ${frontendUrl} mode=${mode} paths=${paths.join(",")}`
}

function resolveReadinessMode(options: FrontendReadinessOptions): FrontendReadinessMode {
  if (options.mode) return options.mode
  if (options.profile === "desktop" || options.profile === "shell") return "shell"
  return "listen"
}

async function probeFrontend(
  frontendUrl: string,
  paths: readonly string[],
  fetcher: typeof fetch,
): Promise<boolean> {
  try {
    const responses = await Promise.all(paths.map((path) => (
      fetcher(new URL(path, frontendUrl), { method: path === "/" ? "HEAD" : "GET" })
    )))
    const ready = responses.every((response) => response.ok)
    await Promise.all(responses.map((response) => response.body?.cancel()))
    return ready
  } catch {
    // Vite is not listening yet or is still transforming the application shell.
    return false
  }
}
