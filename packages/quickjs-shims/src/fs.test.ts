/**
 * Existence semantics of the `node:fs` shims, against a scripted `__xrh` host.
 *
 * The rule under test is one the retained nodes are written against: Node *throws* ENOENT from
 * `stat`/`lstat`/`statSync`/`lstatSync` when the path is absent, while the host's `fs.stat` answers the
 * lenient `{ exists: false }` (AGENTS.md: refusals are data). Every platform file in `packages/nodes/*`
 * reads presence as `try { await lstat(p) } catch { missing }`, so a shim that returned a zero-size Stats
 * would turn "no file" into "file exists". Measured, not theorised: `dissolvef`'s undo refused a move with
 * "both source and target exist" for a target that did not exist.
 *
 * Each expectation is checked against the real `node:fs/promises` in the same test, so the contract is
 * Node's behaviour rather than something this file invented (the convention of `events.test.ts`).
 */
import { afterEach, describe, expect, it } from "vitest"
import { lstat as nodeLstat } from "node:fs/promises"
import * as nodeFs from "node:fs"

import { lstat as shimLstat, stat as shimStat, access as shimAccess } from "./fs-promises.ts"
import { statSync as shimStatSync, lstatSync as shimLstatSync, existsSync as shimExistsSync } from "./fs.ts"

const HOST_GLOBAL_KEY = "__xrh"
const MISSING = "/work/gone.txt"
const PRESENT = "/work/a.txt"

interface StatCall {
  operation: string
  arguments: Record<string, unknown>
}

const calls: StatCall[] = []

/** Installs a host that answers `fs.stat` from `answers`, recording every call. */
function installHost(answers: Record<string, unknown>): void {
  calls.length = 0
  const host = {
    call(operation: string, args: string) {
      const parsed = JSON.parse(args) as Record<string, unknown>
      if (operation === "fs.stat") {
        calls.push({ operation, arguments: parsed })
        const path = String(parsed.path)
        if (path in answers) return JSON.stringify(answers[path])
      }
      return "{}"
    },
    callAsync(operation: string, args: string) {
      return Promise.resolve(host.call(operation, args))
    },
    now() {
      return "2026-10-05T00:00:00.000Z"
    },
    platform: { platform: "darwin", arch: "arm64", sep: "/", pathSep: ":", cwd: "/work", env: "{}" },
  }
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY] = host
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY]
})

/** The host's lenient "not there" answer, as `crates/xiranite-quickjs-executor` actually spells it. */
const ABSENT = { [MISSING]: { path: MISSING, exists: false } }
const PRESENT_ANSWER = {
  [PRESENT]: { path: PRESENT, exists: true, isFile: true, isDirectory: false, sizeBytes: 5, mtimeMs: 1_700_000_000_000 },
}

describe("fs shims keep Node's ENOENT on a missing path", () => {
  it("rejects from lstat with code ENOENT, as node:fs/promises does", async () => {
    installHost(ABSENT)
    const nodeError = await nodeLstat(MISSING).then(
      () => null,
      (error: unknown) => error as NodeJS.ErrnoException,
    )
    expect(nodeError?.code, "node must reject for this comparison to mean anything").toBe("ENOENT")

    const shimError = await shimLstat(MISSING).then(
      () => null,
      (error: unknown) => error as NodeJS.ErrnoException,
    )
    expect(shimError, "the shim resolved a missing path instead of throwing").toBeInstanceOf(Error)
    expect(shimError!.code).toBe("ENOENT")
    expect(shimError!.message).toContain("ENOENT")
  })

  it("throws from statSync and lstatSync, as node:fs does", () => {
    installHost(ABSENT)
    expect(() => nodeFs.statSync(MISSING)).toThrow(/ENOENT/)
    expect(() => shimStatSync(MISSING)).toThrow(/ENOENT/)
    expect(() => shimLstatSync(MISSING)).toThrow(/ENOENT/)
    try {
      shimStatSync(MISSING)
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT")
      expect((error as NodeJS.ErrnoException).path).toBe(MISSING)
    }
  })

  it("keeps existsSync and access honest about the same answer", async () => {
    installHost(ABSENT)
    // `existsSync` is the one member that must NOT throw; `access` must.
    expect(shimExistsSync(MISSING)).toBe(false)
    expect(nodeFs.existsSync(MISSING)).toBe(false)
    await expect(shimAccess(MISSING)).rejects.toThrow(/ENOENT/)
  })

  it("still resolves a present path with its size and kind (positive control)", async () => {
    installHost(PRESENT_ANSWER)
    const stats = await shimStat(PRESENT)
    expect(stats.isFile()).toBe(true)
    expect(stats.isDirectory()).toBe(false)
    expect(stats.size).toBe(5)
    expect(stats.mtimeMs).toBe(1_700_000_000_000)
    expect(shimExistsSync(PRESENT)).toBe(true)
    expect(calls.map((call) => call.arguments.path)).toContain(PRESENT)
    const nodeStats = await nodeLstat(`${process.execPath}`)
    expect(nodeStats.isFile(), "the real fs agrees that a regular file reports isFile").toBe(true)
  })

  it("does not invent presence when the host says nothing about exists", async () => {
    // A host that omits `exists` entirely is a host that said "here it is" — only an explicit false throws.
    installHost({ [PRESENT]: { path: PRESENT, isFile: true, sizeBytes: 1 } })
    await expect(shimStat(PRESENT)).resolves.toBeTruthy()
  })

  it("reports a link as a link under lstat, the way node:fs does", async () => {
    // The host's grant arm answers `lstat` semantics: `isSymlink: true`, `isFile: false`. `dissolvef`'s
    // planner does not read this today, but `linku` does, and Node's own `Stats` distinguishes them.
    installHost({ [PRESENT]: { path: PRESENT, exists: true, isFile: false, isDirectory: false, isSymlink: true, sizeBytes: 12 } })
    const stats = await shimLstat(PRESENT)
    expect(stats.isSymbolicLink()).toBe(true)
    expect(stats.isFile()).toBe(false)
    const real = await nodeLstat(`${process.execPath}`)
    expect(real.isSymbolicLink(), "a regular file is not a link in Node either").toBe(false)
  })
})
