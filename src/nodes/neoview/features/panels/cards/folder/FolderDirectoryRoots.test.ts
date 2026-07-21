import { describe, expect, it } from "vitest"

import { folderDirectoryPathKey, folderDirectoryRoot, folderDirectoryRoots } from "./FolderDirectoryRoots"

describe("FolderDirectoryRoots", () => {
  it("[neoview.folder.tree-cross-volume] shares normalized Windows roots across directory browsers", () => {
    const roots = folderDirectoryRoots("E:\\library", ["D:\\Pinned"], [
      { path: "C:\\", label: "C:", kind: "fixed", available: true },
      { path: "D:", label: "Data (D:)", kind: "fixed", available: true },
      { path: "E:\\", label: "BOX (E:)", kind: "fixed", available: true },
    ])

    expect(roots.map(({ path, name, pinned }) => ({ path, name, pinned }))).toEqual([
      { path: "D:\\Pinned", name: "Pinned", pinned: true },
      { path: "C:\\", name: "C:", pinned: false },
      { path: "D:\\", name: "Data (D:)", pinned: false },
      { path: "E:\\", name: "BOX (E:)", pinned: false },
    ])
    expect(folderDirectoryRoot(" D: ")).toBe("D:\\")
    expect(folderDirectoryPathKey("D:\\")).toBe("d:")
  })

  it("[neoview.folder.tree-current-root] keeps the current volume usable when platform enumeration is unavailable", () => {
    expect(folderDirectoryRoots("E:\\library", [], [], "E:")).toEqual([
      { path: "E:\\", name: "E:", pinned: false, available: true },
    ])
  })
})
