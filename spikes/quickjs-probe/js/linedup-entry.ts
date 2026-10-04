// Spike entry for the linedup node: the same artifact runs under QuickJS (through the probe) and
// under bun, so the two engines can be diffed on identical code. The cases are ported verbatim from
// `packages/nodes/linedup/src/core.test.ts`, which is the node's own oracle — assertions are not
// allowed to change to make an engine look better.
import {
  analyzeReadLines,
  createDiffRows,
  explainRemovals,
  filterLines,
  findDuplicateLines,
  splitLines,
  uniqueNonEmptyLines,
} from "../../../packages/nodes/linedup/src/core"

interface ProbeCase {
  name: string
  run: () => unknown
  expected: unknown
  /**
   * Reported but not counted: the locale case has no hand-written expectation on purpose, because
   * the *current runtime's* answer is the oracle and hard-coding one would just re-encode my guess.
   * The comparison is bun's report against QuickJS's report, field by field.
   */
  informational?: boolean
}

const cases: ProbeCase[] = [
  {
    name: "normalizes and deduplicates non-empty lines",
    run: () => uniqueNonEmptyLines([" a ", "", "a", "b"]),
    expected: ["a", "b"],
  },
  {
    name: "removes lines containing any filter token",
    run: () => {
      const result = filterLines({
        sourceLines: ["alpha", "beta-one", "gamma", "beta-two"],
        filterLines: ["beta"],
      })
      return [result.filteredLines, result.removedLines, result.keptCount, result.removedCount]
    },
    expected: [["alpha", "gamma"], ["beta-one", "beta-two"], 2, 2],
  },
  {
    name: "creates diff rows from source and filtered output",
    run: () => createDiffRows(splitLines("keep\nremove"), ["keep"]),
    expected: [
      { line: "keep", status: "kept" },
      { line: "remove", status: "removed" },
    ],
  },
  {
    name: "finds duplicate lines with counts",
    run: () => [...findDuplicateLines(["a", "b", "a", "c", "b", "a", ""]).entries()].sort(),
    expected: [["a", 3], ["b", 2]],
  },
  {
    name: "analyzes read lines into total, unique, and duplicate stats",
    run: () => {
      const stats = analyzeReadLines(["alpha", "beta", "alpha", "", "gamma"])
      return [stats.totalLines, stats.uniqueLines, [...stats.duplicates.entries()]]
    },
    expected: [4, 3, [["alpha", 2]]],
  },
  {
    name: "explains which filter token matched each removed line",
    run: () => explainRemovals(["alpha", "beta-one", "gamma", "beta-two"], ["beta", "gamma"]),
    expected: [
      { line: "beta-one", matchedFilter: "beta" },
      { line: "gamma", matchedFilter: "gamma" },
      { line: "beta-two", matchedFilter: "beta" },
    ],
  },
  {
    name: "explainRemovals respects case sensitivity",
    run: () => [
      explainRemovals(["Alpha", "BETA"], ["alpha"]),
      explainRemovals(["Alpha", "BETA"], ["alpha"], false),
    ],
    expected: [[], [{ line: "Alpha", matchedFilter: "alpha" }]],
  },
  {
    // Not from the test file: this case exists to show whether the engine's collation matches the
    // one the current TS runtime produced. `core.ts:115` sorts with
    // `localeCompare(b, undefined, { numeric: true, sensitivity: "base" })`.
    name: "sorts with the runtime's locale collation (informational)",
    run: () => filterLines({ sourceLines: ["zebra", "äpfel", "apfel"], filterLines: [] }).filteredLines,
    expected: null,
    informational: true,
  },
]

function report(): string {
  const results = cases.map((testCase) => {
    let actual: unknown
    let error: string | null = null
    try {
      actual = testCase.run()
    } catch (caught) {
      error = String(caught)
    }
    const matches = error === null && JSON.stringify(actual) === JSON.stringify(testCase.expected)
    return {
      name: testCase.name,
      informational: testCase.informational === true,
      matches: testCase.informational === true ? null : matches,
      expected: testCase.expected,
      actual: error ?? actual,
    }
  })
  const asserted = results.filter((entry) => !entry.informational)
  const engine =
    typeof (globalThis as { process?: { version?: string } }).process?.version === "string"
      ? `node ${(globalThis as { process: { version: string } }).process.version}`
      : "quickjs"
  return JSON.stringify({
    engine,
    passed: asserted.filter((entry) => entry.matches).length,
    total: asserted.length,
    results,
  })
}

;(globalThis as { __nodeEntry?: (input: string) => string }).__nodeEntry = () => report()
