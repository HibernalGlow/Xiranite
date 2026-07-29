#!/usr/bin/env bun
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

type LaunchAcknowledgement = {
  requestId?: string
  accepted?: boolean
  message?: string
}

type SmokeMarker = {
  nodeId?: string
  snapshotId?: string
  backendBaseUrl?: string
  backendToken?: string
  windowCreated?: boolean
  backendRequests?: string[]
  acknowledgements?: LaunchAcknowledgement[]
}

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: { exe: { type: "string" } },
})
const exe = parsed.values.exe
if (!exe) throw new Error("--exe is required.")

const root = await mkdtemp(join(tmpdir(), "xiranite-external-node-launch-smoke-"))
const dataDirectory = join(root, "data")
const folder = join(root, "folder")
const media = join(folder, "001.png")
const unsupported = join(root, "unsupported.txt")
const markerPath = join(root, "external-launch.json")
const shutdownPath = join(root, "shutdown")
const environment = {
  ...process.env,
  APPDATA: root,
  LOCALAPPDATA: root,
  XIRANITE_DATA_DIR: dataDirectory,
  XIRANITE_NODE_SOURCE: "0",
  XIRANITE_EXTERNAL_NODE_LAUNCH_SMOKE_MARKER: markerPath,
  XIRANITE_EXTERNAL_NODE_LAUNCH_SMOKE_SHUTDOWN_FILE: shutdownPath,
}
let primary: Bun.Subprocess | undefined

try {
  await Promise.all([
    mkdir(dataDirectory, { recursive: true }),
    mkdir(folder, { recursive: true }),
    mkdir(join(root, "NeoView"), { recursive: true }),
  ])
  await writeFile(join(dataDirectory, "xiranite.config.toml"), [
    "[app.ui]",
    "version = 3",
    "[app.ui.workspace]",
    'theme = "spatial"',
    "[app.ui.workspace.themeSelections.light]",
    'kind = "preset"',
    'name = "wuling"',
    "[app.ui.workspace.themeSelections.dark]",
    'kind = "custom"',
    'name = "External smoke theme"',
    "[app.ui.appearance]",
    'colorMode = "dark"',
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.reader]",
    'reading_direction = "right-to-left"',
    "",
  ].join("\n"), "utf8")
  await writeFile(join(dataDirectory, "themes.json"), JSON.stringify([{
    name: "External smoke theme",
    cssVars: {
      light: { primary: "oklch(0.5 0.1 120)" },
      dark: { primary: "oklch(0.72 0.12 250)" },
    },
  }], null, 2), "utf8")
  await writeFile(media, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"))
  await writeFile(unsupported, "not a NeoView media type\n", "utf8")

  primary = launch(exe, media, environment)
  const started = await waitForMarker(markerPath, (marker) => marker.windowCreated === true, primary)
  if (started.nodeId !== "neoview" || started.snapshotId !== "external-launch-v1" || !started.backendBaseUrl || !started.backendToken) {
    throw new Error(`External node host did not establish the expected isolated NeoView boundary: ${JSON.stringify(started)}`)
  }
  await waitForAcknowledgement(markerPath, 0, true)
  const appearance = await waitForMarker(markerPath, (marker) => {
    const requests = new Set(marker.backendRequests ?? [])
    return requests.has("GET /config/app/ui")
      && requests.has("GET /config/themes")
      && requests.has("GET /config/bg-image")
      && requests.has("GET /reader/config")
  })
  const sharedUi = await fetchBackendJson(started.backendBaseUrl, started.backendToken, "/config/app/ui") as {
    config?: { workspace?: { themeSelections?: { dark?: { name?: string } } }; appearance?: { colorMode?: string } }
  }
  if (sharedUi.config?.appearance?.colorMode !== "dark" || sharedUi.config.workspace?.themeSelections?.dark?.name !== "External smoke theme") {
    throw new Error(`Direct NeoView host did not read shared app UI configuration: ${JSON.stringify(sharedUi)}`)
  }
  const themes = await fetchBackendJson(started.backendBaseUrl, started.backendToken, "/config/themes") as { themes?: Array<{ name?: string }> }
  if (themes.themes?.[0]?.name !== "External smoke theme") {
    throw new Error(`Direct NeoView host did not read shared custom themes: ${JSON.stringify(themes)}`)
  }
  const neoView = await fetchBackendJson(started.backendBaseUrl, started.backendToken, "/config/nodes/neoview") as { config?: { reader?: { reading_direction?: string } } }
  if (neoView.config?.reader?.reading_direction !== "right-to-left") {
    throw new Error(`Direct NeoView host did not read NeoView configuration: ${JSON.stringify(neoView)}`)
  }
  if (!appearance.backendRequests?.includes("GET /reader/config")) {
    throw new Error("Direct NeoView host did not request Reader configuration.")
  }

  await expectSecondaryExit(launch(exe, folder, environment), "directory launch")
  await waitForAcknowledgement(markerPath, 1, true)

  await expectSecondaryExit(launch(exe, unsupported, environment), "unsupported file launch")
  const rejected = await waitForAcknowledgement(markerPath, 2, false)
  if (!rejected.message) throw new Error("Unsupported external launch was rejected without an actionable diagnostic.")

  console.log("[external-node-launch] direct NeoView host read shared appearance and NeoView config, accepted media and directory, then rejected an unsupported file")
} finally {
  if (primary) {
    await writeFile(shutdownPath, "quit\n", "utf8").catch(() => undefined)
    const exited = await withTimeout(primary.exited, 15_000, "external node host did not exit cleanly").then(() => true).catch(() => false)
    if (!exited) primary.kill()
    await withTimeout(primary.exited, 5_000, "external node host did not terminate").catch(() => undefined)
  }
  await removeWithWindowsRetry(root)
}

async function fetchBackendJson(baseUrl: string | undefined, token: string | undefined, path: string): Promise<unknown> {
  if (!baseUrl || !token) throw new Error(`Backend marker did not include a usable endpoint for ${path}.`)
  const response = await fetch(`${baseUrl}${path}`, { headers: { "x-xiranite-token": token } })
  if (!response.ok) throw new Error(`Backend request ${path} failed with status ${response.status}.`)
  return await response.json()
}

function launch(executable: string, target: string, env: Record<string, string | undefined>): Bun.Subprocess {
  return Bun.spawn([executable, "--launch-node", "neoview", "--intent", "open", "--", target], {
    env,
    stdout: "inherit",
    stderr: "inherit",
  })
}

async function expectSecondaryExit(process: Bun.Subprocess, label: string): Promise<void> {
  const code = await withTimeout(process.exited, 25_000, `${label} did not return after host acknowledgement`)
  if (code !== 0) throw new Error(`${label} exited with code ${code}`)
}

async function waitForAcknowledgement(path: string, index: number, accepted: boolean): Promise<LaunchAcknowledgement> {
  const marker = await waitForMarker(path, (next) => Boolean(next.acknowledgements?.[index]))
  const acknowledgement = marker.acknowledgements?.[index]
  if (!acknowledgement || acknowledgement.accepted !== accepted || !acknowledgement.requestId) {
    throw new Error(`External launch acknowledgement ${index} was invalid: ${JSON.stringify(acknowledgement)}`)
  }
  return acknowledgement
}

async function waitForMarker(path: string, predicate: (marker: SmokeMarker) => boolean, watchedProcess?: Bun.Subprocess): Promise<SmokeMarker> {
  const deadline = Date.now() + 45_000
  let latest: SmokeMarker | undefined
  while (Date.now() < deadline) {
    if (watchedProcess) {
      const exitCode = await Promise.race([watchedProcess.exited, sleep(0).then(() => undefined)])
      if (exitCode !== undefined) throw new Error(`External node host exited before writing its marker (code ${exitCode}).`)
    }
    const content = await readFile(path, "utf8").catch(() => undefined)
    if (content) {
      try {
        latest = JSON.parse(content) as SmokeMarker
        if (predicate(latest)) return latest
      } catch {
        // Marker replacement is observed concurrently with the host process.
      }
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for external node host marker: ${JSON.stringify(latest)}`)
}

async function removeWithWindowsRetry(path: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 0 })
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EBUSY" && code !== "EPERM") throw error
      await sleep(1_000)
    }
  }
  if (await access(path).then(() => true).catch(() => false)) throw lastError
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs) }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
