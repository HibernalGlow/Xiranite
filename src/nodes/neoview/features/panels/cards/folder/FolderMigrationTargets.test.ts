import { describe, expect, it } from "vitest"

import {
  createFolderMigrationTarget,
  hasFolderMigrationPath,
  moveFolderMigrationTarget,
  normalizeFolderMigrationTargets,
  removeFolderMigrationTarget,
  updateFolderMigrationTarget,
  validateFolderMigrationTargets,
} from "./FolderMigrationTargets"

describe("FolderMigrationTargets", () => {
  it("creates readable unique names and keeps explicit ordering", () => {
    const first = createFolderMigrationTarget("E:/Archive", "archive-1", [])
    const second = createFolderMigrationTarget("F:/Archive/", "archive-2", [first])
    expect(first).toEqual({ id: "archive-1", name: "Archive", path: "E:/Archive" })
    expect(second.name).toBe("Archive 2")
    expect(moveFolderMigrationTarget([first, second], second.id, -1)).toEqual([second, first])
    expect(removeFolderMigrationTarget([first, second], first.id)).toEqual([second])
  })

  it("updates, normalizes, and validates saved targets", () => {
    const targets = [{ id: " archive ", name: " 归档 ", path: " E:\\Archive\\ " }]
    const renamed = updateFolderMigrationTarget(targets, " archive ", { name: "完成" })
    expect(normalizeFolderMigrationTargets(renamed)).toEqual([{ id: "archive", name: "完成", path: "E:\\Archive\\" }])
    expect(validateFolderMigrationTargets(renamed)).toBeUndefined()
    expect(hasFolderMigrationPath(targets, "e:/archive")).toBe(true)
    expect(validateFolderMigrationTargets([...targets, { id: "other", name: "重复", path: "e:/archive" }])).toBe("同一个目录只能添加一次。")
  })
})
