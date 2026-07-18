import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Lang, parse } from "@ast-grep/napi"
import { afterEach, describe, expect, test } from "vitest"

import { analyzeTauriProject } from "./analyze.js"
import { generateMigrationArtifacts } from "./generate.js"
import { applyStructuralRewrites } from "./rewrite.js"

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "tauri-project")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Tauri Rust AST migration", () => {
  test("discovers commands, registrations, types, events, and transitive native evidence", async () => {
    const inventory = await analyzeTauriProject({
      projectRoot: fixtureRoot,
      nativeMarkers: ["native_engine"],
    })

    expect(inventory.rustFiles).toBe(2)
    expect(inventory.registeredCommands).toEqual(["ping", "scan"])
    expect(inventory.unannotatedRegistrations).toEqual([])
    expect(inventory).toMatchObject({
      schemaVersion: 2,
      generator: { name: "@xiranite/tauri-migrate", version: "0.2.0" },
      sourceRevision: { vcs: "git" },
    })
    expect(inventory.summary).toEqual({
      "typescript-portable": 2,
      "native-required": 1,
      "manual-review": 1,
    })

    const ping = inventory.commands.find((command) => command.name === "ping")
    expect(ping).toMatchObject({
      disposition: "typescript-portable",
      tsReturnType: "string",
      parameters: [{ name: "name", rustType: "String", tsType: "string", tauriInjected: false }],
    })

    const scan = inventory.commands.find((command) => command.name === "scan")
    expect(scan).toMatchObject({
      disposition: "native-required",
      classificationSource: "ast-evidence",
      nativeReasons: ["native_engine"],
      events: [{ name: "scan-finished" }],
    })
    expect(scan?.parameters.find((parameter) => parameter.name === "app")?.tauriInjected).toBe(true)
  })

  test("applies explicit project decisions without discarding AST evidence", async () => {
    const inventory = await analyzeTauriProject({
      projectRoot: fixtureRoot,
      nativeMarkers: ["native_engine"],
      commandOverrides: { scan: "typescript-portable" },
    })
    const scan = inventory.commands.find((command) => command.name === "scan")
    expect(scan).toMatchObject({
      disposition: "typescript-portable",
      classificationSource: "config-override",
      nativeReasons: ["native_engine"],
    })
  })

  test("generates standalone TS contracts and protects existing output", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "xiranite-tauri-migrate-"))
    temporaryDirectories.push(outputDir)
    await generateMigrationArtifacts({
      projectRoot: fixtureRoot,
      outputDir,
      nativeMarkers: ["native_engine"],
    })

    const commands = await readFile(join(outputDir, "commands.ts"), "utf8")
    const report = await readFile(join(outputDir, "REPORT.md"), "utf8")
    expect(commands).toContain("export interface TauriCommandArguments")
    expect(commands).toContain("paths: Array<string>")
    expect(commands.match(/^  ping:/gm)).toHaveLength(3)
    expect(commands).toContain('ping: ["src/main.rs:6","src/main.rs:12"]')
    const syntaxErrors = parse(Lang.TypeScript, commands).root().findAll({ rule: { kind: "ERROR" } })
    expect(syntaxErrors.map((node) => node.text())).toEqual([])
    expect(report).toContain("scan-finished")
    expect(report).toContain("Generator: @xiranite/tauri-migrate 0.2.0")
    expect(report).toContain("Source commit:")
    await expect(
      generateMigrationArtifacts({ projectRoot: fixtureRoot, outputDir }),
    ).rejects.toThrow("Refusing to overwrite")
  })

  test("runs ast-grep codemods with single and multi-node metavariables", () => {
    const result = applyStructuralRewrites(
      'import { invoke, Channel } from "@tauri-apps/api/core"\n',
      [{
        id: "tauri-core-import",
        language: "typescript",
        pattern: 'import { $$$MEMBERS } from "@tauri-apps/api/core"',
        replacement: 'import { $$$MEMBERS } from "@xiranite/api"',
      }],
    )
    expect(result.code).toBe('import { invoke, Channel } from "@xiranite/api"\n')
    expect(result.changes).toEqual([{ ruleId: "tauri-core-import", matches: 1 }])
  })
})
