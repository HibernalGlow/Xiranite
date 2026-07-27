import { describe, expect, it } from "vitest"
import { assertCompatibleFindzApiInfo } from "./index.js"
import { FINDZ_ABI_VERSION, FINDZ_REQUEST_VERSION, FINDZ_REQUIRED_CAPABILITIES, type FindzApiInfo } from "./protocol.js"

function compatibleApiInfo(): FindzApiInfo {
  return {
    abiVersion: FINDZ_ABI_VERSION,
    coreVersion: "test",
    requestVersions: [FINDZ_REQUEST_VERSION],
    capabilities: [...FINDZ_REQUIRED_CAPABILITIES],
    supportedFormats: ["png"],
  }
}

describe("assertCompatibleFindzApiInfo", () => {
  it("accepts the complete worker capability contract", () => {
    expect(() => assertCompatibleFindzApiInfo(compatibleApiInfo())).not.toThrow()
  })

  it("rejects a core that omits a required worker capability", () => {
    const apiInfo = compatibleApiInfo()
    apiInfo.capabilities = apiInfo.capabilities.filter((capability) => capability !== "scan.reconcile")

    expect(() => assertCompatibleFindzApiInfo(apiInfo)).toThrow("missing required capabilities: scan.reconcile")
  })

  it("rejects an API envelope whose ABI does not match the loaded symbols", () => {
    const apiInfo = compatibleApiInfo()
    apiInfo.abiVersion = FINDZ_ABI_VERSION + 1

    expect(() => assertCompatibleFindzApiInfo(apiInfo)).toThrow("incompatible ABI version")
  })
})
