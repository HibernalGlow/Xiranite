import { describe, expect, test } from "vitest"

import {
  GATE_PROJECT,
  buildBaseline,
  compareWithBaseline,
  evaluateTypecheckGate,
  parseTscOutput,
  type TypecheckBaseline,
} from "./audit-typecheck-baseline"

const SAMPLE = [
  "src/a.ts(10,3): error TS2322: Type 'string' is not assignable to type 'number'.",
  "  Type 'string' is not assignable to type 'number'.",
  "src/a.ts(11,3): error TS6133: 'unused' is declared but its value is never read.",
  "src/b/c.ts(1,8): error TS2307: Cannot find module './missing'.",
  "",
  "Found 3 errors in 2 files.",
].join("\n")

function baselineOf(byFile: Record<string, number>): TypecheckBaseline {
  return { project: GATE_PROJECT, total: Object.values(byFile).reduce((sum, n) => sum + n, 0), byFile }
}

describe("parseTscOutput", () => {
  test("counts one per primary error line and ignores the indented continuation", () => {
    const parsed = parseTscOutput(SAMPLE)
    expect(parsed.counts).toEqual({ "src/a.ts": 2, "src/b/c.ts": 1 })
    expect(parsed.total).toBe(3)
    expect(parsed.syntaxErrors).toEqual([])
  })

  test("recognises the halting parser diagnostic that collapses every other count", () => {
    const parsed = parseTscOutput('src/plugins/pluginManifestInstall.test.ts(280,1): error TS1005: \'}\' expected.')
    expect(parsed.syntaxErrors).toHaveLength(1)
  })

  test("does not treat a 1xxx non-parser diagnostic as halting", () => {
    const parsed = parseTscOutput("src/x.ts(1,10): error TS1484: 'AddressInfo' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.")
    expect(parsed.syntaxErrors).toEqual([])
    expect(parsed.counts).toEqual({ "src/x.ts": 1 })
  })
})

describe("compareWithBaseline", () => {
  const counts = parseTscOutput(SAMPLE).counts

  test("a file at its baseline number passes", () => {
    const result = compareWithBaseline(baselineOf({ "src/a.ts": 2, "src/b/c.ts": 1 }), counts)
    expect(result.violations).toEqual([])
    expect(result.improved).toEqual([])
  })

  test("one extra error in one file is a violation naming that file", () => {
    const result = compareWithBaseline(baselineOf({ "src/a.ts": 1, "src/b/c.ts": 1 }), counts)
    expect(result.violations).toEqual([{ file: "src/a.ts", current: 2, allowed: 1 }])
  })

  test("growth in one file is not paid for by a fix in another, even when the total drops", () => {
    const result = compareWithBaseline(baselineOf({ "src/a.ts": 5 }), counts)
    expect(result.currentTotal).toBeLessThan(5)
    expect(result.improved).toEqual([{ file: "src/a.ts", current: 2, allowed: 5 }])
    expect(result.violations).toEqual([{ file: "src/b/c.ts", current: 1, allowed: 0 }])
  })

  test("a file the baseline never saw is a violation, so debt cannot move sideways", () => {
    const result = compareWithBaseline(baselineOf({ "src/a.ts": 2 }), counts)
    expect(result.violations.map((entry) => entry.file)).toEqual(["src/b/c.ts"])
  })
})

describe("evaluateTypecheckGate", () => {
  const baseline = baselineOf({ "src/a.ts": 2, "src/b/c.ts": 1 })

  test("passes on the same tree", () => {
    const result = evaluateTypecheckGate({ baseline, output: SAMPLE, exitStatus: 1 })
    expect(result.ok).toBe(true)
    expect(result.unusable).toBeUndefined()
  })

  test("passes when a file went down", () => {
    const result = evaluateTypecheckGate({ baseline: baselineOf({ "src/a.ts": 4, "src/b/c.ts": 1 }), output: SAMPLE, exitStatus: 1 })
    expect(result.ok).toBe(true)
    expect(result.improved.map((entry) => entry.file)).toEqual(["src/a.ts"])
  })

  test("fails when a file went up", () => {
    const result = evaluateTypecheckGate({ baseline: baselineOf({ "src/a.ts": 1, "src/b/c.ts": 1 }), output: SAMPLE, exitStatus: 1 })
    expect(result.ok).toBe(false)
    expect(result.violations.map((entry) => entry.file)).toEqual(["src/a.ts"])
  })

  test("refuses a run that halted on a syntax error, even though the count looks like an improvement", () => {
    const halting = "src/a.ts(3,1): error TS1005: ')' expected."
    const result = evaluateTypecheckGate({ baseline, output: halting, exitStatus: 1 })
    expect(result.ok).toBe(false)
    expect(result.unusable).toBe("syntax-error")
    expect(result.currentTotal).toBeLessThan(baseline.total)
  })

  test("refuses silence from a compiler that did not finish", () => {
    const result = evaluateTypecheckGate({ baseline, output: "error TS5083: Cannot read file.", exitStatus: 2 })
    expect(result.ok).toBe(false)
    expect(result.unusable).toBe("compiler-failure")
  })

  test("refuses a baseline recorded against a different project", () => {
    const result = evaluateTypecheckGate({
      baseline: { ...baseline, project: "tsconfig.json" },
      output: SAMPLE,
      exitStatus: 1,
    })
    expect(result.ok).toBe(false)
    expect(result.unusable).toBe("compiler-failure")
  })
})

describe("buildBaseline", () => {
  test("is the inverse of the comparison it feeds: the same run then passes", () => {
    const counts = parseTscOutput(SAMPLE).counts
    const baseline = buildBaseline(counts)
    expect(baseline.total).toBe(3)
    expect(Object.keys(baseline.byFile)).toEqual(["src/a.ts", "src/b/c.ts"])
    expect(compareWithBaseline(baseline, counts).violations).toEqual([])
    // And the same counts against an empty baseline must be non-zero, or the ratchet grades itself green.
    expect(compareWithBaseline(baselineOf({}), counts).violations).toHaveLength(2)
  })
})
