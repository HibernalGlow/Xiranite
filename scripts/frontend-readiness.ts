const DEFAULT_ATTEMPTS = 1_200
const DEFAULT_DELAY_MS = 100
const DEFAULT_STABILITY_DELAY_MS = 500

export const FRONTEND_READINESS_PATHS = [
  "/",
  "/src/main.tsx",
  "/src/components/workspace/WorkspaceLayout.tsx",
  "/node_modules/.vite/deps/@wailsio_runtime.js",
] as const

export interface FrontendReadinessOptions {
  attempts?: number
  delayMs?: number
  stabilityDelayMs?: number
  fetcher?: typeof fetch
  sleep?: (milliseconds: number) => Promise<unknown>
}

export async function waitForFrontendReady(
  frontendUrl: string,
  options: FrontendReadinessOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const stabilityDelayMs = options.stabilityDelayMs ?? DEFAULT_STABILITY_DELAY_MS
  const fetcher = options.fetcher ?? fetch
  const sleep = options.sleep ?? Bun.sleep

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probeFrontend(frontendUrl, fetcher)) {
      await sleep(stabilityDelayMs)
      if (await probeFrontend(frontendUrl, fetcher)) return
    }

    await sleep(delayMs)
  }

  throw new Error(`Timed out waiting for the rendered frontend module graph: ${frontendUrl}`)
}

async function probeFrontend(frontendUrl: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const responses = await Promise.all(FRONTEND_READINESS_PATHS.map((path) => (
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
