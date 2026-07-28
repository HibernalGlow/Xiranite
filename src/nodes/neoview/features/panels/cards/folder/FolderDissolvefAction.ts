import type { DissolvefData, DissolvefInput } from "@xiranite/node-dissolvef/core"

import { externalNode } from "@/nodes/shared/externalNodeGateway"

const dissolvef = externalNode("dissolvef")

export async function runDissolvefFolder(path: string): Promise<DissolvefData | undefined> {
  const result = await dissolvef.run<DissolvefInput, DissolvefData>({
    action: "direct",
    path,
    preview: false,
  })
  if (!result.success) throw new Error(result.message)
  return result.data
}
