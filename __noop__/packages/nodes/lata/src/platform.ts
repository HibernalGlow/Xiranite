import { spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import type { LataRuntime } from "./core.js"

export function createNodeLataRuntime(): LataRuntime {
  return {
    cwd: () => process.cwd(),
    exists,
    readText,
    runCommand,
    join,
    dirname,
    basename,
    resolve,
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function runCommand(
  command: string,
  options: { cwd: string; env?: Record<string, string> },
  onOutput: (chunk: string, stream: "stdout" | "stderr") => void = () => {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = decodeProcessOutput(chunk)
      stdout += text
      onOutput(text.trimEnd(), "stdout")
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = decodeProcessOutput(chunk)
      stderr += text
      onOutput(text.trimEnd(), "stderr")
    })
    child.on("error", (error) => {
      stderr += error.message
      resolvePromise({ exitCode: 1, stdout, stderr })
    })
    child.on("close", (code) => {
      resolvePromise({ exitCode: code ?? 0, stdout, stderr })
    })
  })
}

function decodeProcessOutput(chunk: Buffer): string {
  const utf8 = chunk.toString("utf8")
  if (process.platform !== "win32" || !utf8.includes("\uFFFD")) return utf8
  try {
    return new TextDecoder("gbk").decode(chunk)
  } catch {
    return utf8
  }
}
