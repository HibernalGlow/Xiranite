import { describe, expect, it } from "vitest"

import { parseNeoviewFolderViewPatch, parseNeoviewRuntimeConfig } from "./ReaderRuntimeConfig.js"

describe("inline branch folder configuration", () => {
  it("[neoview.folder.inline-branch-config] parses and persists the optional expansion switch", () => {
    expect(parseNeoviewRuntimeConfig({ folder: { penetration: { expand_branches_inline: true } } }).folderView.penetration.expandBranchesInline).toBe(true)
    expect(parseNeoviewFolderViewPatch({ folderView: { penetration: { expandBranchesInline: true } } })).toEqual({
      patch: { folderView: { penetration: { expandBranchesInline: true } } },
      tomlPatch: { folder: { penetration: { expand_branches_inline: true } } },
    })
  })
})
