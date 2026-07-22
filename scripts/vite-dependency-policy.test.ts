import { describe, expect, it } from "bun:test"

import { VITE_EAGER_DEPENDENCIES, VITE_EXCLUDED_DEPENDENCIES } from "./vite-dependency-policy"

describe("Vite dependency optimization policy", () => {
  it("eagerly optimizes the shell and CommonJS compatibility dependencies", () => {
    expect(VITE_EAGER_DEPENDENCIES).toContain("react")
    expect(VITE_EAGER_DEPENDENCIES).toContain("react-dom/client")
    expect(VITE_EAGER_DEPENDENCIES).toContain("@wailsio/runtime")
    expect(VITE_EAGER_DEPENDENCIES).toContain("use-sync-external-store/shim/with-selector")
  })

  it("does not eagerly optimize feature-only heavyweight dependencies", () => {
    expect(VITE_EAGER_DEPENDENCIES).not.toContain("tldraw")
    expect(VITE_EAGER_DEPENDENCIES).not.toContain("@blocknote/react")
    expect(VITE_EAGER_DEPENDENCIES).not.toContain("music-metadata")
    expect(VITE_EAGER_DEPENDENCIES).not.toContain("recharts")
  })

  it("keeps dependencies with browser singleton or lazy-loading constraints excluded", () => {
    expect(VITE_EXCLUDED_DEPENDENCIES).toContain("nuqs")
    expect(VITE_EXCLUDED_DEPENDENCIES).toContain("@shikijs/core")
  })
})
