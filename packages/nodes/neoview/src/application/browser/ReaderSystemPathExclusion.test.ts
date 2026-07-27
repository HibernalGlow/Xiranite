import { describe, expect, it } from "vitest"

import { defaultReaderSystemExcludedPaths, isDefaultReaderSystemPath } from "./ReaderSystemPathExclusion.js"

const windows = {
  platform: "win32" as const,
  systemRoot: "C:\\Windows",
  programFiles: "C:\\Program Files",
  programFilesX86: "C:\\Program Files (x86)",
  programData: "C:\\ProgramData",
}

describe("ReaderSystemPathExclusion", () => {
  it("[neoview.folder.default-system-exclusions] excludes only Windows system locations by default", () => {
    expect(isDefaultReaderSystemPath("C:\\Windows\\System32", windows)).toBe(true)
    expect(isDefaultReaderSystemPath("C:\\Program Files\\Xiranite", windows)).toBe(true)
    expect(isDefaultReaderSystemPath("C:\\Program Files (x86)\\Legacy", windows)).toBe(true)
    expect(isDefaultReaderSystemPath("C:\\ProgramData\\Xiranite", windows)).toBe(true)
    expect(isDefaultReaderSystemPath("D:\\$Recycle.Bin\\S-1-5-21", windows)).toBe(true)
    expect(isDefaultReaderSystemPath("D:\\System Volume Information", windows)).toBe(true)
    expect(isDefaultReaderSystemPath("D:\\Recovery\\WindowsRE", windows)).toBe(true)

    expect(isDefaultReaderSystemPath("C:\\Users\\reader\\Pictures", windows)).toBe(false)
    expect(isDefaultReaderSystemPath("C:\\Users\\reader\\AppData\\Roaming", windows)).toBe(false)
    expect(isDefaultReaderSystemPath("D:\\Windows\\comics", windows)).toBe(false)
  })

  it("[neoview.folder.default-system-exclusion-patterns] emits only exclusions within the scanned root", () => {
    expect(defaultReaderSystemExcludedPaths("D:\\library", windows)).toEqual([])
    expect(defaultReaderSystemExcludedPaths("D:\\", windows)).toEqual([
      "D:\\$Recycle.Bin",
      "D:\\System Volume Information",
      "D:\\Recovery",
    ])
  })
})
