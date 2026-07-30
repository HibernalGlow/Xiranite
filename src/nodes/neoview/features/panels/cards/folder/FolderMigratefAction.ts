import type { MigratefData, MigratefInput } from "@xiranite/node-migratef/core"

import { externalNode } from "@/nodes/shared/externalNodeGateway"

const migratef = externalNode("migratef")

export interface FolderMigratefFeedback {
  kind: "status" | "alert"
  text: string
}

export async function runMigratefToDirectory(sourcePath: string, targetPath: string): Promise<MigratefData | undefined> {
  const result = await migratef.run<MigratefInput, MigratefData>({
    action: "move",
    mode: "direct",
    sourcePaths: [sourcePath],
    targetPath,
    dryRun: false,
  })
  if (!result.success) throw new Error(result.message)
  return result.data
}

export async function migrateFolderEntryToPickedDirectory({
  sourcePath,
  sourceName,
  pickDirectory,
  onMigrated,
}: {
  sourcePath: string
  sourceName: string
  pickDirectory(): Promise<string | undefined>
  onMigrated?(): void | Promise<void>
}): Promise<FolderMigratefFeedback | undefined> {
  try {
    const targetPath = await pickDirectory()
    if (!targetPath) return undefined
    return await migrateFolderEntryToDirectory({ sourcePath, sourceName, targetPath, onMigrated })
  } catch (error) {
    return { kind: "alert", text: `迁移失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function migrateFolderEntryToDirectory({
  sourcePath,
  sourceName,
  targetPath,
  onMigrated,
}: {
  sourcePath: string
  sourceName: string
  targetPath: string
  onMigrated?(): void | Promise<void>
}): Promise<FolderMigratefFeedback> {
  try {
    const result = await runMigratefToDirectory(sourcePath, targetPath)
    await onMigrated?.()
    if (result?.migratedCount === 0 && result.skippedCount > 0) {
      return { kind: "alert", text: `未迁移 ${sourceName}：目标目录中可能已有同名项目` }
    }
    return { kind: "status", text: `已将 ${sourceName} 迁移到 ${targetPath}` }
  } catch (error) {
    return { kind: "alert", text: `迁移失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
