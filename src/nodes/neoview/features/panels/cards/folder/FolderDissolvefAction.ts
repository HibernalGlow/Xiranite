import type { DissolvefData, DissolvefInput } from "@xiranite/node-dissolvef/core"

import { runNodeOnLocalBackend } from "@/backend/nodeRpcClient"

export async function runDissolvefFolder(path: string): Promise<DissolvefData | undefined> {
  const result = await runNodeOnLocalBackend<DissolvefInput, DissolvefData>("dissolvef", {
    action: "direct",
    path,
    preview: false,
  })
  if (!result.success) throw new Error(result.message)
  return result.data
}
