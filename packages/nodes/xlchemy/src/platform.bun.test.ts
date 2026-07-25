import { access, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { createCachedCommandResolver, createNodeXlchemyRuntime, ensureDir } from "./platform.js"

test("resolves an encoder path once across concurrent file workers", async () => {
  let calls = 0
  const resolveCommand = createCachedCommandResolver(async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return "/bin/avifenc"
  })

  expect(await Promise.all([
    resolveCommand(["avifenc"]),
    resolveCommand(["avifenc"]),
    resolveCommand(["avifenc"]),
  ])).toEqual(["/bin/avifenc", "/bin/avifenc", "/bin/avifenc"])
  expect(await resolveCommand(["avifenc"])).toBe("/bin/avifenc")
  expect(calls).toBe(1)
})

test("does not permanently cache a missing encoder", async () => {
  let calls = 0
  const resolveCommand = createCachedCommandResolver(async () => {
    calls += 1
    return calls === 1 ? undefined : "/bin/avifenc"
  })

  expect(await resolveCommand(["avifenc"])).toBeUndefined()
  expect(await resolveCommand(["avifenc"])).toBe("/bin/avifenc")
  expect(calls).toBe(2)
})

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
