import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { execFile as execFileCallback } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, test } from "vitest"
import { parseArgs, renderPosixShim } from "./install-cli-shims.ts"

const execFile = promisify(execFileCallback)

describe("CLI shim installation", () => {
  test("installs the argv-preserving POSIX shim by default on Windows", () => {
    expect(parseArgs([]).posix).toBe(true)
  })

  test("preserves quoted regular expressions through Git Bash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-shim-"))
    const shim = renderPosixShim({
      name: "xfindz",
      target: "probe-target",
    })
    const pattern = 'name rlike "^(foo|bar)\\d+ [a-z]+$"'

    try {
      await writeFile(join(directory, "xfindz"), shim, "utf8")
      await writeFile(join(directory, "bun"), "#!/usr/bin/env sh\nfor argument do printf '<%s>\\n' \"$argument\"; done\n", "utf8")
      await Promise.all([chmod(join(directory, "xfindz"), 0o755), chmod(join(directory, "bun"), 0o755)])

      const { stdout } = await execFile("bash", [
        "--noprofile",
        "--norc",
        "-c",
        'PATH="$PWD:$PATH" ./xfindz "$@"',
        "--",
        "--where",
        pattern,
      ], { cwd: directory, encoding: "utf8", windowsHide: true })

      expect(stdout).toBe(`<probe-target>\n<--where>\n<${pattern}>\n`)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
