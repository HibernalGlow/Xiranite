import type { ResolveConfigPathOptions } from "@xiranite/config"

import { parseNeoviewRuntimeConfig } from "../../application/config/ReaderRuntimeConfig.js"
import { commitNeoviewConfig } from "./NeoviewConfigStore.js"

export async function commitNeoviewFileTreeExclusions(
  paths: readonly string[],
  options: ResolveConfigPathOptions = {},
): Promise<readonly string[]> {
  const committed = await commitNeoviewConfig({
    folder: { tree: { excluded_paths: [...paths] } },
  }, { ...options, strategy: "merge" })
  return parseNeoviewRuntimeConfig(committed.nodeConfig).fileTree.excludedPaths
}
