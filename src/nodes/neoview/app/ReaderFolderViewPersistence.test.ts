import { expect, it } from "vitest"

import type { ReaderFolderViewConfig } from "../adapters/reader-http-client"
import { mergeReaderFolderViewPatch } from "./ReaderFolderViewPersistence"

const folderView = {
  details: { columnWidths: { name: 160 } },
  search: { includeSubfolders: true },
  emptyArea: { singleClickAction: "none" },
  titleWrap: { compact: false },
  confirmations: { trash: false },
  penetration: {
    enabled: true,
    expandBranchesInline: false,
    inlineBranchLimitsEnabled: true,
    inlineBranchMaxDirectories: 4,
    inlineBranchMaxFiles: 4,
    inlineBranchMaxItems: 4,
  },
  tree: { visible: false },
  tabs: { layout: "top" },
} as ReaderFolderViewConfig

it("merges inline-branch updates without replacing the existing penetration policy", () => {
  const next = mergeReaderFolderViewPatch(
    folderView,
    { penetration: { expandBranchesInline: true } },
    folderView,
  )

  expect(next.penetration).toMatchObject({
    enabled: true,
    expandBranchesInline: true,
    inlineBranchLimitsEnabled: true,
    inlineBranchMaxDirectories: 4,
    inlineBranchMaxFiles: 4,
    inlineBranchMaxItems: 4,
  })
  expect(folderView.penetration.expandBranchesInline).toBe(false)
})
