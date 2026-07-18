#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(new URL("./qa-card.mjs", import.meta.url))
const nodeExecutable = process.env.XIRANITE_QA_NODE ?? "node"
const child = spawn(nodeExecutable, [scriptPath, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`qa-card stopped by signal ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 0
})

child.on("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
