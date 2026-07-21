import { writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliHost } from "@xiranite/cli-runtime"

import type { ReaderLibraryHeadlessController } from "../application/headless/ReaderLibraryHeadlessController.js"
import { directoryFilter, integerOption, rejectOptions, type ParsedLibraryArguments } from "./library-arguments.js"
import { printLibraryItems } from "./library-output.js"

export type LibraryCommand = "history" | "bookmarks" | "bookmark-lists" | "stats"

export async function runLibraryCommand(
  command: LibraryCommand,
  parsed: ParsedLibraryArguments,
  controller: ReaderLibraryHeadlessController,
  host: CliHost,
): Promise<void> {
  switch (command) {
    case "history": {
      const items = await controller.listRecent(
        integerOption(parsed, "--limit", 1, 1_000, 50),
        integerOption(parsed, "--offset", 0, 1_000_000, 0),
        directoryFilter(parsed.values.get("--filter")),
      )
      printLibraryItems("History", items, parsed.json, host)
      return
    }
    case "bookmarks": {
      const items = await controller.listBookmarks(
        parsed.values.get("--list"),
        integerOption(parsed, "--limit", 1, 1_000, 50),
        integerOption(parsed, "--offset", 0, 1_000_000, 0),
        directoryFilter(parsed.values.get("--filter")),
      )
      printLibraryItems("Bookmarks", items, parsed.json, host)
      return
    }
    case "bookmark-lists": {
      rejectOptions(parsed, new Set(["--database"]))
      printLibraryItems("Bookmark lists", await controller.listBookmarkLists(), parsed.json, host)
      return
    }
    case "stats": {
      rejectOptions(parsed, new Set(["--database"]))
      const result = await controller.statistics()
      if (parsed.json) writeJson(host, result)
      else {
        writeLine(host, "NeoView library")
        for (const [key, value] of Object.entries(result)) writeLine(host, `${key}: ${String(value)}`)
      }
    }
  }
}
