import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { File, FileArchive, FileImage, FileText, Film, Folder, Music } from "lucide-react"

import { FolderEntryFileMetadata, FolderEntryIcon, folderEntryExtension, formatFolderDate, formatFolderSize, getFolderEntryIcon } from "./FolderEntryPresentation"

describe("FolderEntryPresentation", () => {
  it("maps legacy file extension groups to semantic icons", () => {
    expect(getFolderEntryIcon({ kind: "directory", name: "photos" })).toBe(Folder)
    expect(getFolderEntryIcon({ kind: "file", name: "cover.PNG" })).toBe(FileImage)
    expect(getFolderEntryIcon({ kind: "file", name: "clip.webm" })).toBe(Film)
    expect(getFolderEntryIcon({ kind: "file", name: "track.flac" })).toBe(Music)
    expect(getFolderEntryIcon({ kind: "file", name: "book.cbz" })).toBe(FileArchive)
    expect(getFolderEntryIcon({ kind: "file", name: "notes.txt" })).toBe(FileText)
    expect(getFolderEntryIcon({ kind: "file", name: "unknown.bin" })).toBe(File)
  })

  it("normalizes extensions without treating dotfiles as typed files", () => {
    expect(folderEntryExtension("IMAGE.JpG")).toBe("jpg")
    expect(folderEntryExtension(".env")).toBe("")
    expect(folderEntryExtension("README")).toBe("")
  })

  it("formats the compact rich-view file metadata without inventing missing values", () => {
    expect(formatFolderSize(1_048_576)).toBe("1.0 MiB")
    expect(formatFolderSize(undefined)).toBe("")
    expect(formatFolderDate(undefined)).toBe("")
    const { container } = render(<FolderEntryFileMetadata entry={{ size: 1_048_576, modifiedAt: 0 }} />)
    expect(container.textContent).toContain("1.0 MiB")
    expect(container.textContent).not.toContain("undefined")
  })

  it("keeps the icon surface stable while applying semantic color", () => {
    const { container } = render(<FolderEntryIcon entry={{ kind: "file", name: "notes.md" }} />)
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("text-cyan-600")
  })
})
