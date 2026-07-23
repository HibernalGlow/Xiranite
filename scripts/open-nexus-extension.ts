import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const nexusRoot = resolve(root, "vendor", "Xiranite-Nexus")
const packageJson = resolve(nexusRoot, "package.json")
const webpackBin = resolve(nexusRoot, "node_modules", ".bin", process.platform === "win32" ? "webpack.cmd" : "webpack")
const outputDirectory = resolve(nexusRoot, "dev")
const manifest = resolve(outputDirectory, "manifest.json")
const nexusConfig = resolve(outputDirectory, "nexus-config.json")

if (!existsSync(packageJson)) {
  await run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/Xiranite-Nexus"], root)
}

if (!existsSync(webpackBin)) {
  await run("npm", ["install", "--package-lock=false", "--ignore-scripts"], nexusRoot)
}

await run("npm", ["run", "build:nexus:chrome"], nexusRoot)
if (!existsSync(manifest)) throw new Error(`Nexus build did not produce ${manifest}`)

const connection = await findActiveBackendConnection(root)
if (connection) {
  await Bun.write(nexusConfig, `${JSON.stringify(connection, null, 2)}\n`)
  console.log(`Nexus connected build: ${connection.baseUrl}`)
} else {
  await Bun.write(nexusConfig, "{}\n")
  console.warn("No running Xiranite backend was found. The extension will show a disconnected state.")
}

if (process.platform === "win32") {
  const edge = findEdge()
  if (!edge) throw new Error("Microsoft Edge was not found.")
  launch(edge, ["edge://extensions"])
  launch("explorer.exe", [outputDirectory])
} else {
  console.log(`Open your browser extension page and load: ${outputDirectory}`)
}

console.log(`Xiranite Nexus unpacked extension: ${outputDirectory}`)
console.log("Edge and the build directory are open. Enable Developer mode, then click Load unpacked.")

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const child = Bun.spawn([command, ...args], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} exited with code ${exitCode}.`)
}

function launch(command: string, args: string[]): void {
  const child = Bun.spawn([command, ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  })
  child.unref()
}

function findEdge(): string | undefined {
  const candidates = [
    Bun.which("msedge.exe"),
    process.env.ProgramFiles && resolve(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && resolve(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}

interface NexusConnection {
  baseUrl: string
  token?: string
}

async function findActiveBackendConnection(projectRoot: string): Promise<NexusConnection | undefined> {
  const wellKnownDirectory = resolve(projectRoot, "public", ".well-known", "xiranite")
  const candidates: string[] = []
  const activeSessionPath = resolve(projectRoot, ".cache", "xiranite-dev-session.json")
  const override = readConnectionOverride()
  if (override && await isHealthy(override)) return override

  if (existsSync(activeSessionPath)) {
    try {
      const session = JSON.parse(readFileSync(activeSessionPath, "utf8")) as { frontendUrl?: string }
      if (session.frontendUrl) {
        const port = new URL(session.frontendUrl).port
        if (port) candidates.push(resolve(wellKnownDirectory, `backend-${port}.json`))
      }
    } catch {
      // Fall through to the newest healthy manifest.
    }
  }

  if (existsSync(wellKnownDirectory)) {
    const manifests = readdirSync(wellKnownDirectory)
      .filter(name => /^backend(?:-\d+)?\.json$/.test(name))
      .map(name => resolve(wellKnownDirectory, name))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    candidates.push(...manifests)
  }

  for (const path of [...new Set(candidates)]) {
    const connection = readConnection(path)
    if (connection && await isHealthy(connection)) return connection
  }
  return undefined
}

function readConnectionOverride(): NexusConnection | undefined {
  const baseUrl = process.env.XIRANITE_NEXUS_BASE_URL?.trim().replace(/\/+$/, "")
  if (!baseUrl || !URL.canParse(baseUrl)) return undefined
  return { baseUrl, token: process.env.XIRANITE_NEXUS_TOKEN?.trim() }
}

function readConnection(path: string): NexusConnection | undefined {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<NexusConnection>
    if (!value.baseUrl || !URL.canParse(value.baseUrl)) return undefined
    return { baseUrl: value.baseUrl.replace(/\/+$/, ""), token: value.token }
  } catch {
    return undefined
  }
}

async function isHealthy(connection: NexusConnection): Promise<boolean> {
  try {
    const response = await fetch(`${connection.baseUrl}/health`, {
      headers: connection.token ? { "x-xiranite-token": connection.token } : {},
      signal: AbortSignal.timeout(1_500),
    })
    return response.ok
  } catch {
    return false
  }
}
