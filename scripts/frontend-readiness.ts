const DEFAULT_ATTEMPTS = 1_200
const DEFAULT_DELAY_MS = 100
const DEFAULT_STABILITY_DELAY_MS = 300

/**
 * Browser "you can open the tab now" probe.
 * Dynamic React.lazy does not help this: readiness used to GET WorkspaceLayout
 * and the Wails runtime, which forces a large transform/prebundle before the
 * supervisor prints ready — even though index.html was already servable.
 */
export const FRONTEND_LISTEN_PATHS = ["/"] as const

/** Source entry is available (browser shell can start loading modules). */
export const FRONTEND_SHELL_PATHS = [
  "/",
  "/src/main.tsx",
] as const

/** Desktop attach needs the Wails runtime prebundle as well. */
export const FRONTEND_DESKTOP_PATHS = [
  "/",
  "/src/main.tsx",
  "/node_modules/.vite/deps/@wailsio_runtime.js",
] as const

/** @deprecated Prefer FRONTEND_SHELL_PATHS / profile option. */
export const FRONTEND_READINESS_PATHS = FRONTEND_SHELL_PATHS

export type FrontendReadinessProfile = "listen" | "shell" | "desktop"

export interface FrontendReadinessOptions {
  attempts?: number
  delayMs?: number
  stabilityDelayMs?: number
  profile?: FrontendReadinessProfile
  paths?: readonly string[]
  fetcher?: typeof fetch
  sleep?: (milliseconds: number) => Promise<unknown>
}

export function pathsForReadinessProfile(profile: FrontendReadinessProfile = "shell"): readonly string[] {
  switch (profile) {
    case "listen":
      return FRONTEND_LISTEN_PATHS
    case "desktop":
      return FRONTEND_DESKTOP_PATHS
    case "shell":
    default:
      return FRONTEND_SHELL_PATHS
  }
}

export async function waitForFrontendReady(
  frontendUrl: string,
  options: FrontendReadinessOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const stabilityDelayMs = options.stabilityDelayMs ?? DEFAULT_STABILITY_DELAY_MS
  const paths = options.paths ?? pathsForReadinessProfile(options.profile ?? "shell")
  const fetcher = options.fetcher ?? fetch
  const sleep = options.sleep ?? Bun.sleep

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probeFrontend(frontendUrl, paths, fetcher)) {
      await sleep(stabilityDelayMs)
      if (await probeFrontend(frontendUrl, paths, fetcher)) return
    }

    await sleep(delayMs)
  }

  throw new Error(`Timed out waiting for the rendered frontend module graph: ${frontendUrl}`)
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
    const ready = responses.every((response, index) => isReadyResponse(paths[index]!, response))
    await Promise.all(responses.map((response) => response.body?.cancel()))
    return ready
  } catch {
    // Vite is not listening yet or is still transforming the application shell.
    return false
  }
}

function isReadyResponse(path: string, response: Response): boolean {
  if (!response.ok) return false
  if (path === "/") return true

  // SPA fallback serves index.html with 200 for missing modules. Treat that as
  // not ready so desktop/wails probes do not pass on HTML placeholders.
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.includes("text/html")) return false
  return contentType.includes("javascript")
    || contentType.includes("typescript")
    || contentType.includes("ecmascript")
    || contentType.includes("json")
    || contentType.length === 0
}
