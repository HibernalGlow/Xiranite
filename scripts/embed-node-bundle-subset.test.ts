#!/usr/bin/env bun
/**
 * Falsification tests for the `--node` subset arm of `scripts/embed-node-bundles.ts`.
 *
 * "The id disappeared" is only evidence if the same assertion finds the id present in the full build, so
 * every negative arm below is paired with a positive one. Nothing here writes: `--print-registration` is
 * the surface under test, and the signed-in generated table's digest is compared before and after to prove
 * the diagnostic cannot mutate it — the failure mode that would silently retarget every other host.
 * The deadline tests write a policy copy under the system temp dir (never inside the repository) and feed
 * it to that same diagnostic; the guard that keeps `--manifest` off the write path is its own test.
 *
 * Run with: bun test scripts/embed-node-bundle-subset.test.ts
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "bun:test"

const repoRoot = resolve(import.meta.dirname, "..")
const script = join(repoRoot, "scripts", "embed-node-bundles.ts")
const registrationPath = join(repoRoot, "crates", "xiranite-scripted-nodes", "src", "registration.rs")
const policyManifestPath = join(repoRoot, "docs", "xiranite-target-node-manifest.json")

function printRegistration(args: string[] = []): string {
  return execFileSync("bun", [script, "--print-registration", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  })
}

/**
 * The same diagnostic against a copy of the real policy with one field changed, written outside the repository
 * so nothing in the tree can be retargeted by a test run.
 */
function printRegistrationWithPolicy(policy: { nodes: Array<Record<string, unknown>> }): string {
  const fixture = join(tmpdir(), `xiranite-embed-policy-${process.pid}-${Date.now()}.json`)
  writeFileSync(fixture, JSON.stringify(policy), "utf8")
  try {
    return execFileSync("bun", [script, "--print-registration", "--manifest", fixture], {
      cwd: repoRoot,
      encoding: "utf8",
    })
  } finally {
    rmSync(fixture, { force: true })
  }
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

it("a node that declares a run deadline gets .run_deadline_ms, and the same fixture without it does not", () => {
  // Every registered node keeps the executor's 120 s default today, so the emission could only be tested against
  // a policy copy: asserting the *absence* in the signed-in table would stay green even with the generator's
  // deadline branch deleted. `sleept` declares one and is still refused registration for a different reason
  // (its unnamed process grant), which is exactly the case a green-by-empty-set gate would have hidden.
  const target = registeredIds(printRegistration())[0] as string
  const policy = JSON.parse(readFileSync(policyManifestPath, "utf8")) as { nodes: Array<Record<string, unknown>> }
  const record = policy.nodes.find((node) => node.id === target)
  expect(record).toBeDefined()

  record!.runDeadlineMs = 1_234_567
  expect(printRegistrationWithPolicy(policy)).toContain(".run_deadline_ms(1234567)")

  // The control: the same fixture with the field taken back out must not emit *that* call. The assertion is
  // written against the number rather than against `.run_deadline_ms(` at all, because other nodes may declare
  // a deadline by now — a state-independent negative leg, which is the whole point of a control.
  delete record!.runDeadlineMs
  expect(printRegistrationWithPolicy(policy)).not.toContain(".run_deadline_ms(1234567)")
})

it("--manifest cannot retarget a real build, only the read-only diagnostic", () => {
  let captured = ""
  try {
    execFileSync("bun", [script, "--manifest", policyManifestPath], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    throw new Error("the write path accepted a second policy file")
  } catch (error) {
    captured = `${(error as { stderr?: string }).stderr ?? ""}${(error as Error).message}`
  }
  expect(captured).toContain("--manifest only means --print-registration")
})
