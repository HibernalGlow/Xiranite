import { afterEach, describe, expect, test, vi } from "vitest"

import type { TerminalInteractionDefinition } from "../interaction.js"
import { createMemoryCliHost, explicitInteractionModes } from "../testing.js"
import { runInteractionCli } from "./index.js"

const definition: TerminalInteractionDefinition<{ action: string }, { success: boolean }> = {
  schema: {
    id: "demo", title: "Demo", description: "Demo", initialValues: { action: "status" },
    fields: [{ id: "action", label: "Action", kind: "text" }],
    toInput: () => ({ action: "status" }), preview: () => [], isDangerous: () => false,
    result: (result) => ({ success: result.success, message: "ok" }),
  },
  run: async () => ({ success: true }),
}

afterEach(() => { process.exitCode = 0 })

describe("shared interaction CLI dispatcher", () => {
  test.each(explicitInteractionModes)("rejects %s without a TTY", async (mode) => {
    const host = createMemoryCliHost()
    const adapters = createAdapters()
    await dispatch([mode], host, adapters)
    expect(process.exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(adapters.runUi).not.toHaveBeenCalled()
    expect(adapters.runGuide).not.toHaveBeenCalled()
  })

  test("routes configured defaults, aliases, explicit UI, and pipe centrally", async () => {
    const adapters = createAdapters()
    await dispatch([], createMemoryCliHost({ tty: true }), adapters, "gd")
    await dispatch(["guided"], createMemoryCliHost({ tty: true }), adapters)
    await dispatch(["ui", "--lang", "en"], createMemoryCliHost({ tty: true }), adapters)
    await dispatch(["status", "--json"], createMemoryCliHost(), adapters)
    expect(adapters.runGuide).toHaveBeenCalledTimes(2)
    expect(adapters.runUi).toHaveBeenCalledTimes(1)
    expect(adapters.runPipe).toHaveBeenCalledWith(["status", "--json"], expect.anything())
  })
})

function createAdapters() {
  return { runUi: vi.fn(async () => undefined), runGuide: vi.fn(async () => undefined), runPipe: vi.fn(async () => undefined) }
}

async function dispatch(args: string[], host: ReturnType<typeof createMemoryCliHost>, adapters: ReturnType<typeof createAdapters>, mode: "ui" | "gd" | "pipe" = "ui") {
  await runInteractionCli({
    args, host, cliName: "xdemo",
    loadContext: async () => ({ preferences: { mode, renderer: "opentui", language: "zh", theme: "inherit" }, value: {} }),
    createDefinition: () => definition,
    runPipe: adapters.runPipe,
    runUi: adapters.runUi,
    runGuide: adapters.runGuide,
  })
}
