import { beforeEach, describe, expect, it, vi } from "vitest"

import { getNodeConfigFromBackend, saveNodeConfigToBackend } from "@/backend/configRpcClient"
import { runNodeOnLocalBackend } from "@/backend/nodeRpcClient"
import { externalNode } from "./externalNodeGateway"

vi.mock("@/backend/configRpcClient", () => ({
  getNodeConfigFromBackend: vi.fn(),
  saveNodeConfigToBackend: vi.fn(),
}))
vi.mock("@/backend/nodeRpcClient", () => ({ runNodeOnLocalBackend: vi.fn() }))

describe("externalNode", () => {
  beforeEach(() => {
    vi.mocked(getNodeConfigFromBackend).mockReset()
    vi.mocked(saveNodeConfigToBackend).mockReset()
    vi.mocked(runNodeOnLocalBackend).mockReset()
  })

  it("keeps cross-node config and execution behind one typed adapter", async () => {
    const classf = externalNode<{ blacklistKeywords?: string[] }>("classf")
    vi.mocked(getNodeConfigFromBackend).mockResolvedValue({ config: { blacklistKeywords: ["[OgoG]"] }, path: "D:/xiranite.config.toml" })
    vi.mocked(runNodeOnLocalBackend).mockResolvedValue({ success: true, message: "Done." })

    await expect(classf.config.get()).resolves.toEqual({ config: { blacklistKeywords: ["[OgoG]"] }, path: "D:/xiranite.config.toml" })
    await classf.config.patch({ blacklistKeywords: ["[OgoG]", "[Artist]"] })
    await classf.run({ action: "plan" })

    expect(getNodeConfigFromBackend).toHaveBeenCalledWith("classf")
    expect(saveNodeConfigToBackend).toHaveBeenCalledWith("classf", { blacklistKeywords: ["[OgoG]", "[Artist]"] })
    expect(runNodeOnLocalBackend).toHaveBeenCalledWith("classf", { action: "plan" })
  })
})
