import { describe, expect, it } from "vitest"

import { parseNeoviewFolderViewPatch, parseNeoviewRuntimeConfig } from "./ReaderRuntimeConfig.js"

describe("inline branch folder configuration", () => {
  it("[neoview.folder.inline-branch-config] parses and persists expansion limits", () => {
    expect(parseNeoviewRuntimeConfig({ folder: { penetration: {
      expand_branches_inline: true,
      inline_branch_max_directories: 3,
      inline_branch_max_files: 5,
      inline_branch_max_items: 6,
    } } }).folderView.penetration).toMatchObject({
      expandBranchesInline: true,
      inlineBranchMaxDirectories: 3,
      inlineBranchMaxFiles: 5,
      inlineBranchMaxItems: 6,
    })
    expect(parseNeoviewFolderViewPatch({ folderView: { penetration: {
      inlineBranchMaxDirectories: 3,
      inlineBranchMaxFiles: 5,
      inlineBranchMaxItems: 6,
    } } })).toEqual({
      patch: { folderView: { penetration: {
        inlineBranchMaxDirectories: 3,
        inlineBranchMaxFiles: 5,
        inlineBranchMaxItems: 6,
      } } },
      tomlPatch: { folder: { penetration: {
        inline_branch_max_directories: 3,
        inline_branch_max_files: 5,
        inline_branch_max_items: 6,
      } } },
    })
  })
})
