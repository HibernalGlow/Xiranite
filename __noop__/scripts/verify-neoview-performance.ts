#!/usr/bin/env bun

const commands = [
  { argv: ["bun", "run", "--cwd", "packages/nodes/neoview", "build"] },
  { argv: [process.execPath, "scripts/benchmark-neoview-reader.ts", "--assert"] },
  { argv: ["bunx", "playwright", "test", "tests/e2e/neoview/neoview-reader.spec.ts", "--project=chromium-desktop", "--project=chromium-card"] },
  { argv: ["bunx", "vite", "build", "--logLevel", "warn"], env: { XIRANITE_CHUNK_REPORT: "1" } },
  { argv: [process.execPath, "scripts/audit-neoview-build-chunk.ts"] },
] as const

for (const command of commands) {
  const child = Bun.spawn(command.argv, {
    cwd: process.cwd(),
    env: { ...process.env, ...("env" in command ? command.env : {}) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`NeoView performance command failed (${exitCode}): ${command.argv.join(" ")}`)
}

console.log("NeoView required performance gates passed.")
