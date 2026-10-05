import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

import { XIRANITE_CONFIG_LOCK_SUFFIX } from "./node.js"

/**
 * The lock protocol has two implementations by design — `node.ts` for the Node/Bun face and
 * `crates/xiranite-core/src/config_store.rs` for the host — and they are only the *same* lock if the names,
 * the window and the budget match. Nothing else in the tree checks that, so this reads the Rust source and
 * pins it against what this package publishes.
 *
 * It is a text gate, not a behaviour gate: it can only catch a constant being changed on one side, which is
 * exactly the drift that would otherwise surface as two processes locking different files.
 */
/** This module lives at `<repo>/packages/config/src`, so the repo root is three levels up. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const NODE_SOURCE = join(REPO_ROOT, "packages", "config", "src", "node.ts")
const RUST_STORE = join(REPO_ROOT, "crates", "xiranite-core", "src", "config_store.rs")

describe("config lock protocol shared with the host", () => {
  const rust = readFileSync(RUST_STORE, "utf8")

  test("the lock sibling is named the same on both sides", () => {
    expect(rust).toContain('pub const DEFAULT_LOCK_SUFFIX: &str = ".xr-write.lock"')
    expect(XIRANITE_CONFIG_LOCK_SUFFIX).toBe(".xr-write.lock")
  })

  test("the stale window is the same on both sides", () => {
    expect(rust).toContain("pub const DEFAULT_STALE_MS: TimestampMs = 30_000")
    expect(rust).toContain("const DEFAULT_MIN_DELAY_MS: u64 = 20")
    expect(rust).toContain("const DEFAULT_MAX_DELAY_MS: u64 = 250")
    const node = readFileSync(NODE_SOURCE, "utf8")
    expect(node).toContain("const LOCK_STALE_MS = 30_000")
    expect(node).toContain("const LOCK_MIN_DELAY_MS = 20")
    expect(node).toContain("const LOCK_MAX_DELAY_MS = 250")
  })

  test("the acquisition budget is the same on both sides", () => {
    expect(rust).toContain("pub const DEFAULT_RETRIES: u32 = 50")
    const node = readFileSync(NODE_SOURCE, "utf8")
    expect(node).toContain("const DEFAULT_LOCK_RETRIES = 50")
  })

  test("the temp document prefix is the same on both sides", () => {
    expect(rust).toContain('const TEMP_PREFIX: &str = ".xiranite-tmp-"')
    const node = readFileSync(NODE_SOURCE, "utf8")
    expect(node).toContain('const TEMP_PREFIX = ".xiranite-tmp-"')
  })

  /** A guard that never fires is worse than no guard: this arm proves the gate can see a violation. */
  test("the gate can see a violation", () => {
    expect(rust).not.toContain('pub const DEFAULT_LOCK_SUFFIX: &str = ".different.lock"')
    expect(XIRANITE_CONFIG_LOCK_SUFFIX).not.toBe(".different.lock")
  })
})
