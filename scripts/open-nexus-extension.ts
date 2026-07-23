import { existsSync, readFileSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

const root = resolve(import.meta.dir, "..")
const nexusRoot = resolve(root, "vendor", "Xiranite-Nexus")
const packageJson = resolve(nexusRoot, "package.json")
const webpackBin = resolve(nexusRoot, "node_modules", ".bin", process.platform === "win32" ? "webpack.cmd" : "webpack")
const outputDirectory = resolve(nexusRoot, "dev")
const manifest = resolve(outputDirectory, "manifest.json")
const nativeDirectory = resolve(outputDirectory, "native")
const nativeHostExecutable = resolve(nativeDirectory, process.platform === "win32" ? "xiranite-native-host.exe" : "xiranite-native-host")
const noOpen = process.argv.includes("--no-open")

if (!existsSync(packageJson)) {
  await run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/Xiranite-Nexus"], root)
}

if (!existsSync(webpackBin)) {
  await run("npm", ["install", "--package-lock=false", "--ignore-scripts"], nexusRoot)
}

await run("npm", ["run", "build:nexus:chrome"], nexusRoot)
if (!existsSync(manifest)) throw new Error(`Nexus build did not produce ${manifest}`)

await mkdir(nativeDirectory, { recursive: true })
await run("go", ["build", "-mod=mod", "-o", nativeHostExecutable, "./cmd/xiranite-native-host"], root)
const extensionId = extensionIdFromManifest(manifest)
const mainExecutable = findMainExecutable()
await rm(resolve(nativeDirectory, "xiranite-native-host.config.json"), { force: true })
if (mainExecutable) {
  await writeFile(resolve(nativeDirectory, "xiranite-native-host.config.json"), `${JSON.stringify({ mainExecutable }, null, 2)}\n`)
}
await registerNativeHosts(nativeDirectory, nativeHostExecutable, extensionId)

if (!noOpen && process.platform === "win32") {
  const edge = findEdge()
  if (!edge) throw new Error("Microsoft Edge was not found.")
  launch(edge, ["edge://extensions"])
  launch("explorer.exe", [outputDirectory])
} else if (!noOpen) {
  console.log(`Open your browser extension page and load: ${outputDirectory}`)
}

console.log(`Xiranite Nexus unpacked extension: ${outputDirectory}`)
console.log(`Xiranite Native Bridge registered for extension: ${extensionId}`)
if (!noOpen) console.log("Edge and the build directory are open. Enable Developer mode, then click Load unpacked.")

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

function extensionIdFromManifest(path: string): string {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { key?: string }
  if (!parsed.key) throw new Error("Nexus manifest must contain a stable key for Native Messaging registration.")
  const hash = createHash("sha256").update(Buffer.from(parsed.key, "base64")).digest().subarray(0, 16)
  return [...hash].map((value) => String.fromCharCode(97 + (value >> 4), 97 + (value & 15))).join("")
}

async function registerNativeHosts(directory: string, executable: string, extensionId: string): Promise<void> {
  if (process.platform !== "win32") return
  const origin = `chrome-extension://${extensionId}/`
  const browsers = [
    { name: "Edge", registry: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts" },
    { name: "Chrome", registry: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts" },
  ]
  for (const browser of browsers) {
    const manifestPath = resolve(directory, `${browser.name.toLowerCase()}-native-host.json`)
    await writeFile(manifestPath, `${JSON.stringify({
      name: "com.xiranite.nexus",
      description: "Xiranite Nexus Native Bridge",
      path: executable,
      type: "stdio",
      allowed_origins: [origin],
    }, null, 2)}\n`)
    await run("reg", ["add", `${browser.registry}\\com.xiranite.nexus`, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], root)
  }
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

function findMainExecutable(): string | undefined {
  const executable = process.platform === "win32" ? "Xiranite.exe" : "Xiranite"
  const candidates = [
    process.env.XIRANITE_NEXUS_MAIN_EXE,
    resolve(root, "build", "wails", executable),
    process.env.USERPROFILE && resolve(process.env.USERPROFILE, "scoop", "apps", "xiranite", "current", executable),
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}
