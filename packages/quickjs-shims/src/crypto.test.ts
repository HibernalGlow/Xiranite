/**
 * The realm's `crypto` global, against a scripted `__xrh` host.
 *
 * `packages/nodes/dissolvef/src/platform.ts:20` builds every undo-journal id with a bare
 * `crypto.randomUUID()` — the global, not `node:crypto` — so a realm that only has the module still fails
 * the run with `crypto is not defined`. That was measured, not read: the `nested`+`undo` parity case for
 * `dissolvef` failed exactly there while its other five cases passed.
 *
 * The two members are the pinned host operations (`crypto.randomUUID`, `crypto.randomBytes`), so entropy
 * has one implementation (ADR-0074 §2) and this file only checks that the *global* is wired to it.
 */
import { afterEach, describe, expect, it } from "vitest"

import { installShimGlobals } from "./index.ts"

const HOST_GLOBAL_KEY = "__xrh"
/** The uuid the scripted host answers, twice: ids must come from the host, not from a local counter. */
const SCRIPTED_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
const SCRIPTED_HEX = "0123456789abcdef"

function installHost(): void {
  const host = {
    call(operation: string, args: string) {
      if (operation === "crypto.randomUUID") return JSON.stringify(SCRIPTED_UUID)
      if (operation === "crypto.randomBytes") {
        const parsed = JSON.parse(args) as { length?: number }
        // The host answers hex; 8 bytes is what `SCRIPTED_HEX` decodes to.
        expect(parsed.length).toBe(8)
        return JSON.stringify(SCRIPTED_HEX)
      }
      return "null"
    },
    callAsync(operation: string, args: string) {
      return Promise.resolve(host.call(operation, args))
    },
    now() {
      return "2026-10-05T00:00:00.000Z"
    },
    platform: { platform: "darwin", arch: "arm64", sep: "/", pathSep: ":", cwd: "/work", env: "{}" },
  }
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY] = host
}

function removeGlobalCrypto(): void {
  // The prelude only installs what is missing, so a run must start from a realm without it (QuickJS has
  // none; the test process does, and leaving it installed would let the next case pass by accident).
  delete (globalThis as Record<string, unknown>).crypto
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY]
  removeGlobalCrypto()
})

describe("the realm's crypto global", () => {
  it("is installed by the prelude and answers with the host's uuid", () => {
    installHost()
    removeGlobalCrypto()
    installShimGlobals()
    const crypto = (globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto
    expect(crypto, "installShimGlobals left the realm without a crypto global").toBeDefined()
    expect(crypto.randomUUID()).toBe(SCRIPTED_UUID)
    // Two calls are two host calls: nothing here may count upward locally.
    expect(crypto.randomUUID()).toBe(SCRIPTED_UUID)
  })

  it("fills an integer view from the host's bytes", () => {
    installHost()
    removeGlobalCrypto()
    installShimGlobals()
    const crypto = (
      globalThis as unknown as { crypto: { getRandomValues: (target: Uint8Array) => Uint8Array } }
    ).crypto
    const target = new Uint8Array(8)
    expect(crypto.getRandomValues(target)).toBe(target)
    expect([...target]).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef])
  })

  it("refuses a fill larger than the host's entropy ceiling instead of half-filling", () => {
    installHost()
    removeGlobalCrypto()
    installShimGlobals()
    const crypto = (globalThis as unknown as { crypto: { getRandomValues: (t: Uint8Array) => Uint8Array } }).crypto
    expect(() => crypto.getRandomValues(new Uint8Array(65))).toThrow(/ceiling/)
  })
})
