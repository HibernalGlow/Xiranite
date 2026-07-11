import type { DesktopBackendConfig, DesktopBackendRestartResult } from "../bridge.ts"

interface BackendProcess {
  child: Deno.ChildProcess
  config: DesktopBackendConfig
}

export class BackendSupervisor {
  #process: BackendProcess | undefined
  #externalConfig: DesktopBackendConfig | undefined
  #stopping = false

  static async start(): Promise<BackendSupervisor> {
    const supervisor = new BackendSupervisor()
    await supervisor.#startInitial()
    return supervisor
  }

  get config(): DesktopBackendConfig | undefined {
    return this.#process?.config ?? this.#externalConfig
  }

  async restart(): Promise<DesktopBackendRestartResult> {
    if (this.#externalConfig || !this.#process) {
      return {
        restarted: false,
        supported: false,
        message: "The current local backend is not owned by the Deno Desktop shell.",
      }
    }

    const previous = this.#process
    const next = await startOwnedBackend()
    this.#process = next
    stopChild(previous.child)

    return {
      restarted: true,
      supported: true,
      message: "Local backend restarted by the Deno Desktop shell.",
      config: next.config,
    }
  }

  stop(): void {
    if (this.#stopping) return
    this.#stopping = true
    if (this.#process) stopChild(this.#process.child)
    this.#process = undefined
  }

  async #startInitial(): Promise<void> {
    const externalUrl = clean(Deno.env.get("XIRANITE_BACKEND_URL"))
    if (externalUrl) {
      this.#externalConfig = {
        baseUrl: externalUrl,
        token: clean(Deno.env.get("XIRANITE_BACKEND_TOKEN")),
      }
      return
    }

    // In attach mode the Bun supervisor owns the backend and exposes its
    // connection through the Vite dev manifest. The desktop shell should not
    // launch a duplicate service.
    if (clean(Deno.env.get("FRONTEND_DEVSERVER_URL"))) return

    this.#process = await startOwnedBackend()
  }
}

async function startOwnedBackend(): Promise<BackendProcess> {
  const command = await resolveBackendCommand()
  const child = new Deno.Command(command.executable, {
    args: command.args,
    cwd: command.cwd,
    env: command.env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    windowsRawArguments: false,
  }).spawn()

  void pipeText(child.stderr, "[xiranite-backend:stderr] ")

  try {
    const ready = await withTimeout(readReadyLine(child.stdout), 10_000, "Timed out waiting for Xiranite local backend")
    void pipeByteReader(ready.reader, ready.decoder, ready.remainder, "[xiranite-backend:stdout] ")
    const config = parseBackendConfig(ready.line)
    return { child, config }
  } catch (error) {
    stopChild(child)
    throw error
  }
}

interface BackendCommand {
  executable: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

async function resolveBackendCommand(): Promise<BackendCommand> {
  const explicitBinary = clean(Deno.env.get("XIRANITE_BACKEND_BIN"))
  if (explicitBinary) return { executable: explicitBinary, args: [] }

  const bun = clean(Deno.env.get("XIRANITE_BUN_BIN")) ?? (Deno.build.os === "windows" ? "bun.exe" : "bun")
  const explicitScript = clean(Deno.env.get("XIRANITE_BACKEND_JS"))
  if (explicitScript) return { executable: bun, args: [explicitScript] }

  const embeddedScript = await extractEmbeddedBackendScript()
  if (embeddedScript) return { executable: bun, args: [embeddedScript] }

  const source = new URL("../../packages/backend/src/index.ts", import.meta.url)
  if (await fileExists(source)) {
    return {
      executable: bun,
      args: [fileURLPath(source)],
      cwd: fileURLPath(new URL("../../", import.meta.url)),
    }
  }

  throw new Error("Could not find the Xiranite backend bundle. Run `bun run build:backend:deno` first.")
}

async function extractEmbeddedBackendScript(): Promise<string | undefined> {
  const source = new URL("../../build/deno/xiranite-backend.js", import.meta.url)
  let bytes: Uint8Array
  try {
    bytes = await Deno.readFile(source)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer))
  const suffix = Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")
  const cacheRoot = clean(Deno.env.get("XIRANITE_CACHE_DIR"))
    ?? clean(Deno.env.get("LOCALAPPDATA"))
    ?? clean(Deno.env.get("XDG_CACHE_HOME"))
    ?? clean(Deno.env.get("HOME"))
    ?? Deno.cwd()
  const runtimeDir = `${cacheRoot}/Xiranite/runtime`
  const target = `${runtimeDir}/xiranite-backend-${suffix}.js`

  if (!await fileExists(target)) {
    await Deno.mkdir(runtimeDir, { recursive: true })
    await Deno.writeFile(target, bytes)
  }
  return target
}

function parseBackendConfig(line: string): DesktopBackendConfig {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new Error(`Invalid Xiranite backend startup output: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== "object" || !("baseUrl" in value) || typeof value.baseUrl !== "string") {
    throw new Error("Xiranite local backend did not report a baseUrl.")
  }
  return {
    baseUrl: value.baseUrl,
    token: "token" in value && typeof value.token === "string" ? value.token : undefined,
  }
}

async function readReadyLine(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) throw new Error("Xiranite local backend exited before reporting readiness.")
    buffered += decoder.decode(value, { stream: true })
    const newline = buffered.indexOf("\n")
    if (newline >= 0) {
      return {
        line: buffered.slice(0, newline).trim(),
        remainder: buffered.slice(newline + 1),
        reader,
        decoder,
      }
    }
  }
}

async function pipeText(stream: ReadableStream<Uint8Array>, prefix: string): Promise<void> {
  await pipeByteReader(stream.getReader(), new TextDecoder(), "", prefix)
}

async function pipeByteReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  initial: string,
  prefix: string,
): Promise<void> {
  let buffered = initial
  try {
    while (true) {
      const newline = buffered.indexOf("\n")
      if (newline >= 0) {
        logLine(prefix, buffered.slice(0, newline))
        buffered = buffered.slice(newline + 1)
        continue
      }
      const { value, done } = await reader.read()
      if (done) {
        buffered += decoder.decode()
        break
      }
      buffered += decoder.decode(value, { stream: true })
    }
    logLine(prefix, buffered)
  } catch (error) {
    if (!(error instanceof Deno.errors.Interrupted)) console.error(prefix, error)
  }
}

function logLine(prefix: string, line: string): void {
  const text = line.trim()
  if (text) console.log(prefix + text)
}

function stopChild(child: Deno.ChildProcess): void {
  try {
    child.kill("SIGTERM")
  } catch {
    // The backend may already have exited.
  }
}

async function fileExists(path: string | URL): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function clean(value: string | undefined): string | undefined {
  const next = value?.trim()
  return next || undefined
}

function fileURLPath(url: URL): string {
  let path = decodeURIComponent(url.pathname)
  if (Deno.build.os === "windows" && /^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return path
}
