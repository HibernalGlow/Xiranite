import { resolveXiraniteDataDir, type ResolveConfigPathOptions } from "@xiranite/config"
import { join } from "node:path"

export function resolveSuperResolutionArtifactCacheRoot(options: ResolveConfigPathOptions = {}): string {
  return join(resolveXiraniteDataDir(options), "nodes", "neoview", "upscale-artifacts")
}
