import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { withXiraniteFileLock } from "./node.js"

/**
 * The lease of `withXiraniteFileLock` is a promise, so a caller that forgets to await it observes nothing —
 * the guard would pass with the lock already stolen. Two arms here: the wrapper's own end-of-operation check
 * must catch the theft, and a caller that does await the probe must still succeed normally.
 */
describe("withXiraniteFileLock lease", () => {
  const dirs: string[] = []

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  async function fixture(label: string) {
    const built = await mkdtemp(join(tmpdir(), `xiranite-lock-${label}-`))
    // macOS keeps the temp tree behind a symlink, and the transport locks the canonical path. Building the
    // expected lock path from an unresolved directory would compare two spellings instead of two files.
    const dir = await realpath(built)
    dirs.push(dir)
    const file = join(dir, "state.json")
    await writeFile(file, '{"count":0}', "utf8")
    return { dir, file, lock: `${file}.xr-write.lock` }
  }

  test("a caller that awaits the probe keeps working", async () => {
    const { file } = await fixture("kept")
    const answer = await withXiraniteFileLock(file, async (assertLockHeld) => {
      await assertLockHeld()
      return "done"
    })
    expect(answer).toBe("done")
    expect(await readFile(file, "utf8")).toBe('{"count":0}')
  })

  test("a stolen lease is caught even when the caller ignores the probe", async () => {
    const { file, lock } = await fixture("stolen")

    await expect(
      withXiraniteFileLock(file, async () => {
        // No `assertLockHeld()` call at all: this is the shape that made the async probe decorative.
        await writeFile(lock, "someone-else-1", "utf8")
        return "must not be trusted"
      }),
    ).rejects.toThrow(/compromised/)

    // Somebody else's lock is left on disk — evicting a live holder would be the worse failure.
    expect(await readFile(lock, "utf8")).toBe("someone-else-1")
  })

  test("the awaited probe still stops an operation mid-way", async () => {
    const { file, lock } = await fixture("early")

    await expect(
      withXiraniteFileLock(file, async (assertLockHeld) => {
        await assertLockHeld()
        await writeFile(lock, "someone-else-2", "utf8")
        await assertLockHeld()
        return "unreachable"
      }),
    ).rejects.toThrow(/compromised/)
  })
})
