import { access, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { createNodeXlchemyRuntime, ensureDir } from "./platform.js"

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

test("materializes and cleans up clipboard image bytes in a temporary workspace", async () => {
  const runtime = createNodeXlchemyRuntime()
  const path = await runtime.createTemporaryFile!(".png", "cG5nLWJ5dGVz")

  expect(path.endsWith("clipboard.png")).toBe(true)
  expect(await runtime.readFileBase64!(path)).toBe("cG5nLWJ5dGVz")
  await runtime.cleanupTemporaryFile!(path)
  await expect(access(path)).rejects.toBeTruthy()
})
