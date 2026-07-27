import type { ReaderInputBindingsConfig, ReaderRadialMenuConfig } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderInputBindingsPatch, ReaderRadialMenuPatch } from "../adapters/reader-http-client"

export async function persistReaderRadialMenu(
  client: ReaderHttpClient,
  patch: ReaderRadialMenuPatch["radialMenu"],
  inputBindingsPatch: ReaderInputBindingsPatch["inputBindings"] | undefined,
  applyInputBindings: (config: ReaderInputBindingsConfig) => void,
  applyRadialMenu: (config: ReaderRadialMenuConfig) => void,
): Promise<ReaderRadialMenuConfig> {
  if (!client.updateRadialMenu) throw new Error("当前 Reader 后端不支持轮盘设置。")
  if (!inputBindingsPatch) {
    const updated = await client.updateRadialMenu({ radialMenu: patch })
    applyRadialMenu(updated)
    return updated
  }
  if (!client.updateInputBindingsAndRadialMenu) throw new Error("当前 Reader 后端不支持原子更新轮盘绑定。")
  const updated = await client.updateInputBindingsAndRadialMenu({ inputBindings: inputBindingsPatch, radialMenu: patch })
  applyInputBindings(updated.inputBindings)
  applyRadialMenu(updated.radialMenu)
  return updated.radialMenu
}
