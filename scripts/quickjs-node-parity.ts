/**
 * `quickjs-node-parity` — run one node's own cases twice: once on the TypeScript platform runtime under
 * Bun (the oracle the node's `core.test.ts` already pins), once inside the embedded QuickJS executor
 * through `quickjs-run` (the host the product ships). Same fixture, same input, then compare.
 *
 * This is the question ADR-0074 leaves open after the engine is embedded: does a real node's core,
 * unmodified, still produce the same *documents* and the same *filesystem state* once its `node:` builtins
 * are answered by Rust instead of by Bun? A bundle that plans the right moves but writes a different tree
 * is not a pass, so both halves of every case are compared.
 *
 * Usage:
 *   bun scripts/quickjs-node-parity.ts --node dissolvef [--case <name>] [--binary <quickjs-run>]
 *                                      [--bundle <combined.js>] [--keep]
 *
 * - `--bundle` is the combined single-file artifact `quickjs-run` loads (`run` + `createRuntime` exported
 *   from one ESM file). The default path is `artifacts/node-bundles/<id>.js`.
 * - `--keep` leaves the fixture trees under `artifacts/.node-parity/` and prints where they are.
 * - `PARITY_VERBOSE=1` also prints both documents.
 *
 * Exit 0 means every selected case matched on both halves. Two things are normalized before comparing,
 * because they are the host's own facts and not the node's: the granted root's absolute path, and the
 * journal id / wall-clock text a run generates (`<ID>`, `<TS>`).
 */
import { mkdir, readlink, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import { cases } from "./quickjs-parity-cases.ts"

const repoRoot = resolve(dirname(import.meta.path), "..")
const outRoot = join(repoRoot, "artifacts", ".node-parity")
const ROOT_MARK = "<ROOT>"
/** `dissolve-<yyyyMMddHHmmss>-<8 hex>` — what `runtime.now()` and `runtime.randomId()` make per run. */
const JOURNAL_ID = /dissolve-\d{14}-[0-9a-f]{8}/g
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g

interface Options {
  node: string
  only: string | null
  binary: string
  bundle: string
  keep: boolean
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] ?? null : null
  }
  const node = flag("node")
  if (!node) throw new Error("usage: quickjs-node-parity.ts --node <id> [...]")
  return {
    node,
    only: flag("case"),
    // The executor lives in the root workspace, so its dev binary is the shared `target/`. It used to point at
    // `crates/xiranite-quickjs-executor/target/`, which only existed while that crate carried its own
    // placeholder workspace; that manifest is gone, so the stale default made the harness fail with ENOENT.
    binary: flag("binary") ?? join(repoRoot, "target", "debug", process.platform === "win32" ? "quickjs-run.exe" : "quickjs-run"),
    bundle: flag("bundle") ?? join(repoRoot, "artifacts", "node-bundles", `${node}.js`),
    keep: argv.includes("--keep"),
  }
}

/** Creates one fixture tree. Both sides get the same layout under different absolute roots. */
async function buildTree(root: string, files: Record<string, string>, dirs: string[]): Promise<void> {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  for (const directory of dirs) await mkdir(join(root, directory), { recursive: true })
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content.replaceAll(ROOT_MARK, root))
  }
}

/**
 * Every path under `root`, as sorted `<kind> <bytes> <relative>` lines.
 *
 * Written with `readdir` rather than `find -printf` because the latter is GNU-only (this repo is developed
 * on macOS too), and a gauge that silently errors on one platform is worse than ten lines of walker.
 */
async function readTree(root: string): Promise<string> {
  const lines: string[] = []
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
      if (entry.isSymbolicLink()) {
        lines.push(`l ./${relative} -> ${await readlink(absolute)}`)
      } else if (entry.isDirectory()) {
        lines.push(`d ./${relative}`)
        await walk(absolute, relative)
      } else {
        // Content, with the granted root spelled back out. Two sides run under roots of different name
        // length, so a journal written with absolute paths differs in *bytes* while being the same
        // document; hashing the normalized content drops that and still catches a real divergence.
        const bytes = await readFile(absolute)
        // Same normalizations as the documents: the granted root, and the journal id / wall-clock text a
        // run generates from the host's entropy and clock. Those are the host's facts, not the node's, so
        // two correct runs legitimately differ in them.
        const normalized = bytes
          .toString("utf8")
          .replaceAll(root, ROOT_MARK)
          .replace(JOURNAL_ID, "<ID>")
          .replace(ISO_TIMESTAMP, "<TS>")
        const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 16)
        lines.push(`f ./${relative} sha=${digest}`)
      }
    }
  }
  await walk(root, "")
  return lines.sort().join("\n")
}

/** Runs one step on the QuickJS host through the dev harness. */
async function runOnQuickjs(
  options: Options,
  spec: (typeof cases)[number],
  root: string,
  input: Record<string, unknown>,
): Promise<{ document: unknown; failure: string | null }> {
  const requestPath = join(root, ".request.json")
  await writeFile(requestPath, `${JSON.stringify(input)}\n`)
  const run = spawnSync(
    options.binary,
    [
      options.bundle,
      spec.run,
      spec.createRuntime ?? "-",
      `@${requestPath}`,
      root,
      "--node-id",
      spec.id,
      "--pretty",
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  if (run.error) throw new Error(`quickjs-run could not start: ${run.error.message}`)
  let document: unknown
  try {
    document = JSON.parse(run.stdout)
  } catch {
    throw new Error(
      `quickjs-run did not answer one JSON document (status ${run.status}). stdout=${run.stdout.slice(0, 400)} stderr=${run.stderr.slice(-800)}`,
    )
  }
  const failure = run.status === 0 ? null : `harness exit ${run.status}: ${run.stderr.trim().split("\n").slice(-2).join(" / ")}`
  await rm(requestPath, { force: true })
  return { document, failure }
}

/** Substitutes a step's `<ROOT>`-prefixed values with that side's own root. */
function localize(value: unknown, root: string): unknown {
  if (typeof value === "string" && value.startsWith(ROOT_MARK)) {
    return join(root, value.slice(ROOT_MARK.length).replace(/^[/\\]+/, ""))
  }
  if (Array.isArray(value)) return value.map((item) => localize(item, root))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, localize(inner, root)]))
  }
  return value
}

/** Runs one case end to end on one side. */
async function runSide(
  options: Options,
  spec: (typeof cases)[number],
  caseIndex: number,
  side: "node" | "quickjs",
): Promise<{ root: string; documents: unknown[]; tree: string; fixtureTree: string; failures: string[] }> {
  const root = join(outRoot, `${options.node}-${caseIndex}-${side}`)
  const entry = spec.cases[caseIndex]!
  await buildTree(root, entry.fixture.files, entry.fixture.dirs ?? [])
  const fixtureTree = await readTree(root)
  const documents: unknown[] = []
  const failures: string[] = []
  for (const step of entry.steps) {
    const input = localize(step.input, root) as Record<string, unknown>
    if (side === "node") {
      const core = await import(join(repoRoot, "packages", "nodes", spec.id, "src", "core.ts"))
      if (spec.createRuntime === null) {
        // A pure node: `node-runner.ts:90` wraps `run(input)` in the envelope.
        documents.push({ success: true, message: spec.pureMessage ?? "", data: await core[spec.run](input) })
      } else {
        const platform = await import(join(repoRoot, "packages", "nodes", spec.id, "src", "platform.ts"))
        documents.push(await core[spec.run](input, platform[spec.createRuntime](), () => undefined))
      }
    } else {
      const { document, failure } = await runOnQuickjs(options, spec, root, input)
      documents.push(document)
      if (failure !== null) failures.push(failure)
    }
  }
  return { root, documents, tree: await readTree(root), fixtureTree, failures }
}

/** The first deep difference between two JSON values, at a path a human can read. */
function firstDifference(left: unknown, right: unknown, trail = "$"): string | null {
  if (Object.is(left, right)) return null
  const bothArray = Array.isArray(left) && Array.isArray(right)
  const bothObject =
    !Array.isArray(left) && !Array.isArray(right) && typeof left === "object" && typeof right === "object"
  if (bothArray) {
    if (left.length !== right.length) return `${trail}: length ${left.length} vs ${right.length}`
    for (let index = 0; index < left.length; index += 1) {
      const found = firstDifference(left[index], right[index], `${trail}[${index}]`)
      if (found) return found
    }
    return null
  }
  if (bothObject) {
    const keys = [...new Set([...Object.keys(left as object), ...Object.keys(right as object)])].sort()
    for (const key of keys) {
      const found = firstDifference(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${trail}.${key}`,
      )
      if (found) return found
    }
    return null
  }
  return `${trail}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`
}

/** What `quickjs-run` writes into a pure node's envelope, because the harness is not the product runner. */
const HARNESS_PURE_MESSAGE = "quickjs-run: node completed"

function report(
  side: { root: string; documents: unknown[]; tree: string; fixtureTree: string; failures: string[] },
  spec: (typeof cases)[number],
): string {
  const text = JSON.stringify(side.documents)
    .replaceAll(side.root, ROOT_MARK)
    // The harness names its own constant as the pure-node message where the product uses the node's
    // `PureNodeSpec.message`. Both sides have to state the same thing or the comparison is about the
    // harness, not the node; only this exact string is touched.
    .replaceAll(JSON.stringify(HARNESS_PURE_MESSAGE), JSON.stringify(spec.pureMessage ?? HARNESS_PURE_MESSAGE))
    .replace(JOURNAL_ID, "<ID>")
    .replace(ISO_TIMESTAMP, "<TS>")
  return text
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))
  const matches = cases.filter((spec) => spec.id === options.node)
  if (matches.length === 0) throw new Error(`no parity cases registered for node ${options.node}`)
  const spec = matches[0]!
  const selected = spec.cases
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => options.only === null || entry.name === options.only)
  if (selected.length === 0) {
    throw new Error(`no case ${options.only} for ${spec.id}; known: ${spec.cases.map((entry) => entry.name).join(", ")}`)
  }

  let failed = 0
  for (const { entry, index } of selected) {
    const nodeSide = await runSide(options, spec, index, "node")
    const quickSide = await runSide(options, spec, index, "quickjs")
    const nodeDocument = report(nodeSide, spec)
    const quickDocument = report(quickSide, spec)
    const nodeTree = nodeSide.tree
    const quickTree = quickSide.tree
    const documentDiff = firstDifference(JSON.parse(nodeDocument), JSON.parse(quickDocument))
    const treeDiff = nodeTree === quickTree ? null : "the trees differ"
    const harness = quickSide.failures.length > 0 ? quickSide.failures.join("; ") : null
    // Gauge self-check: a case that claims to mutate the tree must actually mutate it. Two sides that both
    // did nothing compare equal and would otherwise read as a pass.
    const blind = entry.expectsTreeChange === true && nodeSide.tree === nodeSide.fixtureTree
    const verdict = documentDiff === null && treeDiff === null && harness === null && !blind ? "PASS" : "FAIL"
    if (verdict === "FAIL") failed += 1
    console.log(`${verdict} ${entry.name}${harness === null ? "" : ` [${harness}]`}${blind ? " [the case changed nothing: the gauge is blind]" : ""}`)
    if (documentDiff !== null) console.log(`  document ${documentDiff}`)
    if (treeDiff !== null) {
      console.log(`  ${treeDiff}`)
      const left = nodeTree.split("\n")
      const right = quickTree.split("\n")
      for (const line of left.filter((item) => !right.includes(item))) console.log(`    only node: ${line}`)
      for (const line of right.filter((item) => !left.includes(item))) console.log(`    only qjs:  ${line}`)
    }
    if (process.env.PARITY_VERBOSE === "1") {
      console.log(`  node: ${nodeDocument.slice(0, 1200)}`)
      console.log(`  qjs:  ${quickDocument.slice(0, 1200)}`)
    }
  }
  console.log(`${selected.length - failed}/${selected.length} cases matched on both halves for ${spec.id}`)
  if (!options.keep) await rm(outRoot, { recursive: true, force: true })
  else console.log(`trees kept under ${outRoot}`)
  return failed === 0 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error: unknown) => {
  console.error(`quickjs-node-parity: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
