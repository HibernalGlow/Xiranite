import { describe, expect, it } from "vitest"

import { ArchiveCredentialStore } from "./ArchiveCredentialStore.js"

describe("ArchiveCredentialStore", () => {
  it("[neoview.archive.credentials] scopes copied password bytes to normalized archive paths", async () => {
    const raw = Uint8Array.of(1, 2, 3)
    const store = new ArchiveCredentialStore([
      { password: "root-secret" },
      { entryPaths: ["nested\\inner.cbz"], rawPassword: raw },
    ])
    raw.fill(9)
    const root = store.copyRawPassword()!
    const nested = store.copyRawPassword(["nested\\inner.cbz"])!
    expect(new TextDecoder().decode(root)).toBe("root-secret")
    expect(nested).toEqual(Uint8Array.of(1, 2, 3))
    root.fill(0)
    expect(new TextDecoder().decode(store.copyRawPassword())).toBe("root-secret")
    expect(store.copyRawPassword(["missing.cbz"])).toBeUndefined()
    const outstanding = store.copyRawPassword()
    await store.close()
    expect(outstanding?.every((byte) => byte === 0)).toBe(true)
    await expect(store[Symbol.asyncDispose]()).resolves.toBeUndefined()
    expect(() => store.copyRawPassword()).toThrow("closed")
  })

  it("[neoview.archive.credential-validation] rejects ambiguous, duplicate and unsafe credential inputs", () => {
    expect(() => new ArchiveCredentialStore([{ password: "", rawPassword: Uint8Array.of(1) }])).toThrow("exactly one")
    expect(() => new ArchiveCredentialStore([{ password: "" }])).toThrow("empty")
    expect(() => new ArchiveCredentialStore([{ password: "a" }, { password: "b" }])).toThrow("Duplicate")
    expect(() => new ArchiveCredentialStore([{ entryPaths: ["../inner.cbz"], password: "a" }])).toThrow("Unsafe")
    expect(() => new ArchiveCredentialStore([{ password: "x".repeat(4097) }])).toThrow("4096")
  })
})
