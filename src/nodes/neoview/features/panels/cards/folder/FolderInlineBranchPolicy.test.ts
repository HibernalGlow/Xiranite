import { describe, expect, it } from "vitest"

import type { ReaderFolderPenetrationConfig, ReaderFolderPenetrationResolutionDto } from "../../../../adapters/reader-http-client"
import { canExpandPenetratedBranchInline } from "./FolderInlineBranchPolicy"

const penetration: ReaderFolderPenetrationConfig = {
  enabled: true,
  expandBranchesInline: true,
  inlineBranchLimitsEnabled: true,
  inlineBranchMaxDirectories: 4,
  inlineBranchMaxFiles: 4,
  inlineBranchMaxItems: 4,
  showInternalFiles: true,
  internalItemsMode: "single",
  maxDepth: 3,
  terminalTargets: ["archive", "document", "media-directory", "file"],
}

function branch(directDirectoryCount: number, directFileCount: number): ReaderFolderPenetrationResolutionDto {
  return {
    status: "branch",
    originPath: "C:/books/series",
    chain: [],
    reason: "multiple-primary-items",
    directDirectoryCount,
    directFileCount,
  }
}

describe("canExpandPenetratedBranchInline", () => {
  it("[neoview.folder.inline-branch-limits] rejects any configured direct-entry limit that is exceeded", () => {
    expect(canExpandPenetratedBranchInline(penetration, branch(2, 2))).toBe(true)
    expect(canExpandPenetratedBranchInline(penetration, branch(5, 0))).toBe(false)
    expect(canExpandPenetratedBranchInline(penetration, branch(2, 5))).toBe(false)
    expect(canExpandPenetratedBranchInline(penetration, branch(3, 2))).toBe(false)
  })

  it("[neoview.folder.inline-branch-limits] ignores the stored limits when their switch is off", () => {
    expect(canExpandPenetratedBranchInline({ ...penetration, inlineBranchLimitsEnabled: false }, branch(12, 8))).toBe(true)
  })
})
