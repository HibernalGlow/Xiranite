import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { availableParallelism, cpus, hostname, release, totalmem } from "node:os"

const MIB = 1024 * 1024
const TASK_PATHS = [
  "package.json",
  "docs/adr/0055-keep-xlchemy-streaming-in-bun-before-process-isolation.md",
  "docs/xlchemy-large-batch-acceptance.md",
  "packages/nodes/xlchemy",
  "src/nodes/xlchemy",
  "scripts/verify-xlchemy-large-batch.ts",
  "scripts/benchmark-xlchemy-go-reference.ts",
  "scripts/qa-xlchemy-slimg-inputs.ts",
  "scripts/lib/xlchemy-acceptance-environment.ts",
  "scripts/lib/xlchemy-large-batch-corpus.ts",
  "scripts/lib/xlchemy-go-reference-comparison.ts",
  "scripts/lib/xlchemy-go-reference-comparison.test.ts",
  "scripts/lib/runtime-benchmark-metrics.ts",
]

export async function collectXlchemyAcceptanceEnvironment() {
  const dllPath = process.env.SLIMG_CFFI_PATH?.trim() || "C:\\Windows\\System32\\slimg_cffi.dll"
  const dllStat = await stat(dllPath)
  const [dllSha256, commit, taskStatus] = await Promise.all([
    hashFile(dllPath),
    commandOutput("git", ["rev-parse", "HEAD"]),
    commandOutput("git", ["status", "--short", "--", ...TASK_PATHS]),
  ])
  return {
    capturedAt: new Date().toISOString(),
    commandLine: process.argv,
    repository: { commit, taskStatus: taskStatus || "clean" },
    runtime: { bunVersion: Bun.version, platform: process.platform, architecture: process.arch },
    machine: {
      hostname: hostname(),
      osRelease: release(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      logicalProcessors: availableParallelism(),
      totalMemoryMiB: round(totalmem() / MIB),
    },
    slimg: { path: dllPath, sizeBytes: dllStat.size, sha256: dllSha256 },
    reference: { tag: "v1.2.9", commit: "75f58f97c8f9e6a4fb3749fe37f958f986893707" },
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

async function commandOutput(command: string, args: string[]): Promise<string> {
  const child = Bun.spawn([command, ...args], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`)
  return stdout.trim()
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
