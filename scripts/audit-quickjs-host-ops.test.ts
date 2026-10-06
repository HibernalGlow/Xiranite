#!/usr/bin/env bun
/**
 * Falsification tests for `scripts/audit-quickjs-host-ops.ts`.
 *
 * A gate that has never been red is not evidence, so every rule gets a fixture that must turn it red, and one
 * green fixture proves the rules are not simply always-on. The two name-extraction helpers are pinned too: the
 * operations come out of signature documents ("fs.symlink(target, path, type)") and out of the surface table's
 * free-text `reason` (`packages/quickjs-shims/src/surface.ts:149`), and both extractions are places a future
 * edit can silently break.
 *
 * Run with: bun test scripts/audit-quickjs-host-ops.test.ts   — pure only: no cargo, no filesystem.
 */
import { describe, expect, it } from "bun:test"

import {
  auditQuickJsHostOps,
  collectRefusingMembersByOperation,
  operationNamesInV2Request,
} from "./audit-quickjs-host-ops.ts"

/** A world with no drift: every answered operation is declared and called by a shim module. */
const HOST_OPS = ["fs.stat", "fs.readText", "proc.exec"]
const V1 = ["fs.stat", "fs.readText", "proc.exec"]
const SURFACES = [
  { module: "fs/promises", hostOperations: ["fs.stat", "fs.readText"] },
  { module: "child_process", hostOperations: ["proc.exec"] },
]

/** The two homes rule 7 allows, with just enough text for the scans to recognise them. */
const PROTOCOL_FILE = {
  path: "crates/quickjs-host-protocol/src/operation.rs",
  // A whole Rust file needs no more than these two shapes for the scans: the enum, and a match arm whose
  // answer is a wire name.
  text: [
    "pub enum HostOperation {",
    "    Stat,",
    "}",
    "impl HostOperation {",
    "    pub const fn as_str(self) -> &'static str {",
    '        match self { Self::Stat => "fs.stat" }',
    "    }",
    "}",
    "",
  ].join("\n"),
}
const SHIM_FILE = {
  path: "packages/quickjs-shims/src/host.ts",
  text: 'export const OPERATIONS_V1 = ["fs.stat"]\n',
}
const GREEN_SOURCES = [PROTOCOL_FILE, SHIM_FILE]

interface Fixture {
  hostOpNames?: readonly string[]
  operationsV1?: readonly string[]
  operationsV2Requested?: readonly string[]
  surfaces?: readonly { module: string; hostOperations: readonly string[] }[]
  refusing?: Readonly<Record<string, readonly string[]>>
  unconsumed?: Readonly<Record<string, string>>
  sources?: readonly { path: string; text: string }[]
}

function run(fixture: Fixture = {}) {
  return auditQuickJsHostOps({
    hostOpNames: fixture.hostOpNames ?? HOST_OPS,
    operationsV1: fixture.operationsV1 ?? V1,
    operationsV2Requested: fixture.operationsV2Requested ?? [],
    surfaces: fixture.surfaces ?? SURFACES,
    refusingMembersByOperation: fixture.refusing ?? {},
    unconsumedReasons: fixture.unconsumed ?? {},
    vocabularySources: fixture.sources ?? GREEN_SOURCES,
  })
}

describe("green case", () => {
  it("passes with nothing to say when every answered operation is declared and called", () => {
    const result = run()
    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.summary).toContain("host answers 3")
  })
})

describe("rule 1, the vocabulary itself", () => {
  it("fails on an empty host list", () => {
    expect(run({ hostOpNames: [] }).failures.join("\n")).toContain("vocabulary is empty")
  })

  it("fails on a duplicate name", () => {
    expect(run({ hostOpNames: [...HOST_OPS, "fs.stat"] }).failures.join("\n")).toContain("declares fs.stat twice")
  })

  it("fails on a declared name that is not domain.ident", () => {
    expect(run({ operationsV1: [...V1, "readFile"] }).failures.join("\n")).toContain('is not "domain.ident"')
  })
})

describe("rules 2 and 3, what the shim modules call", () => {
  it("fails when a module calls an operation OPERATIONS_V1 does not declare", () => {
    const result = run({
      hostOpNames: [...HOST_OPS, "fs.delete"],
      surfaces: [{ module: "fs/promises", hostOperations: ["fs.delete"] }, ...SURFACES],
    })
    expect(result.failures.join("\n")).toContain("which OPERATIONS_V1 does not declare")
  })

  it("fails when a module calls an operation the host does not answer", () => {
    const result = run({
      operationsV1: [...V1, "fs.chmod"],
      surfaces: [{ module: "fs", hostOperations: ["fs.chmod"] }, ...SURFACES],
    })
    expect(result.failures.join("\n")).toContain("the host does not answer")
  })
})

describe("rule 4, declarations the host cannot honour", () => {
  it("fails when OPERATIONS_V1 promises a name HostOperation::ALL does not resolve", () => {
    expect(run({ operationsV1: [...V1, "fs.chmod"] }).failures.join("\n")).toContain("OPERATIONS_V1 declares fs.chmod")
  })
})

describe("rule 5, answered but unconsumed", () => {
  it("fails when no shim surface and no recorded reason accounts for the operation", () => {
    expect(run({ hostOpNames: [...HOST_OPS, "service.invoke"] }).failures.join("\n")).toContain("service.invoke")
  })

  it("accepts a recorded reason with no shim reference at all", () => {
    const result = run({
      hostOpNames: [...HOST_OPS, "service.invoke"],
      unconsumed: { "service.invoke": "host-service passthrough, authorised per registration; no shim surface yet." },
    })
    expect(result.failures).toEqual([])
  })

  it("still fails when the recorded reason is blank", () => {
    const result = run({ hostOpNames: [...HOST_OPS, "service.invoke"], unconsumed: { "service.invoke": "   " } })
    expect(result.failures.join("\n")).toContain("service.invoke")
  })

  it("warns with the refusing members when a surface entry already points at the operation", () => {
    const result = run({
      hostOpNames: [...HOST_OPS, "fs.symlink"],
      refusing: { "fs.symlink": ["fs.symlinkSync", "fs/promises.symlink"] },
    })
    expect(result.failures).toEqual([])
    expect(result.warnings.join("\n")).toContain("fs.symlink")
    expect(result.warnings.join("\n")).toContain("2 member(s)")
  })
})

describe("rule 6, the request list must not become a second truth", () => {
  it("warns when a requested operation is already answered and still missing from v1", () => {
    const result = run({
      hostOpNames: [...HOST_OPS, "fs.chmod"],
      operationsV2Requested: ["fs.chmod(path, mode) -> null  // permission change"],
    })
    expect(result.failures).toEqual([])
    expect(result.warnings.join("\n")).toContain("move it into OPERATIONS_V1")
  })

  it("reports one message, not two, for an operation that is both served and refused", () => {
    const result = run({
      hostOpNames: [...HOST_OPS, "fs.chmod"],
      operationsV2Requested: ["fs.chmod(path, mode) -> null"],
      refusing: { "fs.chmod": ["fs.chmodSync"] },
    })
    const lines = result.warnings.filter((line) => line.includes("fs.chmod"))
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("move it into OPERATIONS_V1")
    expect(lines[0]).toContain("1 member(s) still point at it")
  })

  it("stays silent once the requested operation has been promoted into v1 and is called", () => {
    const result = run({
      hostOpNames: [...HOST_OPS, "fs.chmod"],
      operationsV1: [...V1, "fs.chmod"],
      operationsV2Requested: ["fs.chmod(path, mode) -> null"],
      surfaces: [{ module: "fs", hostOperations: ["fs.chmod"] }, ...SURFACES],
    })
    expect(result.warnings.join("\n")).not.toContain("fs.chmod")
    expect(result.failures).toEqual([])
  })
})

describe("helpers that pull names out of documents", () => {
  it("pulls every operation out of a multi-name request line", () => {
    expect(
      operationNamesInV2Request(["fs.link(source, target) / fs.symlink(target, path, type) / fs.readlink(path)"]),
    ).toEqual(["fs.link", "fs.readlink", "fs.symlink"])
  })

  it("ignores prose that is not an operation", () => {
    expect(operationNamesInV2Request(["binary file content; NOT base64-in-JSON"])).toEqual([])
  })

  it("reads an operation named only in a member's reason text", () => {
    const collected = collectRefusingMembersByOperation([
      { module: "fs", unsupported: [{ name: "readSync", reason: "positional reads must go to the host as fs.readBytes with an offset." }] },
    ])
    expect(collected["fs.readBytes"]).toEqual(["fs.readSync"])
  })

  it("lists each member once when both fields name the same operation", () => {
    const collected = collectRefusingMembersByOperation([
      {
        module: "fs/promises",
        unsupported: [{ name: "readFile", reason: "needs fs.readBytes for bytes.", requiredOperation: "fs.readBytes(path)" }],
      },
    ])
    expect(collected["fs.readBytes"]).toEqual(["fs/promises.readFile"])
  })
})

describe("rule 7, one vocabulary in one place", () => {
  it("passes when the protocol crate and the shim file are the only two homes", () => {
    expect(run().failures.filter((line) => line.includes("ADR-0078"))).toEqual([])
  })

  it("fails when nothing defines HostOperation at all", () => {
    const failures = run({ sources: [SHIM_FILE] }).failures.join("\n")
    expect(failures).toContain("must be defined exactly once")
  })

  it("fails when a second crate defines the enum as well", () => {
    const copy = { path: "crates/xiranite-something/src/ops.rs", text: PROTOCOL_FILE.text }
    const failures = run({ sources: [PROTOCOL_FILE, copy, SHIM_FILE] }).failures.join("\n")
    expect(failures).toContain("found 2")
  })

  it("fails when the enum lives somewhere other than the protocol crate", () => {
    const moved = { path: "crates/xiranite-quickjs-executor/src/host_calls.rs", text: PROTOCOL_FILE.text }
    const failures = run({ sources: [moved, SHIM_FILE] }).failures.join("\n")
    expect(failures).toContain("crates/quickjs-host-protocol/src/operation.rs")
    expect(failures).toContain("ADR-0078")
  })

  it("fails when another Rust file spells wire names by hand", () => {
    // A second mapping table is the exact regression: a name added there is a name the host does not answer,
    // and the Rust-vs-TypeScript comparison above would still look internally consistent.
    const handRolled = {
      path: "crates/xiranite-quickjs-executor/src/host_calls.rs",
      text: 'match operation { HostOperation::Stat => "fs.stat", _ => break },',
    }
    const failures = run({ sources: [PROTOCOL_FILE, handRolled, SHIM_FILE] }).failures.join("\n")
    expect(failures).toContain("maps wire names by hand")
  })

  it("ignores a TypeScript file that returns a wire name from an arrow function", () => {
    // The positive control for the .rs-only guard above: this must stay green, or the rule would be a
    // false-positive machine over the shim layer.
    const ts = { path: "packages/quickjs-shims/src/ops.ts", text: 'const name = () => "fs.stat";' }
    expect(run({ sources: [PROTOCOL_FILE, SHIM_FILE, ts] }).failures).toEqual([])
  })

  it("fails when the shim side declares a second OPERATIONS_V1", () => {
    const second = { path: "packages/quickjs-shims/src/host2.ts", text: SHIM_FILE.text }
    const failures = run({ sources: [PROTOCOL_FILE, SHIM_FILE, second] }).failures.join("\n")
    expect(failures).toContain("OPERATIONS_V1 must be declared exactly once")
  })
})
