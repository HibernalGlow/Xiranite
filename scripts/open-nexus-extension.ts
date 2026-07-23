import { existsSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const nexusRoot = resolve(root, "vendor", "Xiranite-Nexus")
const packageJson = resolve(nexusRoot, "package.json")
const webpackBin = resolve(nexusRoot, "node_modules", ".bin", process.platform === "win32" ? "webpack.cmd" : "webpack")
const outputDirectory = resolve(nexusRoot, "dev")
const manifest = resolve(outputDirectory, "manifest.json")

if (!existsSync(packageJson)) {
  await run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/Xiranite-Nexus"], root)
}

if (!existsSync(webpackBin)) {
  await run("npm", ["install", "--package-lock=false", "--ignore-scripts"], nexusRoot)
}

await run("npm", ["run", "build:nexus:chrome"], nexusRoot)
if (!existsSync(manifest)) throw new Error(`Nexus build did not produce ${manifest}`)

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
