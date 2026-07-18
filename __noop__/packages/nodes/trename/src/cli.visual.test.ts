import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"

// @xiranite-real-run trename

const RUN_ROOT = resolve("artifacts/test-runs/trename-cli-visual")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("trename CLI guided visual", () => {
  test("interactive refusal mentions scripted JSON fallback", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(host.stderrText()).toContain("subcommand")
    expect(host.stderrText()).toContain("--json")
  })

  test("scan renders Chinese summary panel for a real folder", async () => {
    const fixture = await createFixture("scan-visual")
    const host = createHost()

    await runProgram(["scan", "--path", fixture.galleryRoot], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("执行总结")
    expect(stdout).toContain("总计:")
    expect(stdout).toContain("待翻译:")
    expect(stdout).toContain("可重命名:")
    expect(stdout).toContain("JSON 预览")
  })

  test("rename dry-run renders Chinese summary with operation details", async () => {
    const fixture = await createFixture("rename-visual")
    const inputJson = join(fixture.root, "rename.json")
    await writeFile(inputJson, JSON.stringify({ root: [{ src: "a.jpg", tgt: "A.jpg" }] }), "utf8")

    const host = createHost()

    await runProgram(["rename", "--input", inputJson, "--base", fixture.renameRoot, "--dryRun"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("执行总结")
    expect(stdout).toContain("成功:")
    expect(stdout).toContain("跳过:")
    expect(stdout).toContain("操作详情")
  })

  test("undo with no batch prints Chinese not-found failure", async () => {
    const fixture = await createFixture("undo-visual")
    const host = createHost()

    await runProgram(["undo", "--undoPath", fixture.undoPath], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(1)
    expect(host.stdoutText()).toContain("执行总结")
  })

  test("history with no batches renders empty Chinese summary", async () => {
    const fixture = await createFixture("history-visual")
    const host = createHost()

    await runProgram(["history", "--undoPath", fixture.undoPath], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText()).toContain("执行总结")
  })
})

async function createFixture(name: string): Promise<{ root: string; galleryRoot: string; renameRoot: string; undoPath: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const galleryRoot = join(root, "gallery")
  const renameRoot = join(root, "rename")
  const undoPath = join(root, "trename-undo.json")
  await mkdir(galleryRoot, { recursive: true })
  await mkdir(renameRoot, { recursive: true })
  await writeFile(join(galleryRoot, "image-a.jpg"), "jpg", "utf8")
  await writeFile(join(galleryRoot, "readme.txt"), "txt", "utf8")
  await writeFile(join(renameRoot, "a.jpg"), "jpg", "utf8")
  cases.add(root)
  return { root, galleryRoot, renameRoot, undoPath }
}

function createHost(): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  return {
    cwd: process.cwd(),
    env: { ...process.env, XIRANITE_CLI_COLUMNS: "120" },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        stdout += chunk
        return true
      },
    },
    stderr: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        stderr += chunk
        return true
      },
    },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}
