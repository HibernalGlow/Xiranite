import { posix, win32 } from "node:path"
import type { DirectoryScoresResult } from "@xiranite/node-clipm/contracts"

import type { ReaderDirectoryClipmScoreProvider } from "../../ports/ReaderDirectoryClipmScoreProvider.js"
import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"

const MAXIMUM_DIRECTORY_PATHS_PER_REQUEST = 500

export interface ReaderDirectoryClipmScoreGateway {
  getDirectoryScores(
    directoryPaths: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<DirectoryScoresResult>
}

export class PlatformReaderDirectoryClipmScoreProvider implements ReaderDirectoryClipmScoreProvider {
  constructor(private readonly gateway: ReaderDirectoryClipmScoreGateway) {}

  async hydrate(
    entries: readonly ReaderDirectoryEntry[],
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    const directoryPaths = [...new Set(entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path))]
    if (!directoryPaths.length) return entries

    const scores = new Map<string, DirectoryScoresResult["directories"][number]>()
    for (let cursor = 0; cursor < directoryPaths.length; cursor += MAXIMUM_DIRECTORY_PATHS_PER_REQUEST) {
      signal?.throwIfAborted()
      const result = await this.gateway.getDirectoryScores(
        directoryPaths.slice(cursor, cursor + MAXIMUM_DIRECTORY_PATHS_PER_REQUEST),
        { signal },
      )
      for (const directory of result.directories) scores.set(directoryPathKey(directory.directoryPath), directory)
    }
    signal?.throwIfAborted()

    return entries.map((entry) => {
      if (entry.kind !== "directory") return entry
      const work = scores.get(directoryPathKey(entry.path))?.work
      return work ? {
        ...entry,
        clipmScore: {
          label: work.label,
          score: work.score,
          bundleVersion: work.bundleVersion,
          shortCode: work.shortCode,
          sourcePath: work.path,
        },
      } : entry
    })
  }
}

function directoryPathKey(path: string): string {
  return process.platform === "win32"
    ? win32.normalize(path).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US")
    : posix.normalize(path).replace(/\/+$/u, "")
}

/* ------------------------------------------------------------------------------------------------
 * ClipM 节点临时禁用期间，platform.ts 中的默认评分 provider 工厂被下线。
 * 下面这段是它的原始实现，整体保留（未删除）以便恢复时原样搬回 packages/nodes/neoview/src/platform.ts。
 *
 * 恢复步骤：
 *   1. 从 xiranite.build.toml 的 [nodes].disabled 移除 "clipm"，重跑 `bun run generate:node-registries`；
 *   2. 把本注释块去掉注释符，移回 platform.ts 中「createSqliteReaderDataStore 之后」的位置；
 *   3. 把 platform.ts 里 `const directoryClipmScoreProvider = options.directoryClipmScoreProvider`
 *      换回 `options.directoryClipmScoreProvider ?? await createDefaultDirectoryClipmScoreProvider(options)`；
 *   4. 把 src/nodes/neoview/features/panels/cards/folder/folderClipmFeature.ts 的
 *      FOLDER_CLIPM_ENABLED 改回 true，并移除 ClipM 测试中的 skip 守卫。
 *
 * async function createDefaultDirectoryClipmScoreProvider(
 *   options: NeoviewRuntimeLoadOptions,
 * ): Promise<import("./ports/ReaderDirectoryClipmScoreProvider.js").ReaderDirectoryClipmScoreProvider> {
 *   const [{ createNodeClipmRuntime }, { PlatformReaderDirectoryClipmScoreProvider }] = await Promise.all([
 *     import("@xiranite/node-clipm/platform"),
 *     import("./platform/clipm/PlatformReaderDirectoryClipmScoreProvider.js"),
 *   ])
 *   return new PlatformReaderDirectoryClipmScoreProvider(createNodeClipmRuntime({
 *     cwd: options.cwd,
 *     env: options.env,
 *     nodeId: "clipm",
 *   }))
 * }
 * ------------------------------------------------------------------------------------------------ */
