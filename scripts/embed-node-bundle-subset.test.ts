#!/usr/bin/env bun
/**
 * Falsification tests for the `--node` subset arm of `scripts/embed-node-bundles.ts`.
 *
 * "The id disappeared" is only evidence if the same assertion finds the id present in the full build, so
 * every negative arm below is paired with a positive one. Nothing here writes: `--print-registration` is
 * the surface under test, and the signed-in generated table's digest is compared before and after to prove
 * the diagnostic cannot mutate it — the failure mode that would silently retarget every other host.
 *
 * Run with: bun test scripts/embed-node-bundle-subset.test.ts
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { expect, it } from "bun:test"

const repoRoot = resolve(import.meta.dirname, "..")
const script = join(repoRoot, "scripts", "embed-node-bundles.ts")
const registrationPath = join(repoRoot, "crates", "xiranite-scripted-nodes", "src", "registration.rs")

function printRegistration(args: string[] = []): string {
  return execFileSync("bun", [script, "--print-registration", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  })
}

function registeredIds(text: string): string[] {
  const clause = /pub const SCRIPTED_NODE_IDS: &\[&str\] = &\[([^\]]*)\]/.exec(text)?.[1] ?? ""
  return [...clause.matchAll(/"([^"]+)"/g)].map((found) => found[1] as string)
}

it("the full build registers more than one node, so a subset can differ from it", () => {
  expect(registeredIds(printRegistration()).length).toBeGreaterThanOrEqual(2)
})

it("--node keeps exactly the requested id, and the full build really had the other one", () => {
  const all = registeredIds(printRegistration())
  const kept = all[0] as string
  const dropped = all[1] as string
  expect(registeredIds(printRegistration(["--node", kept]))).toEqual([kept])
  // The positive control for the line above: without it, an empty subset would pass the same way.
  expect(all).toContain(dropped)
})

it("an excluded node stays in the table with a reason naming --node", () => {
  const kept = registeredIds(printRegistration())[0] as string
  expect(printRegistration(["--node", kept])).toContain("--node")
  expect(printRegistration()).not.toContain("--node")
})

it("--print-registration leaves the signed-in generated table byte-identical", async () => {
  const before = createHash("sha256").update(await readFile(registrationPath)).digest("hex")
  printRegistration(["--node", registeredIds(printRegistration())[0] as string])
  const after = createHash("sha256").update(await readFile(registrationPath)).digest("hex")
  expect(after).toBe(before)
})

it("an unknown --node id is refused rather than silently shrinking the host", () => {
  let captured = ""
  try {
    printRegistration(["--node", "no-such-node-id"])
    throw new Error("the script accepted an id no embedded bundle carries")
  } catch (error) {
    captured = `${(error as { stderr?: string }).stderr ?? ""}${(error as Error).message}`
  }
  expect(captured).toContain("--node names")
})
