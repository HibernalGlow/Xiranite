import { expect, test } from "bun:test"

import { loadNodePlatformModule } from "./node-runner.js"

test("rejects unknown and pure nodes before attempting a platform import", async () => {
  await expect(loadNodePlatformModule("missing-node")).rejects.toThrow("Unknown node platform")
  await expect(loadNodePlatformModule("linedup")).rejects.toThrow("does not expose a platform module")
})
