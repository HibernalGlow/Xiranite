import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { File, FileArchive, FileImage, FileText, Film, Folder, Music } from "lucide-react"

import { FolderEntryDisplayProvider, FolderEntryFileMetadata, FolderEntryIcon, FolderEntryMetadata, FolderEntryPenetrationHint, folderEntryExtension, formatFolderDate, formatFolderSize, formatFolderTagSummary, formatFolderTags, getFolderEntryIcon } from "./FolderEntryPresentation"

describe("FolderEntryPresentation", () => {
  it("shows the internal-file hint only for folders while penetration is enabled", () => {
    const { rerender } = render(<FolderEntryPenetrationHint entry={{ kind: "directory" }} enabled />)
    expect(screen.getByText("显示内部文件").getAttribute("data-folder-penetration-hint")).toBe("true")

    rerender(<FolderEntryPenetrationHint entry={{ kind: "file" }} enabled />)
    expect(screen.queryByText("显示内部文件")).toBeNull()

    rerender(<FolderEntryPenetrationHint entry={{ kind: "directory" }} enabled={false} />)
    expect(screen.queryByText("显示内部文件")).toBeNull()
  })

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

  it("keeps ordinary EMM/manual tags and favorite count in one full-value summary", () => {
    const entry = { tags: [" artist:alice ", "", "manual:favorite"], collectTagCount: 2 }
    expect(formatFolderTags(entry.tags)).toBe("artist:alice / manual:favorite")
    expect(formatFolderTagSummary(entry)).toBe("artist:alice / manual:favorite / 2 个收藏标签")

    const { container } = render(
      <FolderEntryDisplayProvider value={{ tagMode: "all", showRating: true, showCollectTagCount: true, showTags: true, maxTags: 3, showTooltips: true }}>
        <FolderEntryMetadata entry={{ name: "book.cbz", path: "D:/book.cbz", kind: "file", readerSupported: true, ...entry }} showRating={false} showCollectTagCount />
      </FolderEntryDisplayProvider>,
    )
    const tags = container.querySelector('[data-folder-entry-metadata="tags"]')
    expect(tags?.textContent).toContain("artist:alice / manual:favorite")
    expect(tags?.getAttribute("title")).toBe("标签 artist:alice / manual:favorite")
  })

  it("[neoview.folder.tag-display-render] applies the More-menu tag limit and tooltip policy without changing the DTO", () => {
    const entry = { name: "book.cbz", path: "D:/book.cbz", kind: "file" as const, readerSupported: true, tags: ["artist:alice", "manual:favorite", "ai:recommended"] }
    const { container } = render(
      <FolderEntryDisplayProvider value={{ tagMode: "all", showRating: false, showCollectTagCount: false, showTags: true, maxTags: 1, showTooltips: false }}>
        <FolderEntryMetadata entry={entry} showRating showCollectTagCount />
      </FolderEntryDisplayProvider>,
    )
    const tags = container.querySelector('[data-folder-entry-metadata="tags"]')
    expect(tags?.textContent).toContain("artist:alice / +2")
    expect(tags?.getAttribute("title")).toBeNull()
    expect(container.textContent).not.toContain("4.2")
  })

  it("[neoview.folder.tag-display-collect] keeps collected EMM tags and manual tags in collect mode", () => {
    const entry = { name: "book.cbz", path: "D:/book.cbz", kind: "file" as const, readerSupported: true, tags: ["artist:alice", "female:glasses", "manual:favorite"], collectTags: ["female:glasses"], manualTags: ["manual:favorite"] }
    const { container } = render(
      <FolderEntryDisplayProvider value={{ tagMode: "collect", showRating: true, showCollectTagCount: true, showTags: true, maxTags: 3, showTooltips: true }}>
        <FolderEntryMetadata entry={entry} showRating={false} showCollectTagCount={false} />
      </FolderEntryDisplayProvider>,
    )
    expect(container.textContent).toContain("female:glasses / manual:favorite")
    expect(container.textContent).not.toContain("artist:alice")
  })
})
