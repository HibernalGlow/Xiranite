import { describe, expect, it } from "vitest"

import { isNeoviewBackendSourceFile } from "./neoview-backend-watcher"

describe("NeoView backend source watcher", () => {
  it("accepts TypeScript implementation files on Windows and POSIX paths", () => {
    expect(isNeoviewBackendSourceFile("platform\\asset-route\\ReaderHttpControllerImplementation.ts")).toBe(true)
    expect(isNeoviewBackendSourceFile("application/config/ReaderRuntimeConfigParser.ts")).toBe(true)
    expect(isNeoviewBackendSourceFile("domain/page/Page.ts")).toBe(true)
  })

  it("ignores tests and non-TypeScript files", () => {
    expect(isNeoviewBackendSourceFile("application/config/ReaderRuntimeConfig.test.ts")).toBe(false)
    expect(isNeoviewBackendSourceFile("platform/config/ReaderConfig.spec.tsx")).toBe(false)
    expect(isNeoviewBackendSourceFile("testing/Tui.tsx")).toBe(false)
    expect(isNeoviewBackendSourceFile("cli/library-command.ts")).toBe(false)
    expect(isNeoviewBackendSourceFile("Tui.tsx")).toBe(false)
    expect(isNeoviewBackendSourceFile("ui-core.ts")).toBe(false)
    expect(isNeoviewBackendSourceFile("README.md")).toBe(false)
  })
})

