import { afterEach, describe, expect, test } from "vitest"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { EngineVResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/enginev-cli")
const cases = new Set<string>()
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lV9uKAAAAABJRU5ErkJggg==",
  "base64",
)

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("enginev CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xenginev scan --path")
    expect(host.stderrText()).toContain("--json")
  })

  test("prints pure JSON scan for a real Wallpaper Engine fixture", async () => {
    const fixture = await createFixture("json-scan")
    const host = createHost()

    await runProgram(["scan", "--path", fixture.workshopRoot, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as EngineVResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Scan complete: 1 wallpaper(s).")
    expect(result.data?.wallpapers).toEqual([expect.objectContaining({
      workshopId: "111",
      title: "Ocean Loop",
      preview: "preview.png",
      wallpaperType: "Video",
    })])
  })
})

async function createFixture(name: string): Promise<{ root: string; workshopRoot: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "真实 enginev")
  const workshopRoot = join(root, "workshop")
  const projectRoot = join(workshopRoot, "111")
  await mkdir(projectRoot, { recursive: true })
  await writeFile(join(projectRoot, "project.json"), JSON.stringify({
    title: "Ocean Loop",
    description: "calm motion",
    contentrating: "Everyone",
    preview: "preview.png",
    type: "Video",
    tags: ["test"],
  }), "utf8")
  await writeFile(join(projectRoot, "preview.png"), ONE_PIXEL_PNG)
  cases.add(root)
  return { root, workshopRoot }
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
