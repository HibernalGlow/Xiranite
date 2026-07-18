import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"

import { runProgram } from "../cli.js"
import { createReaderHeadlessController } from "../platform.js"

describe("NeoView CLI input binding dispatch", () => {
  it("[neoview.bindings.context-stack-cli] resolves a configured descriptor before executing headless navigation", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-cli-input-binding-"))
    await writeFile(join(root, "001.png"), pngHeader(1, 1))
    await writeFile(join(root, "002.png"), pngHeader(1, 1))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview]",
      "schema_version = 1",
      "[nodes.neoview.bindings]",
      "[[nodes.neoview.bindings.items]]",
      'id = "cli-context-key"',
      'action = "reader.next-page"',
      'context = "reader"',
      "enabled = true",
      "[nodes.neoview.bindings.items.input]",
      'device = "keyboard"',
      'code = "KeyK"',
      "",
    ].join("\n"))
    const output: unknown[] = []
    await runProgram([
      "input-bindings-dispatch", root,
      "--config", configPath,
      "--input-json", JSON.stringify({ device: "keyboard", code: "KeyK" }),
      "--contexts-json", JSON.stringify(["reader"]),
      "--json",
    ], host(output), {
      createController: (options = {}) => createReaderHeadlessController({ ...options, progressStore: false, legacyThumbnailDatabasePath: false }),
    })
    const result = JSON.parse(String(output.join(""))) as { matched: boolean; bindingId: string; result: { handled: boolean } }
    expect(result).toMatchObject({ matched: true, bindingId: "cli-context-key", result: { handled: true } })
  })
})

function host(output: unknown[]): CliHost {
  return {
    cwd: process.cwd(),
    env: {},
    stdin: { isTTY: true },
    stdout: { isTTY: false, write: (chunk: unknown) => { output.push(chunk); return true } },
    stderr: { isTTY: false, write: () => true },
  } as unknown as CliHost
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  for (let offset = 0; offset < 4; offset += 1) {
    bytes[16 + offset] = (width >>> ((3 - offset) * 8)) & 0xff
    bytes[20 + offset] = (height >>> ((3 - offset) * 8)) & 0xff
  }
  return bytes
}
