import { afterEach, describe, expect, test } from "vitest"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { MarkuResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/marku-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("marku CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xmarku ui")
  })

  test("processes inline markdown text as JSON", async () => {
    const host = createHost()

    await runProgram(["text", "--module", "markt", "--input", "# Title\n## Child", "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Text processed: changed.")
    expect(result.data?.outputText).toBe("- Title\n  - Child")
    expect(result.data?.filesChanged).toBe(1)
  })

  test("reads an input file and writes text-mode output into an ignored fixture", async () => {
    const fixture = await createFixture("file-output")
    const host = createHost()
    const input = resolve(fixture, "input.md")
    const output = resolve(fixture, "output.md")

    await runProgram(["text", "--module", "title_convert", "--inputFile", input, "--outputFile", output], host)

    expect(process.exitCode).toBe(0)
    expect(await readFile(output, "utf8")).toBe("# Messy Title\n")
    expect(host.stdoutText()).toContain("Text processed: changed.")
    expect(host.stdoutText()).toContain("# Messy Title")
  })

  test("runs a supplied JSON workflow over inline text and reports step results", async () => {
    const host = createHost()
    const workflow = JSON.stringify({
      id: "wf-cli",
      name: "cli pipeline",
      steps: [
        { id: "s1", module: "content_replace", config: { patterns: [{ from: "alpha", to: "beta" }] } },
        { id: "s2", module: "content_replace", config: { patterns: [{ from: "beta", to: "gamma" }] } },
      ],
    })

    await runProgram(["workflow", "--workflow", workflow, "--input", "alpha", "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(true)
    expect(result.data?.outputText).toBe("gamma")
    expect(result.data?.workflow?.workflowId).toBe("wf-cli")
    expect(result.data?.workflow?.sources).toHaveLength(1)
    expect(result.data?.workflow?.sources[0]?.steps.map((step) => step.outputText)).toEqual(["beta", "gamma"])
  })

  test("reads a workflow JSON file and fails cleanly on unknown modules", async () => {
    const fixture = await createFixture("workflow-file")
    const host = createHost()
    const workflowPath = resolve(fixture, "workflow.json")
    await writeFile(workflowPath, JSON.stringify({ id: "wf-bad", name: "bad", steps: [{ id: "s1", module: "ghost_module", config: {} }] }), "utf8")

    await runProgram(["workflow", "--workflowFile", workflowPath, "--input", "alpha", "--json"], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("unknown module: ghost_module")
  })

  test("reports the canonical failure when no workflow definition is supplied", async () => {
    const host = createHost()

    await runProgram(["workflow", "--input", "alpha", "--json"], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("missing or malformed")
  })
})

async function createFixture(name: string): Promise<string> {
  const dir = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, "input.md"), "#   Messy    Title\n", "utf8")
  cases.add(dir)
  return dir
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
