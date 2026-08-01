import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, expect } from "vitest"
import { loadClipmWorkerOptions } from "./platform.js"

test("enables unattended training by default while preserving an explicit opt-out", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "xiranite-clipm-config-"))
  try {
    const defaults = await loadClipmWorkerOptions({ cwd, env: {} })
    expect(defaults.autoTrain).toBe(true)
    expect(defaults.autoTrainBatchSize).toBe(20)

    const optedOut = await loadClipmWorkerOptions({ cwd, env: { XIRANITE_CLIPM_AUTO_TRAIN: "false" } })
    expect(optedOut.autoTrain).toBe(false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
