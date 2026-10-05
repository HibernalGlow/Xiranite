#!/usr/bin/env bun
/**
 * Falsification tests for `scripts/build-node-flavor.ts` — the route A command.
 *
 * The property that matters is not "it can build a subset" but "it never leaves the subset behind":
 * `registration.rs` is a checked-in artifact and `audit:node-bundles --check` compares it against the full
 * manifest, so a forgotten undo turns the next person's CI red. Every arm below therefore re-reads the
 * digest after the command runs, including the arms that are expected to fail.
 *
 * Run with: bun test scripts/build-node-flavor.test.ts
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { expect, it } from "bun:test"

const repoRoot = resolve(import.meta.dirname, "..")
const script = join(repoRoot, "scripts", "build-node-flavor.ts")
const registrationPath = join(
  repoRoot,
  "crates",
  "xiranite-scripted-nodes",
  "src",
  "registration.rs",
)

async function digest(): Promise<string> {
  return createHash("sha256").update(await readFile(registrationPath)).digest("hex")
}

function attempt(args: string[]): { out: string; failed: boolean } {
  try {
    return { out: execFileSync("bun", [script, ...args], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), failed: false }
  } catch (error) {
    const runner = error as { stdout?: string; stderr?: string; message?: string }
    return { out: `${runner.stdout ?? ""}${runner.stderr ?? ""}${runner.message ?? ""}`, failed: true }
  }
}

it("a registered node is served, and the checked-in table survives the run", async () => {
  const before = await digest()
  const run = attempt(["--node", "classq", "--dry-run"])
  expect(run.failed).toBe(false)
  expect(run.out).toContain("table lists 1 id(s): classq")
  expect(await digest()).toBe(before)
})

it("a node the generator refuses fails the build instead of shrinking it silently", async () => {
  const before = await digest()
  // recycleu has an embedded bundle but is not registrable (no byte ceiling), so a subset build that
  // quietly produced an empty host would be the failure mode this guard exists to stop.
  const run = attempt(["--node", "recycleu", "--dry-run"])
  expect(run.failed).toBe(true)
  expect(run.out).toContain("the table registered 0")
  expect(await digest()).toBe(before)
})

it("the digest is verified on the failure path, not just the happy one", async () => {
  const run = attempt(["--node", "recycleu", "--dry-run"])
  expect(run.out).toContain("restored, digest verified")
})

it("asking for no node is refused rather than building the default host", () => {
  const run = attempt(["--dry-run"])
  expect(run.failed).toBe(true)
  expect(run.out).toContain("nothing to do")
})

it("the write-and-restore path leaves no trace either", async () => {
  const before = await digest()
  // --dry-run never writes, so without this arm the code path that can actually dirty a checked-in
  // artifact would go untested. --skip-build writes it for real and restores it in the same run.
  const run = attempt(["--node", "classq", "--skip-build"])
  expect(run.failed).toBe(false)
  expect(run.out).toContain("skipped by --skip-build")
  expect(run.out).toContain("restored, digest verified")
  expect(await digest()).toBe(before)
})

it("the planned package command runs from the app directory, not the workspace root", () => {
  // --tauri-bin pins the command name so the directory assertion below is about the directory, not about
  // which of this machine's two tauri installs happens to resolve.
  const run = attempt(["--node", "classq", "--dry-run", "--config", "tauri.conf.classq.json", "--tauri-bin", "bunx"])
  expect(run.failed).toBe(false)
  expect(run.out).toContain("[cd crates/xiranite-desktop] bunx tauri build --config tauri.conf.classq.json")
  // From the repo root tauri would read no tauri.conf.json at all, so the directory is the assertion.
  expect(run.out).not.toContain("[cd .] bunx tauri build")
})

it("a tauri CLI is resolved and printed rather than left to an unresolvable bunx", () => {
  const run = attempt(["--node", "classq", "--dry-run", "--config", "overlay.json"])
  expect(run.out).toMatch(/\[cd crates\/xiranite-desktop\] \S+ build --config overlay\.json/)
})

it("a feature list is passed through as core features rather than dropped", () => {
  const run = attempt(["--node", "classq", "--dry-run", "--features", "clipboard,power"])
  expect(run.out).toContain("--features=xiranite-core/clipboard --features=xiranite-core/power")
})

it("an unknown flag is refused instead of being read as a node id", () => {
  const run = attempt(["--nod", "classq"])
  expect(run.failed).toBe(true)
  expect(run.out).toContain("unknown argument")
})
