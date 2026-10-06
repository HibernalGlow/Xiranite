import { expect, test } from "bun:test"

import { getNodeRuntimeInfo, loadNodePlatformModule } from "./node-runner.js"

test("rejects unknown and pure nodes before attempting a platform import", async () => {
  await expect(loadNodePlatformModule("missing-node")).rejects.toThrow("Unknown node platform")
  await expect(loadNodePlatformModule("linedup")).rejects.toThrow("does not expose a platform module")
})

test("uses an explicit platform runtime-info export instead of starting a node operation", async () => {
  await expect(getNodeRuntimeInfo("missing-node")).rejects.toThrow("Unknown node platform")
  await expect(getNodeRuntimeInfo("linedup")).rejects.toThrow("does not expose a platform module")
})
