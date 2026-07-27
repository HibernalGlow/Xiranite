import type { ReaderFolderPenetrationConfig, ReaderFolderPenetrationResolutionDto } from "../../../../adapters/reader-http-client"

export function canExpandPenetratedBranchInline(
  penetration: ReaderFolderPenetrationConfig,
  resolution: ReaderFolderPenetrationResolutionDto,
): boolean {
  const directDirectoryCount = resolution.directDirectoryCount ?? 0
  const directFileCount = resolution.directFileCount ?? 0
  return resolution.status === "branch"
    && penetration.expandBranchesInline
    && directDirectoryCount >= 2
    && directDirectoryCount <= penetration.inlineBranchMaxDirectories
    && directFileCount <= penetration.inlineBranchMaxFiles
    && directDirectoryCount + directFileCount <= penetration.inlineBranchMaxItems
}
