#!/usr/bin/env bun
/**
 * One command for ADR-0069 route A: build a host that serves exactly the named nodes.
 *
 * Why this exists instead of "just run embed --node then cargo build by hand": the generated table
 * `crates/xiranite-scripted-nodes/src/registration.rs` is a checked-in artifact, and `--check` mode
 * (`bun run audit:node-bundles`, wired into `.github/workflows/ci.yml`) compares it against the *full*
 * retained-node manifest. So a subset build leaves the tree in a state the gate calls stale — a person
 * who forgets to undo it does not get a customised app, they get a red CI on someone else's next commit.
 * This script makes the undo unconditional (a `finally`, byte-for-byte, verified by digest) and never
 * touches `bundles/`, which the subset deliberately does not prune.
 *
 * The generated file is restored from bytes read at start-up, not from `git checkout HEAD --`, because
 * another lane may hold uncommitted work in that very file; restoring from HEAD would silently drop it.
 *
 * Run with: bun scripts/build-node-flavor.ts --node <id> [--node <id> …] [--features a,b]
 *           [--config <tauri overlay>] [--dry-run]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const embedScript = join(repoRoot, "scripts", "embed-node-bundles.ts")
const registrationPath = join(
  repoRoot,
  "crates",
  "xiranite-scripted-nodes",
  "src",
  "registration.rs",
)

interface Plan {
  nodes: string[]
  features: string[]
  config: string | null
  dryRun: boolean
  /**
   * Write the subset table and restore it, without compiling. Exists because `--dry-run` never writes, so
   * the write-and-restore path — the one that can leave the checked-in artifact dirty — would otherwise have
   * no test that reaches it.
   */
  skipBuild: boolean
}

function parseArgs(argv: string[]): Plan {
  const nodes: string[] = []
  const features: string[] = []
  let config: string | null = null
  let dryRun = false
  let skipBuild = false
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]
    switch (argument) {
      case "--node": {
        if (value === undefined || value.startsWith("-")) throw new Error("--node wants a node id")
        nodes.push(value)
        index += 1
        break
      }
      case "--features": {
        if (value === undefined || value.startsWith("-")) throw new Error("--features wants a comma-separated list")
        features.push(...value.split(",").map((name) => name.trim()).filter((name) => name !== ""))
        index += 1
        break
      }
      case "--config": {
        if (value === undefined || value.startsWith("-")) throw new Error("--config wants a tauri overlay path")
        config = value
        index += 1
        break
      }
      case "--dry-run":
        dryRun = true
        break
      case "--skip-build":
        skipBuild = true
        break
      default:
        throw new Error(`unknown argument ${argument ?? "(empty)"} — expected --node/--features/--config/--dry-run/--skip-build`)
    }
  }
  if (nodes.length === 0) {
    // Refusing beats building the full host under a flag that looks like it selected something.
    throw new Error("nothing to do: pass at least one --node <id> (a subset build without one is just the default host)")
  }
  return { nodes, features, config, dryRun, skipBuild }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function run(command: string, args: string[]): void {
  console.log(`$ ${command} ${args.join(" ")}`)
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" })
}

const plan = parseArgs(process.argv)
const original = await readFile(registrationPath)
const originalDigest = sha256(original)
console.log(`registration.rs digest before: ${originalDigest.slice(0, 12)}`)

let exitCode = 0
try {
  // Step 1 — the subset table. `--print-registration` is the only mode allowed to produce it, because it
  // writes nothing else; the plain write mode would also prune bundles/ this build still needs to keep.
  const nodeArgs = plan.nodes.flatMap((id) => ["--node", id])
  console.log("[1/4] generating the subset registration table")
  const table = execFileSync("bun", [embedScript, "--print-registration", ...nodeArgs], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  const served = /pub const SCRIPTED_NODE_IDS: &\[&str\] = &\[([^\]]*)\]/.exec(table)?.[1] ?? ""
  const ids = [...served.matchAll(/"([^"]+)"/g)].map((found) => found[1] as string)
  console.log(`      this host would serve: ${[...plan.nodes].sort().join(", ")} -> table lists ${ids.length} id(s): ${ids.join(", ") || "none"}`)
  if (ids.length !== plan.nodes.length) {
    throw new Error(
      `asked for ${plan.nodes.length} node(s) but the table registered ${ids.length} — ` +
        "the missing ones are refused by the generator for a reason printed above; a flavour that quietly " +
        "serves fewer nodes than requested is not the flavour that was asked for",
    )
  }
  if (plan.dryRun) {
    console.log("[dry-run] skipping the write, the cargo build, and the tauri bundle")
  } else {
    await writeFile(registrationPath, table)
  }

  if (!plan.dryRun && !plan.skipBuild) {
    // Step 2 — the host binary. Kept to `cargo build` on the crate that assembles the registry, so a
    // feature list here is the one §9.4 derived from the tiers, not a hand-typed capability claim.
    console.log("[2/4] building the host")
    run("cargo", ["build", "-p", "xiranite-builtin-host", "-j", "1", ...plan.features.map((name) => `--features=xiranite-core/${name}`)])

    // Step 3 — the overlay bundle. Only runs when a config was given; productName/identifier/frontendDist
    // and bundle.resources are the keys an overlay can change, the node set is not one of them (that is
    // step 1's job, which is exactly why this script exists).
    console.log("[3/4] packaging")
    if (plan.config === null) {
      console.log("      skipped: no --config overlay given (step 3 is optional; steps 1-2 already fixed the node set)")
    } else {
      run("bunx", ["tauri", "build", "--config", plan.config])
    }
  } else if (!plan.dryRun) {
    console.log("[2/4][3/4] skipped by --skip-build (the table was still written and is about to be restored)")
  }

  // Step 4 — the gate would otherwise stay red for the next person.
  console.log("[4/4] restoring the checked-in table")
} catch (error) {
  exitCode = 1
  console.error(`flavour build failed: ${(error as Error).message}`)
} finally {
  await writeFile(registrationPath, original)
  const restored = sha256(await readFile(registrationPath))
  if (restored !== originalDigest) {
    console.error(`FATAL: registration.rs did not come back byte-identical (${restored.slice(0, 12)} != ${originalDigest.slice(0, 12)})`)
    exitCode = 1
  } else {
    console.log(`      restored, digest verified: ${restored.slice(0, 12)}`)
  }
}

process.exit(exitCode)
