import { join } from "node:path"

import type { ResolveConfigPathOptions } from "@xiranite/config"

export async function resolveManagedUpscaylExecutable(
  options: ResolveConfigPathOptions = {},
): Promise<string> {
  const { resolveXiraniteDataDir } = await import("@xiranite/config")
  const executable = process.platform === "win32" ? "upscayl-bin.exe" : "upscayl-bin"
  return join(resolveXiraniteDataDir(options), "tools", "upscayl-daemon", "current", executable)
}
