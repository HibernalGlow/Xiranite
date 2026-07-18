import { describe, expect, test } from "vitest"
import type { CzkawkaEntry, CzkawkaGroup } from "./core.js"
import { applyCzkawkaDirectorySelection, applyCzkawkaGroupSelection, applyCzkawkaSelectionMode, applyCzkawkaTextSelection, calculateCzkawkaSelectionStats, createCzkawkaSelectionHistory, createDefaultCzkawkaSelectionAssistantConfig, invertCzkawkaSelection, parseCzkawkaSelectionAssistantConfig, pushCzkawkaSelectionHistory, redoCzkawkaSelectionHistory, serializeCzkawkaSelectionAssistantConfig, undoCzkawkaSelectionHistory } from "./selection-assistant.js"

const groups: CzkawkaGroup[] = [group(0, [entry("D:/a/small.jpg", 10, 1), entry("D:/a/large.jpg", 30, 3), entry("D:/b/mid.png", 20, 2), entry("D:/ref/original.jpg", 40, 4, true)]), group(1, [entry("E:/c/old.mp3", 5, 1), entry("E:/c/new.mp3", 15, 5)])]

describe("Czkawka shared selection assistant", () => {
  test("implements replace, add, remove, and intersection modes", () => {
    expect(applyCzkawkaSelectionMode(["a", "b"], ["b", "c"], "replace")).toEqual(["b", "c"])
    expect(applyCzkawkaSelectionMode(["a", "b"], ["b", "c"], "add")).toEqual(["a", "b", "c"])
    expect(applyCzkawkaSelectionMode(["a", "b"], ["b", "c"], "remove")).toEqual(["a"])
    expect(applyCzkawkaSelectionMode(["a", "b"], ["b", "c"], "intersect")).toEqual(["b"])
  })

  test("supports all four group modes and multi-level sorting", () => {
    const config = createDefaultCzkawkaSelectionAssistantConfig().group
    config.sortCriteria = [{ id: "folder", field: "folderPath", direction: "asc", preferEmpty: false, enabled: true, filterCondition: "none", filterValue: "" }, { id: "size", field: "fileSize", direction: "desc", preferEmpty: false, enabled: true, filterCondition: "none", filterValue: "" }]
    config.mode = "all-except-one"
    expect(applyCzkawkaGroupSelection(groups, [], config, "replace").paths).toEqual(["D:/a/small.jpg", "D:/b/mid.png", "E:/c/old.mp3"])
    config.mode = "select-one"
    expect(applyCzkawkaGroupSelection(groups, [], config, "replace").paths).toEqual(["D:/a/large.jpg", "E:/c/new.mp3"])
    config.mode = "all-except-one-per-folder"
    expect(applyCzkawkaGroupSelection(groups, [], config, "replace").paths).toEqual(["D:/a/small.jpg", "E:/c/old.mp3"])
    config.mode = "all-except-one-matching-set"
    expect(applyCzkawkaGroupSelection(groups, [], config, "replace").paths).toEqual(["D:/b/mid.png"])
  })

  test("applies criterion filters and never selects references", () => {
    const config = createDefaultCzkawkaSelectionAssistantConfig().group
    config.mode = "select-one"
    config.sortCriteria = [{ id: "jpg", field: "fileType", direction: "asc", preferEmpty: false, enabled: true, filterCondition: "equals", filterValue: "jpg" }]
    const result = applyCzkawkaGroupSelection(groups, [], config, "replace")
    expect(result.paths).toEqual(["D:/a/large.jpg"])
    expect(result.paths).not.toContain("D:/ref/original.jpg")
  })

  test("matches text columns, conditions, regex, and reports invalid expressions", () => {
    const config = createDefaultCzkawkaSelectionAssistantConfig().text
    config.column = "fileName"; config.pattern = "new"; config.condition = "starts-with"
    expect(applyCzkawkaTextSelection(groups, [], config, "replace").paths).toEqual(["E:/c/new.mp3"])
    config.useRegex = true; config.pattern = "^(large|mid)\\."
    expect(applyCzkawkaTextSelection(groups, [], config, "replace").paths).toEqual(["D:/a/large.jpg", "D:/b/mid.png"])
    config.pattern = "["
    expect(applyCzkawkaTextSelection(groups, [], config, "replace").error).toBeTruthy()
  })

  test("supports directory include, exclude, and keep-one rules", () => {
    const config = createDefaultCzkawkaSelectionAssistantConfig().directory
    config.mode = "select-all-in-directory"; config.directories = []
    expect(applyCzkawkaDirectorySelection(groups, [], config, "replace")).toMatchObject({ error: "At least one directory is required.", errorCode: "directory-required" })
    config.mode = "select-all-in-directory"; config.directories = ["D:/a"]
    expect(applyCzkawkaDirectorySelection(groups, [], config, "replace").paths).toEqual(["D:/a/small.jpg", "D:/a/large.jpg"])
    config.mode = "exclude-directory"
    expect(applyCzkawkaDirectorySelection(groups, ["D:/a/small.jpg", "D:/b/mid.png"], config, "remove").paths).toEqual(["D:/b/mid.png"])
    config.mode = "keep-one-per-directory"; config.directories = []
    expect(applyCzkawkaDirectorySelection(groups, [], config, "replace").paths).toEqual(["D:/a/large.jpg", "E:/c/new.mp3"])
  })

  test("tracks undo/redo, invert, statistics, and config round trips", () => {
    let history = createCzkawkaSelectionHistory(["a"])
    history = pushCzkawkaSelectionHistory(history, ["a", "b"])
    expect(undoCzkawkaSelectionHistory(history).present).toEqual(["a"])
    expect(redoCzkawkaSelectionHistory(undoCzkawkaSelectionHistory(history)).present).toEqual(["a", "b"])
    expect(invertCzkawkaSelection(groups, ["D:/a/small.jpg"]).length).toBe(4)
    expect(calculateCzkawkaSelectionStats(groups, ["D:/a/large.jpg", "D:/b/mid.png"])).toEqual({ selectedCount: 2, selectedBytes: 50, reclaimableBytes: 50 })
    const config = createDefaultCzkawkaSelectionAssistantConfig()
    expect(parseCzkawkaSelectionAssistantConfig(serializeCzkawkaSelectionAssistantConfig(config))).toEqual(config)
  })
})

function group(id: number, entries: CzkawkaEntry[]): CzkawkaGroup { return { id, entries: entries.map((entry) => ({ ...entry, groupId: id })), totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0), reclaimableBytes: entries.filter((entry) => !entry.isReference).reduce((sum, entry) => sum + entry.size, 0) } }
function entry(path: string, size: number, modifiedDate: number, isReference = false): CzkawkaEntry { return { id: path, groupId: 0, path, name: path.split("/").at(-1)!, size, modifiedDate, isReference } }
