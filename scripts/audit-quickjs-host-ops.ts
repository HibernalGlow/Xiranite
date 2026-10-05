#!/usr/bin/env bun
/**
 * Gate for the QuickJS host operation vocabulary (`docs/adr/0074-…-quickjs-as-one-node-executor.md` §2).
 *
 * The host answers a *closed* list of operations: a bundle's `node:` import reaches Rust through
 * `__xrh.call(op, jsonArgs)`, and a name the host does not resolve is a call failure that only surfaces at
 * run time, inside an operation, on the machine of whoever is running a node. Two files describe that list
 * today — `crates/xiranite-quickjs-executor/src/host_calls.rs` (`HostOperation`) and
 * `packages/quickjs-shims/src/host.ts` (`OPERATIONS_V1`) — and nothing compared them until now. The shim's
 * own README says the list is "defined in src/host.ts and mirrored in crates/…/host_calls.rs", and
 * `surface.ts:30` promises "the audit fails on anything else"; both were written before that audit existed.
 *
 * Why the Rust side is exported by a binary rather than scraped: measuring this gate's inputs by quoting
 * `domain.ident` out of `host_calls.rs` returns 31 names where the enum has 30 — `fs.readRange` is the
 * negative-test fixture at `host_calls.rs:625` ("an invented name must not parse") and `fs.read` is a
 * truncation of `fs.readText`. That is the failure mode AGENTS.md and ADR-0067 warn about, so the list comes
 * from `HostOperation::ALL`, which is what `HostOperation::parse` can actually resolve.
 *
 * Rules, all computed from evaluated values (never from file text):
 *
 *  1. the host vocabulary is non-empty, unique, and every name is `domain.ident`;
 *  2. every operation a shim module declares in its `ModuleSurface.hostOperations` is in `OPERATIONS_V1`
 *     (`surface.ts:30` states this as a requirement, this gate is what enforces it);
 *  3. every operation a shim module calls is answered by the host — a gap here is a run-time refusal;
 *  4. every name `OPERATIONS_V1` declares is answered by the host — a stale declaration promises an
 *     operation the bundle will be refused;
 *  5. every name the host answers that no shim module calls must be accounted for: either some shim member
 *     already names it in its surface entry (`requiredOperation`, or `reason` — the table is not uniform):
 *     tolerated with the members cited, because that is the recorded "the host grew ahead of the shim"
 *     state), or it is written into `UNCONSUMED_BY_SHIMS` with a
 *     reason. Anything else fails, so an operation nobody can explain cannot accumulate.
 *  6. (advisory) a name in `OPERATIONS_V2_REQUESTED` that the host already answers must move into
 *     `OPERATIONS_V1`, or the request list becomes a second source of truth. This one warns: the file it
 *     needs is owned by the shim lane.
 *
 * Failures exit 1. The falsification tests in `scripts/audit-quickjs-host-ops.test.ts` turn every arm red on
 * purpose, because a gate that has never failed is not evidence.
 *
 * Running it: `bun run audit:quickjs-host-ops` builds `print-host-ops` first, which is what CI uses. That
 * build shares `crates/xiranite-quickjs-executor/target/debug/.cargo-lock` with every other lane's cargo run,
 * so it can sit for minutes on `Blocking waiting for file lock` — cargo's own stderr is inherited so the wait
 * reads as a wait, and the elapsed time is printed after. `--use-built-bin` skips only that build step and
 * runs the bin that is already on disk: the vocabulary still comes from the compiled `HostOperation::ALL`, so
 * a stale bin is a visible mistake rather than a silently skipped check.
 */
import { OPERATIONS_V1, OPERATIONS_V2_REQUESTED } from "../packages/quickjs-shims/src/host.ts"
import { MODULE_SURFACES } from "../packages/quickjs-shims/src/surface.ts"

/**
 * Host operations that are answered, not called by any shim module, *and* not named by any shim member's
 * `requiredOperation` — so nothing in the shim layer records why they exist. An op the shim already names as
 * the thing that would unlock a refused member is tolerated by rule 5 with the members cited in the warning;
 * these are the leftovers a human has to account for.
 */
const UNCONSUMED_BY_SHIMS: Record<string, string> = {
  "proc.poll": "spawn-handle protocol half of proc.spawn (crates/xiranite-quickjs-executor/src/proc_operations.rs:66); child_process records proc.spawn as the unlock, and poll/wait/kill only become reachable once spawn is wired.",
  "proc.wait": "spawn-handle protocol half of proc.spawn (crates/xiranite-quickjs-executor/src/proc_operations.rs:66); no shim surface yet.",
  "proc.kill": "spawn-handle protocol half of proc.spawn (crates/xiranite-quickjs-executor/src/proc_operations.rs:77); no shim surface yet.",
  "service.invoke": "host-service passthrough — dispatches to crate::host_services::execute (crates/xiranite-quickjs-executor/src/host_calls.rs:350) and is authorised per registration; no shim surface yet.",
  "os.homedir": "machine-facts op; no shim member names it, and the os surface currently calls only os.tmpdir.",
}

const NAME_PATTERN = /^[a-z][a-z_]*\.[A-Za-z][A-Za-z0-9]*$/
/** The domains the protocol uses, for pulling names out of `OPERATIONS_V2_REQUESTED`'s signature strings. */
const KNOWN_DOMAINS = ["fs", "proc", "os", "crypto", "clock", "service"]
const V2_NAME_PATTERN = new RegExp(`\\b(?:${KNOWN_DOMAINS.join("|")})\\.[A-Za-z][A-Za-z0-9]*\\b`, "g")

interface AuditInput {
  /** The names `HostOperation::ALL` resolves, in declaration order. */
  hostOpNames: readonly string[]
  /** `OPERATIONS_V1` as exported by the shim package. */
  operationsV1: readonly string[]
  /** `OPERATIONS_V2_REQUESTED` as exported (signature-doc strings, not bare names). */
  operationsV2Requested: readonly string[]
  /** The shim module surfaces, with the operations each one calls. */
  surfaces: readonly { module: string; hostOperations: readonly string[] }[]
  /** Operation -> the `module.member` names whose shim code records it as the thing that would unlock them. */
  refusingMembersByOperation: Readonly<Record<string, readonly string[]>>
  /** Ops answered by the host but not called by any shim, with the reason each is tolerated. */
  unconsumedReasons: Readonly<Record<string, string>>
}

interface AuditResult {
  failures: string[]
  warnings: string[]
  summary: string
}

/** `OPERATIONS_V2_REQUESTED` documents signatures ("fs.copy(source, target, { … }) -> null"), so names come out by domain. */
export function operationNamesInV2Request(requests: readonly string[]): string[] {
  const names = new Set<string>()
  for (const request of requests) {
    for (const match of request.matchAll(V2_NAME_PATTERN)) names.add(match[0])
  }
  return [...names].sort()
}

/** `module.member` names whose surface-table entry points at an operation, keyed by operation name. */
export function collectRefusingMembersByOperation(
  surfaces: readonly { module: string; unsupported: readonly { name: string; reason: string; requiredOperation?: string }[] }[],
): Record<string, string[]> {
  const byOperation: Record<string, string[]> = {}
  for (const surface of surfaces) {
    for (const member of surface.unsupported) {
      // The table records the unlocking op in `requiredOperation`, but not always: `surface.ts:149` puts
      // "…must go to the host as fs.readBytes with an offset" in `reason` instead. Both are read, so rule 5
      // tolerates an op the shim has demonstrably thought about and only demands a written decision for the
      // ones nothing in the shim layer references.
      const documents = member.requiredOperation === undefined ? [member.reason] : [member.requiredOperation, member.reason]
      for (const document of documents) {
        for (const match of document.matchAll(V2_NAME_PATTERN)) {
          const key = `${surface.module}.${member.name}`
          const bucket = (byOperation[match[0]] ??= [])
          if (!bucket.includes(key)) bucket.push(key)
        }
      }
    }
  }
  return byOperation
}

/** The pure half: everything the rules compare, with no process or filesystem involved. */
export function auditQuickJsHostOps(input: AuditInput): AuditResult {
  const failures: string[] = []
  const warnings: string[] = []

  const host = input.hostOpNames
  const v1 = new Set(input.operationsV1)
  const requestedV2 = new Set(operationNamesInV2Request(input.operationsV2Requested))

  // 1. the vocabulary itself.
  if (host.length === 0) failures.push("host operation vocabulary is empty — print-host-ops did not emit HostOperation::ALL")
  const seen = new Set<string>()
  for (const name of host) {
    if (seen.has(name)) failures.push(`host vocabulary declares ${name} twice`)
    seen.add(name)
  }
  for (const name of [...v1].sort()) {
    if (!NAME_PATTERN.test(name)) failures.push(`OPERATIONS_V1 entry ${JSON.stringify(name)} is not "domain.ident"`)
  }

  // 2 and 3. what the shims actually call.
  for (const surface of input.surfaces) {
    for (const op of surface.hostOperations) {
      if (!v1.has(op)) {
        failures.push(`shim module ${surface.module} calls ${op}, which OPERATIONS_V1 does not declare (surface.ts:30 requires the subset)`)
      }
      if (!seen.has(op)) {
        failures.push(`shim module ${surface.module} calls ${op}, which the host does not answer — the run would be refused at call time`)
      }
    }
  }

  // 4. declarations the host cannot honour.
  for (const name of [...v1].sort()) {
    if (!seen.has(name)) failures.push(`OPERATIONS_V1 declares ${name}, but HostOperation::ALL does not resolve it`)
  }

  // 5. answered but unconsumed.
  const called = new Set(input.surfaces.flatMap((surface) => [...surface.hostOperations]))
  const servedRequests = new Set([...requestedV2].filter((name) => seen.has(name)))
  // A served request is rule 6's report, with its own action ("move it into OPERATIONS_V1"); rule 5 stays silent on those.
  const unconsumed = host.filter((name) => !v1.has(name) && !called.has(name) && !servedRequests.has(name))
  for (const name of unconsumed) {
    const refusing = input.refusingMembersByOperation[name]
    if (refusing !== undefined && refusing.length > 0) {
      const cited = refusing.slice(0, 4).join(", ")
      warnings.push(
        `host answers ${name} but no shim module calls it; ${refusing.length} member(s) already point at it in their surface entry (${cited}${refusing.length > 4 ? " …" : ""}) — the host grew ahead of the shim, wiring is shim-lane work`,
      )
      continue
    }
    const reason = input.unconsumedReasons[name]
    if (reason === undefined || reason.trim() === "") {
      failures.push(
        `host answers ${name}: no shim module calls it, no shim surface entry references it, and UNCONSUMED_BY_SHIMS carries no reason for it — wire the consumer, drop the operation, or record the decision`,
      )
    }
  }

  // 6. the request list must not become a second truth. One message per served request, citing the shim
  // members still refusing it — rule 5 stays silent on these so the pair cannot double-report.
  for (const name of [...servedRequests].sort()) {
    if (v1.has(name)) continue
    const refusing = input.refusingMembersByOperation[name] ?? []
    const cited = refusing.length === 0 ? "" : `; ${refusing.length} member(s) still point at it (${refusing.slice(0, 4).join(", ")}${refusing.length > 4 ? " …" : ""}) — wiring is shim-lane work`
    warnings.push(`OPERATIONS_V2_REQUESTED still requests ${name}, which the host answers — move it into OPERATIONS_V1 (packages/quickjs-shims/src/host.ts, shim lane)${cited}`)
  }

  const summary = `host answers ${host.length} · OPERATIONS_V1 declares ${v1.size} · shim surfaces call ${called.size} · answered-but-unconsumed ${unconsumed.length} · V2 requests already served ${servedRequests.size}`
  return { failures, warnings, summary }
}

/**
 * Runs a command with stdout captured and stderr inherited, so cargo's own progress — including
 * `Blocking waiting for file lock on build directory` — reaches the terminal instead of looking like a hang.
 */
async function captureStdout(
  command: string,
  args: readonly string[],
  environment: Record<string, string>,
): Promise<{ code: number | null; stdout: string }> {
  const { spawn } = await import("node:child_process")
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { env: environment, stdio: ["ignore", "pipe", "inherit"] })
    let stdout = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout }))
  })
}

/**
 * Builds the inventory document with the discipline AGENTS.md sets for native builds: one job, sccache when
 * present. There is deliberately no read-a-cached-list path — reading the *compiled* registry is the whole
 * point. `--use-built-bin` is the one concession: it skips only the `cargo build` (which contends for the
 * shared `target/debug/.cargo-lock` with other lanes), never the bin, so the vocabulary still comes from
 * `HostOperation::ALL` and a stale bin is a visible mistake rather than a silent one.
 */
async function exportHostOperationNames(useBuiltBin = false): Promise<string[]> {
  const manifest = "crates/xiranite-quickjs-executor/Cargo.toml"
  const binary = "crates/xiranite-quickjs-executor/target/debug/print-host-ops"
  const { existsSync } = await import("node:fs")
  const environment: Record<string, string> = { ...process.env } as Record<string, string>
  if (existsSync("/opt/homebrew/bin/sccache") || existsSync("/usr/local/bin/sccache") || Bun.which("sccache") !== null) {
    environment.RUSTC_WRAPPER = "sccache"
  }

  const startedAt = Date.now()
  if (useBuiltBin) {
    if (!existsSync(binary)) throw new Error(`--use-built-bin was passed but ${binary} does not exist — run the gate without the flag`)
    process.stderr.write(`audit:quickjs-host-ops: skipping cargo build (--use-built-bin), running the existing ${binary}\n`)
  } else {
    process.stderr.write("audit:quickjs-host-ops: cargo build print-host-ops (-j 1, serial per AGENTS.md); cargo's own progress is on stderr, so a wait on another lane's build lock is visible\n")
    const build = await captureStdout("cargo", ["build", "-j", "1", "--manifest-path", manifest, "--bin", "print-host-ops"], environment)
    if (build.code !== 0) {
      throw new Error(
        `cargo build of print-host-ops failed (exit ${build.code}). If the target is not auto-discovered from src/bin/, add a [[bin]] entry to ${manifest} — this gate deliberately does not fall back to scraping the source.`,
      )
    }
    process.stderr.write(`audit:quickjs-host-ops: cargo build done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`)
  }

  const run = await captureStdout(binary, [], environment)
  if (run.code !== 0) throw new Error(`print-host-ops exited ${run.code}`)

  const document = JSON.parse(run.stdout) as { schema_version?: number; ops?: { name: string }[] }
  if (document.schema_version !== 1 || !Array.isArray(document.ops)) {
    throw new Error(`unexpected print-host-ops document (schema_version ${document.schema_version}); the gate understands version 1`)
  }
  return document.ops.map((row) => row.name)
}

async function main(): Promise<void> {
  const useBuiltBin = process.argv.includes("--use-built-bin")
  const result = auditQuickJsHostOps({
    hostOpNames: await exportHostOperationNames(useBuiltBin),
    operationsV1: OPERATIONS_V1,
    operationsV2Requested: OPERATIONS_V2_REQUESTED,
    surfaces: MODULE_SURFACES.map((surface) => ({ module: surface.module, hostOperations: surface.hostOperations })),
    refusingMembersByOperation: collectRefusingMembersByOperation(
      MODULE_SURFACES.map((surface) => ({ module: surface.module, unsupported: surface.unsupported })),
    ),
    unconsumedReasons: UNCONSUMED_BY_SHIMS,
  })

  for (const warning of result.warnings) console.warn(`WARN ${warning}`)
  for (const failure of result.failures) console.error(`FAIL ${failure}`)
  console.log(`${result.failures.length === 0 ? "OK" : "FAIL"} audit:quickjs-host-ops — ${result.summary} · ${result.warnings.length} warning(s)`)

  if (result.failures.length > 0) process.exit(1)
}

if (import.meta.main) {
  await main()
}
