#!/usr/bin/env bun

const layers = [
  ["@xiranite/config", "@xiranite/shared"],
  ["@xiranite/contract", "@xiranite/repository"],
  ["@xiranite/services", "@xiranite/runtime"],
  ["@xiranite/api"],
  ["@xiranite/backend"],
] as const

for (const packages of layers) {
  const filters = packages.map((name) => `--filter=${name}`)
  const child = Bun.spawn([
    process.execPath,
    "scripts/run-turbo.ts",
    "build",
    "--only",
    ...filters,
  ], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
}
