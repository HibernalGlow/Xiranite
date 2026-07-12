import { resolve } from "node:path"

const builds = new Map<string, Promise<void>>()
type BunProcess = { exited: Promise<number> }
type BunRuntime = { spawn(command: readonly string[], options: { cwd: string; stdin: "inherit"; stdout: "inherit"; stderr: "inherit" }): BunProcess }

export function ensureNodePackageBuilt(packageName: string): Promise<void> {
  if (process.env.XIRANITE_LAZY_NODE_BUILD !== "1") return Promise.resolve()
  const existing = builds.get(packageName)
  if (existing) return existing
  const build = buildNodePackage(packageName)
  builds.set(packageName, build)
  return build
}

async function buildNodePackage(packageName: string): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, "../../..")
  const bun = (globalThis as { Bun?: BunRuntime }).Bun
  if (!bun) throw new Error(`Cannot build ${packageName}: this development helper requires Bun.`)
  console.log(`[xiranite] Preparing ${packageName} for its first run...`)
  const child = bun.spawn([process.execPath, "scripts/run-turbo.ts", "build", `--filter=${packageName}...`], {
    cwd: repoRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Unable to build ${packageName} (exit ${exitCode}).`)
}
