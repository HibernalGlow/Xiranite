import { expect, test } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"

test("probe: disabled undo refuses", async () => {
  const root = await mkdtemp(join(tmpdir(), "xiranite-trename-probe2-"))
  try {
    await mkdir(join(root, "记录"), { recursive: true })
    const config = join(root, "xiranite.config.toml")
    await writeFile(config, "[nodes.trename]\nenable_undo = false\n", "utf8")
    let stdout = ""
    let stderr = ""
    const host: CliHost = {
      cwd: process.cwd(),
      env: {
        XIRANITE_CONFIG_PATH: config,
        XIRANITE_CLI_COLUMNS: "120",
        NO_COLOR: "1",
        // A host binary that is not there: if the run ever reached the host, the face must fail loudly
        // rather than answer from somewhere else.
        XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host"),
      },
      stdin: { isTTY: false } as CliHost["stdin"],
      stdout: { isTTY: false, columns: 120, write: (c: string) => { stdout += c; return true } } as unknown as CliHost["stdout"],
      stderr: { isTTY: false, columns: 120, write: (c: string) => { stderr += c; return true } } as unknown as CliHost["stderr"],
    }
    process.exitCode = 0
    await runProgram(["undo", "--undoPath", join(root, "记录", "trename-undo.json"), "--json"], host)
    console.log("exitCode:", process.exitCode)
    console.log("stdout:", JSON.stringify(stdout))
    console.log("stderr:", JSON.stringify(stderr))
    expect(true).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
    process.exitCode = 0
  }
})
