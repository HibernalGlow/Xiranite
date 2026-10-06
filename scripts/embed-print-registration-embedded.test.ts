/**
 * `--print-registration` must describe the bundles the tree actually embeds.
 *
 * Why this exists: the read-only entry point copies nothing, yet it enumerates every built
 * `artifacts/node-bundles/<id>.js`. Four retained nodes have an artifact but no `bundles/<id>.js`, and
 * `crates/xiranite-scripted-nodes/tests/every_generated_node_is_served.rs` asserts
 * `registered + refused == rows in bundles/index.json`. So a table produced by that entry point — the same one
 * `scripts/build-node-flavor.ts` writes into its temporary window — counted 28 against 24 embedded,
 * i.e. a diagnostic that made the tip's own gate unholdable. A node with no embedded bundle cannot be
 * "refused with a reason"; it is absent.
 *
 * Run with: bunx vitest run --config vitest.scripts.config.ts scripts/embed-print-registration-embedded.test.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(import.meta.dirname, "..")
const script = join(repoRoot, "scripts", "embed-node-bundles.ts")
const embeddedIds = (
  JSON.parse(
    readFileSync(join(repoRoot, "crates", "xiranite-quickjs-executor", "bundles", "index.json"), "utf8"),
  ).nodes as Array<{ id: string }>
).map((entry) => entry.id)

function printRegistration(args: string[]): string {
  return execFileSync("bun", [script, "--print-registration", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
}

function rowsOf(text: string): { registered: string[]; refused: string[] } {
  const ids = /SCRIPTED_NODE_IDS: &\[&str\] = &\[(.*?)\];/s.exec(text)?.[1] ?? ""
  const block = /UNREGISTERED_BUNDLES: &\[\(&str, &str\)\] = &\[(.*?)\n\];/s.exec(text)?.[1] ?? ""
  return {
    registered: [...ids.matchAll(/"([^"]+)"/g)].map((found) => found[1] as string),
    refused: [...block.matchAll(/\("([^"]+)",/g)].map((found) => found[1] as string),
  }
}

describe("the read-only registration entry point", () => {
  it("emits exactly one row per embedded bundle, so the scripted-nodes gate can hold", () => {
    const { registered, refused } = rowsOf(printRegistration([]))
    expect(registered.length + refused.length).toBe(embeddedIds.length)
    expect([...registered, ...refused].sort()).toEqual([...embeddedIds].sort())
  })

  it("names no node whose bundle is built but not embedded", () => {
    // The four rows that made 28 vs 24. Asserted as a set difference so the test says which one slipped.
    const embedded = new Set(embeddedIds)
    const built = JSON.parse(
      readFileSync(join(repoRoot, "docs", "xiranite-target-node-manifest.json"), "utf8"),
    ).nodes as Array<{ id: string; disposition?: string }>
    const notEmbedded = built.filter((node) => node.disposition === "retain-rewrite" && !embedded.has(node.id))
    const { registered, refused } = rowsOf(printRegistration([]))
    for (const node of notEmbedded) {
      expect(registered, `${node.id} must not be registered without an embedded bundle`).not.toContain(node.id)
      expect(refused, `${node.id} has no embedded bundle, so it must not have a refusal row either`).not.toContain(node.id)
    }
    expect(notEmbedded.length).toBeGreaterThan(0)
  })

  it("registers both nodes this batch migrated off the hand-linked side", () => {
    const { registered } = rowsOf(printRegistration([]))
    expect(registered).toContain("dissolvef")
    // `kisaki` joined on 2026-10-06 once the analyzer could name the programs at its `proc.exec` call site
    // and the manifest carried its byte ceiling; it is no longer in `UNREGISTERED_BUNDLES`.
    expect(registered).toContain("kisaki")
  })

  it("keeps the subset entry point consistent too: one requested node, one registered row", () => {
    const { registered, refused } = rowsOf(printRegistration(["--node", "dissolvef"]))
    expect(registered).toEqual(["dissolvef"])
    expect(refused.length).toBe(embeddedIds.length - 1)
  })
})
