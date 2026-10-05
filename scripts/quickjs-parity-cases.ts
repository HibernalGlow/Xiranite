/**
 * Parity fixtures for `scripts/quickjs-node-parity.ts`.
 *
 * Every case here is a transcription of a case the node's own `core.test.ts` already pins, so the oracle
 * side (Bun + the real `platform.ts`) has an expectation the repo has already reviewed; this file only
 * replays it against the QuickJS host. `<ROOT>` inside a path *or a file's content* is replaced by that
 * side's own granted root, which is why two identical trees can be compared.
 */

export interface ParityCase {
  /** Named after the `core.test.ts` case it comes from. */
  name: string
  fixture: {
    /** Relative path -> content; `<ROOT>` in the content is substituted. */
    files: Record<string, string>
    /** Directories that must exist even when empty. */
    dirs?: string[]
  }
  /** One run per step, in order; `path`/`historyPath` may name `<ROOT>`. */
  steps: Array<{ input: Record<string, unknown> }>
  /**
   * Set when the case is supposed to leave the tree different from the fixture. The harness then fails the
   * case if *nothing* changed, because two identical sides that both did nothing is a passing comparison with
   * a blind gauge.
   */
  expectsTreeChange?: boolean
}

export interface NodeParity {
  id: string
  /** The export `node-runner.generated.ts` names for `spec.run`. */
  run: string
  /** Null for a pure node, which the contract runs as `core[run](input)` with no platform object. */
  createRuntime: string | null
  /** `PureNodeSpec.message` from the generated table; only set for a pure node. */
  pureMessage?: string
  cases: ParityCase[]
}

const dissolvef: NodeParity = {
  id: "dissolvef",
  run: "runDissolvef",
  createRuntime: "createNodeDissolvefRuntime",
  cases: [
    {
      name: "collect_archives_with_similarity_filter",
      fixture: {
        dirs: ["series_a", "series_b", "alpha"],
        files: {
          "series_a/series_a.zip": "zip",
          "series_b/series_b.zip": "zip",
          "series_b/readme.txt": "extra",
          "alpha/beta.zip": "zip",
        },
      },
      steps: [
        {
          input: {
            action: "collect_archives",
            path: "<ROOT>",
            protectFirstLevel: false,
            similarityThreshold: 0.9,
            skipBlacklist: true,
          },
        },
      ],
    },
    {
      name: "direct_preview_with_rename_conflict",
      fixture: {
        dirs: ["box"],
        files: { "a.txt": "old", "box/a.txt": "new" },
      },
      steps: [{ input: { action: "direct", path: "<ROOT>/box", preview: true, fileConflict: "rename" } }],
    },
    {
      name: "bundle_mode_does_not_double_plan_archive_folders",
      fixture: {
        dirs: ["series_a"],
        files: { "series_a/series_a.zip": "zip" },
      },
      steps: [
        {
          input: {
            action: "dissolve",
            path: "<ROOT>",
            preview: true,
            protectFirstLevel: false,
            similarityThreshold: 0,
            skipBlacklist: true,
          },
        },
      ],
    },
    {
      name: "nested_dissolve_then_undo",
      fixture: {
        dirs: ["a/b/c"],
        files: { "a/b/c/test.txt": "hello" },
      },
      expectsTreeChange: true,
      steps: [
        { input: { action: "nested", path: "<ROOT>/a", historyPath: "<ROOT>/history.json", enableSimilarity: false } },
        { input: { action: "undo", historyPath: "<ROOT>/history.json" } },
      ],
    },
    {
      name: "undo_a_legacy_python_single_record_journal",
      fixture: {
        dirs: ["outer/inner"],
        files: {
          "outer/test.txt": "hello",
          "legacy-undo.json": JSON.stringify({
            id: "dissolve-legacy",
            timestamp: "2026-07-21T16:04:54.445129",
            mode: "nested",
            path: "<ROOT>",
            count: 2,
            operations: [
              { type: "move", src: "<ROOT>/outer/inner/test.txt", dst: "<ROOT>/outer/test.txt", timestamp: "2026-07-21T16:02:57.405605" },
              { type: "delete_dir", src: "<ROOT>/outer/inner", dst: null, timestamp: "2026-07-21T16:02:57.408122" },
            ],
          }),
        },
      },
      steps: [{ input: { action: "undo", historyPath: "<ROOT>/legacy-undo.json" } }],
    },
    {
      name: "undo_resumes_a_partially_applied_journal",
      fixture: {
        dirs: ["inner"],
        files: {
          "inner/test.txt": "already restored",
          "legacy-undo.json": JSON.stringify({
            id: "dissolve-partial",
            timestamp: "2026-07-21T16:04:54.445129",
            mode: "nested",
            path: "<ROOT>",
            count: 1,
            operations: [{ type: "move", src: "<ROOT>/inner/test.txt", dst: "<ROOT>/test.txt" }],
          }),
        },
      },
      steps: [{ input: { action: "undo", historyPath: "<ROOT>/legacy-undo.json" } }],
    },
  ],
}

/**
 * `linedup` is the pure-node arm: no `createRuntime`, no filesystem, logic only. It is included because it
 * isolates one question from the rest — whether the executor's entry/plan/envelope machinery reproduces the
 * TypeScript runner — and because its `caseSensitive: false` path is where the documented locale difference
 * (`Intl` is absent from QuickJS, so `toLocaleLowerCase` and `localeCompare` degrade) actually bites.
 */
const linedup: NodeParity = {
  id: "linedup",
  run: "filterLines",
  createRuntime: null,
  pureMessage: "Filtered lines.",
  cases: [
    {
      name: "removes_lines_containing_any_filter_token",
      fixture: { files: {} },
      steps: [
        {
          input: {
            sourceLines: ["alpha", "beta-one", "gamma", "beta-two"],
            filterLines: ["beta"],
          },
        },
      ],
    },
    {
      name: "trims_dedupes_and_drops_empty_lines",
      fixture: { files: {} },
      steps: [
        {
          input: {
            sourceLines: [" a ", "", "a", "b", "  ", "c"],
            filterLines: [],
            sort: true,
          },
        },
      ],
    },
    {
      name: "case_insensitive_filter_with_non_ascii",
      fixture: { files: {} },
      steps: [
        {
          input: {
            sourceLines: ["Alpha", "ÄPFEL", "apfel", "Zebra"],
            filterLines: ["alpha", "äpfel"],
            caseSensitive: false,
          },
        },
      ],
    },
  ],
}

export const cases: NodeParity[] = [dissolvef, linedup]
