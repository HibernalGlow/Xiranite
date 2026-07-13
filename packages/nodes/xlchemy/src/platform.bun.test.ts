import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { ensureDir } from "./platform.js"

test("accepts an existing source-output directory on Bun/Windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "xlchemy-existing-dir-"))
  const existing = join(root, "Downloads")
  await mkdir(existing)

  try {
    await expect(ensureDir(existing)).resolves.toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
