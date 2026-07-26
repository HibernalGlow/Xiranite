import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readAtomicJsonFile, updateAtomicJsonFile } from "./index.js"

describe("atomic JSON state", () => {
  it("serializes read-modify-write updates and recovers malformed contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-atomic-json-"))
    const file = join(directory, "state.json")
    const options = {
      fallback: { count: 0 },
      parse(value: unknown) {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("state must be an object")
        const count = (value as { count?: unknown }).count
        if (!Number.isInteger(count)) throw new Error("count must be an integer")
        return { count: count as number }
      },
    }
    try {
      await Promise.all(Array.from({ length: 8 }, () => updateAtomicJsonFile(file, (state) => ({ count: state.count + 1 }), options)))
      expect(await readAtomicJsonFile(file, options)).toEqual({ count: 8 })
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ count: 8 })
      await writeFile(file, "{not json", "utf8")
      expect(await readAtomicJsonFile(file, options)).toEqual({ count: 0 })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
