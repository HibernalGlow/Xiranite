/**
 * `--registration-only` regenerates the descriptor table from committed inputs and copies no bundle.
 *
 * Why this exists: until 2026-10-06 the only way to put a node into `registration.rs` was a full embed, which
 * also rewrites every `bundles/<id>.js` from `artifacts/node-bundles/`. With a sibling migration in flight that
 * means a grant change in one node ships someone else's half-finished core — and the table cannot be committed
 * without it, because a node the host serves with no table row is a node nobody serves. So the two outputs
 * needed separating, and this file is the ruler that says the separation holds: the table changes, the bundle
 * bytes do not.
 *
 * The destructive arm writes a marker into the generated file on purpose. The original bytes are captured before
 * the run and restored from that copy in `finally`, and the restored file is read back and compared, so a failed
 * run cannot leave the tree holding a subset table.
 *
 * Run with: bunx vitest run --config vitest.scripts.config.ts scripts/embed-registration-only.test.ts
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(import.meta.dirname, "..")
const script = join(repoRoot, "scripts", "embed-node-bundles.ts")
const registrationPath = join(repoRoot, "crates", "xiranite-scripted-nodes", "src", "registration.rs")
const bundlesDir = join(repoRoot, "crates", "xiranite-quickjs-executor", "bundles")

const digest = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex")

function bundleDigests(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(bundlesDir).sort()) out[name] = digest(readFileSync(join(bundlesDir, name)))
  return out
}

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bun", [script, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    return { status: 0, stdout, stderr: "" }
  } catch (failure) {
    const error = failure as { status?: number; stdout?: string; stderr?: string }
    return { status: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }
  }
}

function registeredIds(text: string): string[] {
  const ids = /SCRIPTED_NODE_IDS: &\[&str\] = &\[(.*?)\];/s.exec(text)?.[1] ?? ""
  return [...ids.matchAll(/"([^"]+)"/g)].map((found) => found[1] as string)
}

/** Restores the captured bytes and reads them back, so a silent write failure cannot pass as a clean exit. */
function restore(bytes: string): void {
  writeFileSync(registrationPath, bytes)
  if (readFileSync(registrationPath, "utf8") !== bytes) {
    throw new Error("registration.rs could not be restored to the bytes captured before this run")
  }
}

describe("the table-only write path", () => {
  it("replaces a hand-damaged table and touches no bundle byte", () => {
    const original = readFileSync(registrationPath, "utf8")
    const bundlesBefore = bundleDigests()
    try {
      // The falsification: an inert flag leaves this marker in the file, and a flag that copies bundles
      // as a side effect would show up in the digest map below.
      writeFileSync(registrationPath, `${original}\n/// scratch marker written by scripts/embed-registration-only.test.ts\n`)
      const { status, stdout } = run(["--registration-only"])
      expect(status).toBe(0)
      expect(stdout).toContain("no bundle copied")
      const after = readFileSync(registrationPath, "utf8")
      expect(after).not.toContain("scratch marker")
      expect(after).toBe(original)
    } finally {
      restore(original)
    }
    expect(bundleDigests()).toEqual(bundlesBefore)
  })

  it("writes the same table the read-only diagnostic emits", () => {
    const original = readFileSync(registrationPath, "utf8")
    try {
      expect(run(["--registration-only"]).status).toBe(0)
      const fromDisk = readFileSync(registrationPath, "utf8")
      const fromDiagnostic = run(["--print-registration"]).stdout
      expect(registeredIds(fromDisk).sort()).toEqual(registeredIds(fromDiagnostic).sort())
      expect(fromDisk).toBe(fromDiagnostic)
    } finally {
      restore(original)
    }
  })

  it("refuses to mean --check, --print-registration or --refresh", () => {
    for (const extra of [["--check"], ["--print-registration"], ["--refresh", "classq"]]) {
      const result = run(["--registration-only", ...extra])
      const joined = `${result.stdout}${result.stderr}`
      expect(result.status, `--registration-only ${extra.join(" ")} must not write`).not.toBe(0)
      expect(joined).toContain("--registration-only writes the generated table")
    }
  })

  it("refuses a manifest override, because a write path may read only the single authority", () => {
    const result = run(["--registration-only", "--manifest", "docs/xiranite-target-node-manifest.json"])
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain("--manifest only means --print-registration")
  })

  it("spells the migrated nodes and no node whose grants are still unnamed", () => {
    const ids = registeredIds(readFileSync(registrationPath, "utf8"))
    expect(ids).toContain("dissolvef")
    expect(ids).toContain("kisaki")
    // `bitv`'s `proc.exec(command)` site still has no name, so its row is a refusal, not a descriptor.
    expect(ids).not.toContain("bitv")
  })
})
