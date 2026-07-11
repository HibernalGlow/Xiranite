#!/usr/bin/env node
import { writeFile } from "node:fs/promises"
import { runGuidedInteraction, type CliHost } from "@xiranite/cli-runtime"
import { runTerminalUi } from "@xiranite/cli-runtime/terminal"

import { runProgram } from "../../packages/nodes/sleept/src/cli.js"
import type { SleeptRuntime } from "../../packages/nodes/sleept/src/core.js"

const host: CliHost = {
  cwd: process.cwd(),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}

function createSafeRuntime(): SleeptRuntime {
  return {
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    getCpuPercent: () => 0,
    getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
    async executePowerAction(_mode, dryrun) {
      if (dryrun) return
      const sentinel = process.env.XIRANITE_TEST_LIVE_SENTINEL
      if (sentinel) await writeFile(sentinel, "blocked live execution", "utf8")
      throw new Error("LIVE_EXECUTION_BLOCKED_BY_TEST_RUNTIME")
    },
  }
}

try {
  await runProgram(process.argv.slice(2), host, {
    createRuntime: createSafeRuntime,
    runGuide: runGuidedInteraction,
    runUi: runTerminalUi,
  })
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
