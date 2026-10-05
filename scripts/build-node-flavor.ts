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
 *           [--config <tauri overlay>] [--frontend] [--verify-host] [--debug] [--dry-run]
 *
 * `--frontend` adds the other half of the same bargain. The webview builds its node rail, module library and
 * dashboards from a checked-in generated table and never asks the host what exists, so a subset host behind
 * the full table ships a product whose extra entries open into failures. That table is regenerated under
 * `XIRANITE_BUILD_ONLY_NODES`, which dirties four checked-in files instead of one, and every one of them is
 * given back by the `finally` below with the same digest verification.
 */
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { flavourMismatch, servedIdsFromLog } from "./lib/node-flavor-assert.ts"
import { crateNames, gateLooksInert, inertGateHint } from "./lib/feature-effectiveness.ts"
import { keptEngineFeatures } from "./lib/node-feature-set.ts"
import {
  regenerateFrontendTables,
  flavorOutDir,
  frontendNodeIds,
  frontendSubsetMismatch,
  restoreFrontendArtifacts,
  snapshotFrontendArtifacts,
  type ArtifactSnapshot,
} from "./lib/node-flavor-frontend.ts"

/**
 * Prove each requested gate changes the graph, before spending a build on it.
 *
 * Runs unconditionally whenever any gate carries a package prefix, because a flag nobody passes is a check
 * nobody benefits from. The comparison is the real thing: two resolved dependency sets under two actual
 * feature combinations, not a parsed Cargo.toml.
 */
function verifyGates(specs: string[], hostPackage = "xiranite-builtin-host"): string[] {
  const gates = specs.map((spec) => spec.replace("--features=", "")).filter((spec) => spec.includes("/"))
  if (gates.length === 0) return []
  const tree = (args: string[]): Set<string> =>
    crateNames(execFileSync("cargo", ["tree", "-p", hostPackage, "-e", "normal", "--prefix", "none", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    }))
  const baseline = tree(["--no-default-features"])
  if (baseline.size === 0) throw new Error(`cargo tree -p ${hostPackage} produced nothing to compare against`)
  const inert: string[] = []
  for (const gate of gates) {
    if (gateLooksInert(baseline, tree(["--no-default-features", `--features=${gate}`]))) {
      inert.push(inertGateHint(gate, hostPackage))
    }
  }
  return inert
}

const repoRoot = resolve(import.meta.dirname, "..")
const embedScript = join(repoRoot, "scripts", "embed-node-bundles.ts")
/**
 * The manifest's services for these nodes — the only legitimate answer to "which engines does this flavour
 * need". Reading it rather than asking the caller keeps a flavour from shipping a host that cannot answer
 * its own node, which `manifest_services_are_answered.rs` would then fail at build time.
 */
async function declaredServicesFor(nodes: readonly string[], manifestPath?: string | null): Promise<string[]> {
  // One policy source per run: `--manifest` redirects the grants for the whole flavour, not just for the
  // registration table, or the feature derivation and the table would be read off two different documents.
  const path = manifestPath ?? join(repoRoot, "docs", "xiranite-target-node-manifest.json")
  const document = JSON.parse(await readFile(path, "utf8")) as {
    nodes: Array<{ id: string; services?: string[] }>
  }
  const wanted = new Set(nodes)
  return [...new Set(document.nodes.filter((node) => wanted.has(node.id)).flatMap((node) => node.services ?? []))].sort()
}

/**
 * Cargo `--features` arguments for one flavour.
 *
 * A bare name is a `xiranite-core` capability gate (the five §9.3 features); a name containing `/` is passed
 * through because the engine gates live in the forwarding crate (`czkawka`/`findz` in
 * `xiranite-builtin-host`, one link above the executor that owns them). The reserved word `engines:auto`
 * derives the engine set from the manifest and switches to `--no-default-features`, since both engines are
 * in `default` and leaving that on would re-add every one of them no matter what was asked for.
 */
async function buildFeatureArgs(plan: Plan): Promise<string[]> {
  const auto = plan.features.includes("engines:auto")
  const explicit = plan.features.filter((name) => name !== "engines:auto")
  const specs = explicit.map((name) => (name.includes("/") ? name : `xiranite-core/${name}`))
  if (!auto) return specs.map((spec) => `--features=${spec}`)
  // Both halves are kept: an explicit capability gate plus the engines this flavour actually declares.
  // Dropping the explicit list here would silently build something other than what was asked for.
  const kept = keptEngineFeatures(await declaredServicesFor(plan.nodes, plan.manifest))
  return ["--no-default-features", ...[...specs, ...kept].map((spec) => `--features=${spec}`)]
}

/** `tauri build` resolves `tauri.conf.json` relative to the app directory, not the workspace root. */
const desktopAppDir = join(repoRoot, "crates", "xiranite-desktop")

/**
 * Which tauri to invoke. The repo-local `bunx tauri` is broken here — `node_modules/@tauri-apps/` carries
 * only `cli`, no `cli-darwin-arm64` — while the global install at `~/.bun/bin/tauri` reports
 * `tauri-cli 3.0.0-alpha.4`, which is the version `crates/xiranite-desktop/Cargo.toml` depends on. Preferring
 * the working binary avoids the one action that would damage other lanes: `bun add` in this repo rewrites
 * the lockfile another lane is holding. `--tauri-bin` overrides either choice.
 */
function tauriInvocation(bin: string | null): { command: string; prefix: string[] } {
  // A launcher named something other than `tauri` needs the subcommand spelled out; passing `--tauri-bin
  // bunx` must not silently become `bunx build`, which would invoke whatever `build` means to bunx.
  const needsSubcommand = (path: string) => basename(path) !== "tauri"
  if (bin !== null) return { command: bin, prefix: needsSubcommand(bin) ? ["tauri"] : [] }
  const globalTauri = join(process.env["HOME"] ?? "", ".bun", "bin", "tauri")
  if (existsSync(globalTauri)) return { command: globalTauri, prefix: [] }
  return { command: "bunx", prefix: ["tauri"] }
}
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
  /** Explicit tauri CLI path; defaults to whichever of the global / repo-local binaries actually loads. */
  tauriBin: string | null
  /** Start the headless product host under the subset and read its own audit line back. */
  verifyHost: boolean
  /**
   * Bundle in the dev profile (`tauri build -d`). Wanted because the alternative is a release build that
   * competes for the same target directory another lane is compiling into — on 2026-10-06 a release
   * `xiranite-dev-host` build was already running when this flavour was first packaged.
   */
  debug: boolean
  /**
   * Also shrink the webview's generated node table for the same ids, and give the four checked-in artifacts
   * back afterwards. Without it the flavour ships the full 28-entry rail against a host that serves one node.
   */
  frontend: boolean
  /**
   * Read the node policy from another file — the same read-only override `embed-node-bundles.ts` allows, and
   * for the same reason: a node whose grants are still being named has no other way to reach a flavour build,
   * and a diagnostic must not be made by editing the checked-in manifest. Nothing here writes; the signed-in
   * manifest keeps stating what the real build may reach.
   */
  manifest: string | null
}

function parseArgs(argv: string[]): Plan {
  const nodes: string[] = []
  const features: string[] = []
  let config: string | null = null
  let dryRun = false
  let skipBuild = false
  let tauriBin: string | null = null
  let verifyHost = false
  let debug = false
  let frontend = false
  let manifest: string | null = null
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
      case "--tauri-bin": {
        if (value === undefined || value.startsWith("-")) throw new Error("--tauri-bin wants a path to the tauri CLI")
        tauriBin = value
        index += 1
        break
      }
      case "--verify-host":
        verifyHost = true
        break
      case "--debug":
        debug = true
        break
      case "--frontend":
        frontend = true
        break
      case "--manifest": {
        if (value === undefined || value.startsWith("-")) throw new Error("--manifest wants a path to a node manifest")
        manifest = resolve(value)
        if (!existsSync(manifest)) throw new Error(`--manifest points at nothing: ${manifest}`)
        index += 1
        break
      }
      default:
        throw new Error(`unknown argument ${argument ?? "(empty)"} — expected --node/--features/--config/--tauri-bin/--verify-host/--debug/--frontend/--manifest/--dry-run/--skip-build`)
    }
  }
  if (nodes.length === 0) {
    // Refusing beats building the full host under a flag that looks like it selected something.
    throw new Error("nothing to do: pass at least one --node <id> (a subset build without one is just the default host)")
  }
  return { nodes, features, config, dryRun, skipBuild, tauriBin, verifyHost, debug, frontend, manifest }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function run(command: string, args: string[], cwd: string = repoRoot): void {
  // Printing the directory is the point: the one defect this line can hide is invoking tauri from the
  // workspace root, where it silently reads no tauri.conf.json at all.
  console.log(`$ [cd ${cwd === repoRoot ? "." : cwd.replace(`${repoRoot}/`, "")}] ${command} ${args.join(" ")}`)
  execFileSync(command, args, { cwd, stdio: "inherit" })
}

const plan = parseArgs(process.argv)
const original = await readFile(registrationPath)
const originalDigest = sha256(original)
console.log(`registration.rs digest before: ${originalDigest.slice(0, 12)}`)

/** Declared outside the `try` so the `finally` can give the four webview artifacts back on every path. */
let frontendSnapshots: ArtifactSnapshot[] = []

let exitCode = 0
try {
  // Step 1 — the subset table. `--print-registration` is the only mode allowed to produce it, because it
  // writes nothing else; the plain write mode would also prune bundles/ this build still needs to keep.
  const nodeArgs = plan.nodes.flatMap((id) => ["--node", id])
  const policyArgs = plan.manifest === null ? [] : ["--manifest", plan.manifest]
  if (plan.manifest !== null) {
    console.log(`      POLICY OVERRIDE: reading grants from ${plan.manifest.replace(`${repoRoot}/`, "")}`)
    console.log("      (diagnostic only — the signed-in manifest still decides what a real build may reach)")
  }
  console.log("[1/4] generating the subset registration table")
  const table = execFileSync("bun", [embedScript, "--print-registration", ...nodeArgs, ...policyArgs], {
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

  // Step 1b — the webview's own node table, and the reason a flavour is two artifacts rather than one. The
  // rail, the module library and the dashboards are built from a checked-in generated table and never ask the
  // host which nodes exist, so a subset host behind the full table ships entries that open into failures.
  // The env stays set for the rest of the run on purpose: `tauri build` re-runs `bun run build`, whose first
  // step is this same generator, and without the inherited env it would write the full table back mid-flavour
  // — producing the default app wearing another name.
  if (plan.frontend) {
    // The pair has to be honoured by the bundler, or `--frontend` means "build a one-node app into `dist/`"
    // and the next `tauri build` of the unified app ships that. `vite.config.ts` reads the second key; this is
    // the guard that says so in the flavour command rather than discovering it as a clobbered artifact.
    if (!readFileSync(join(repoRoot, "vite.config.ts"), "utf8").includes("XIRANITE_BUILD_OUT_DIR")) {
      throw new Error(
        "--frontend needs build.outDir to read XIRANITE_BUILD_OUT_DIR, and vite.config.ts does not: " +
          "the subset bundle would land in dist/ and replace the unified app's artifact",
      )
    }
    const outDir = flavorOutDir(plan.nodes)
    process.env["XIRANITE_BUILD_ONLY_NODES"] = [...new Set(plan.nodes)].join(",")
    process.env["XIRANITE_BUILD_OUT_DIR"] = outDir
    frontendSnapshots = await snapshotFrontendArtifacts(repoRoot)
    if (plan.dryRun) {
      console.log(`[1b/4] would regenerate the ${frontendSnapshots.length} node tables for: ${plan.nodes.join(", ")}`)
      console.log(`       and build the webview into ${outDir} instead of dist/`)
    } else {
      const shown = frontendNodeIds(regenerateFrontendTables(repoRoot, plan.nodes))
      console.log(`      the webview would show: ${shown.join(", ") || "none"} -> bundle goes to ${outDir}`)
      const drift = frontendSubsetMismatch(plan.nodes, shown)
      if (drift !== null) {
        throw new Error(
          `the webview table lists [${drift.present.join(", ")}] but this flavour asked for ` +
            `[${drift.expected.join(", ")}] — the filter did not reach the bundle graph`,
        )
      }
    }
  } else {
    console.log("[1b/4] skipped: no --frontend, so the webview keeps every node the table lists")
  }

  const featureArgs = await buildFeatureArgs(plan)
  const tauri = tauriInvocation(plan.tauriBin)
  const appDirLabel = desktopAppDir.replace(`${repoRoot}/`, "")
  const tauriBuildArgs = (config: string): string[] => [
    ...tauri.prefix,
    "build",
    // `-d` before `--config`: the flag order a person reading the printed plan has to reproduce by hand.
    ...(plan.debug ? ["-d"] : []),
    "--config",
    config,
  ]
  if (plan.dryRun) {
    // Planned commands are printed even in dry-run, with the app directory and the resolved CLI, so the
    // invocation shape is testable on a machine whose repo-local tauri binding is missing.
    console.log(`[2/4] would run: cargo build -p xiranite-builtin-host -j 1 ${featureArgs.join(" ")}`)
    console.log(
      plan.config === null
        ? "[3/4] would skip packaging (no --config overlay given)"
        : `[3/4] would run: [cd ${appDirLabel}] ${tauri.command} ${tauriBuildArgs(plan.config).join(" ")}`,
    )
  } else if (plan.skipBuild) {
    console.log("[2/4][3/4] skipped by --skip-build (the table was still written and is about to be restored)")
  } else {
    // Step 2 — the host binary. Kept to `cargo build` on the crate that assembles the registry, so a
    // feature list here is the one §9.4 derived from the tiers, not a hand-typed capability claim.
    const inert = verifyGates(featureArgs)
    if (inert.length > 0) {
      for (const note of inert) console.error(`FAIL  ${note}`)
      throw new Error(
        `${inert.length} requested gate(s) do not change the host graph at all — building this flavour ` +
          "would ship the full capability set while believing it had been trimmed",
      )
    }
    console.log("[2/4] building the host")
    run("cargo", ["build", "-p", "xiranite-builtin-host", "-j", "1", ...featureArgs])

    if (plan.verifyHost) {
      // The headless host starts through the same `stage_from_environment()` the Tauri window uses, so its
      // own audit line is the one piece of evidence that survives the compiler. The throwaway data
      // directory is mandatory, not tidiness: AGENTS.md forbids a diagnostic from reaching the user's live
      // `xiranite.db`, and `XIRANITE_ALLOWED_DIRS` keeps the grant list out of the real home too.
      console.log("[2b] asking the running host what it serves")
      const dataDir = mkdtempSync(join(tmpdir(), "xiranite-flavour-"))
      try {
        run("cargo", ["build", "-p", "xiranite-loopback-host", "--bin", "xiranite-dev-host", "-j", "1"])
        const host = spawnSync(join(repoRoot, "target", "debug", "xiranite-dev-host"), ["--ttl-seconds", "6"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, XIRANITE_DATA_DIR: dataDir, XIRANITE_ALLOWED_DIRS: dataDir },
        })
        if (host.status !== 0) {
          throw new Error(`xiranite-dev-host exited ${host.status}: ${(host.stderr ?? "").slice(0, 300)}`)
        }
        const served = servedIdsFromLog(`${host.stdout ?? ""}${host.stderr ?? ""}`)
        const bad = flavourMismatch(plan.nodes, served)
        if (bad !== null) {
          throw new Error(
            `the running host serves [${bad.served.join(", ")}] but this flavour asked for [${bad.expected.join(", ")}]`,
          )
        }
        console.log(`      audit line confirms: nodes [${served.join(", ")}]`)
      } finally {
        rmSync(dataDir, { recursive: true, force: true })
      }
    }

    // Step 3 — the overlay bundle. Only runs when a config was given; productName/identifier/frontendDist
    // and bundle.resources are the keys an overlay can change, the node set is not one of them (that is
    // step 1's job, which is exactly why this script exists). It runs from the app directory because
    // that is where `tauri.conf.json` lives.
    console.log("[3/4] packaging")
    if (plan.config === null) {
      console.log("      skipped: no --config overlay given (step 3 is optional; steps 1-2 already fixed the node set)")
    } else {
      run(tauri.command, tauriBuildArgs(plan.config), desktopAppDir)
    }
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
  if (frontendSnapshots.length > 0) {
    delete process.env["XIRANITE_BUILD_ONLY_NODES"]
    delete process.env["XIRANITE_BUILD_OUT_DIR"]
    const drift = await restoreFrontendArtifacts(repoRoot, frontendSnapshots)
    for (const entry of drift) {
      console.error(`FATAL: ${entry.path} did not come back byte-identical (${entry.restored} != ${entry.expected})`)
      exitCode = 1
    }
    if (drift.length === 0) {
      console.log(`      frontend tables restored, digests verified: ${frontendSnapshots.length} file(s)`)
    }
  }
}

process.exit(exitCode)
