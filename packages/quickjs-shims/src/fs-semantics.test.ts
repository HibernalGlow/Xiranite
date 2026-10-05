/**
 * Unit tests for the two rules that decide whether the wired fs members answer like Node. Both are pure, so they
 * run without `__xrh`; the realm side is `spikes/fs-ops-realm-probe/`.
 *
 * `utimesToEpochMs` exists because Node's numeric time argument is **seconds** while the host operation takes
 * **milliseconds** (`fs_operations.rs:108,301-309`). Getting it wrong is not a crash: the call succeeds and every
 * timestamp lands 1000× early. The seconds case is therefore the load-bearing assertion — a build that passed the
 * number straight through fails here, and the `Date` case is the control proving the function is not simply
 * multiplying everything.
 */
import { describe, expect, it } from "vitest"

import { eisdirCopyError, resolveCopyForce, utimesToEpochMs } from "./internal.ts"

describe("utimesToEpochMs follows Node's units", () => {
  it("reads a bare number or numeric string as seconds", () => {
    // Measured on Node 26: utimesSync(f, 1000, 2000) leaves mtimeMs === 2000000.
    expect(utimesToEpochMs(1000, "x")).toBe(1000000)
    expect(utimesToEpochMs("3", "x")).toBe(3000)
    expect(utimesToEpochMs(0, "x")).toBe(0)
  })

  it("reads a Date as its own milliseconds, which is the control for the seconds rule", () => {
    expect(utimesToEpochMs(new Date(1700000000123), "x")).toBe(1700000000123)
  })

  it("reads a date string through Date.parse, not as seconds", () => {
    expect(utimesToEpochMs("2020-01-02T03:04:05Z", "x")).toBe(Date.parse("2020-01-02T03:04:05Z"))
  })

  it("refuses the inputs Node refuses instead of guessing a time", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, new Date("nope"), "not a date"]) {
      expect(() => utimesToEpochMs(bad, "fs.utimes atime"), String(bad)).toThrow(TypeError)
    }
  })
})

describe("resolveCopyForce reproduces Node's copy defaults", () => {
  it("overwrites by default, because Node's copyFile does", () => {
    expect(resolveCopyForce({}, "fs.promises.copyFile")).toBe(true)
    expect(resolveCopyForce({ mode: 0 }, "fs.promises.copyFile")).toBe(true)
  })

  it("fails on an existing target only when COPYFILE_EXCL is set", () => {
    expect(resolveCopyForce({ mode: 1 }, "fs.promises.copyFile")).toBe(false)
  })

  it("honours cp's force, and lets errorOnExist refuse only when force is off", () => {
    expect(resolveCopyForce({ force: false }, "fs.promises.cp")).toBe(false)
    expect(resolveCopyForce({ errorOnExist: true }, "fs.promises.cp")).toBe(false)
    expect(resolveCopyForce({ force: true, errorOnExist: true }, "fs.promises.cp")).toBe(true)
  })

  it("refuses a non-integer mode flag", () => {
    expect(() => resolveCopyForce({ mode: -1 }, "fs.copyFileSync")).toThrow(TypeError)
    expect(() => resolveCopyForce({ mode: 1.5 }, "fs.copyFileSync")).toThrow(TypeError)
  })
})

describe("eisdirCopyError carries Node's code", () => {
  it("is the error Node throws for a directory cp without recursive", () => {
    const error = eisdirCopyError("/tmp/tree")
    expect(error.code).toBe("ERR_FS_EISDIR")
    expect(error.path).toBe("/tmp/tree")
    expect(error.message).toContain("EISDIR")
  })
})
