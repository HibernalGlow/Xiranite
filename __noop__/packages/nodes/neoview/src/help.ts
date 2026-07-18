import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "NeoView",
  short: "Inspect and stream image, comic and archive pages through the shared Reader Core.",
  description: "Open local books without loading complete archives or page payloads into command-line memory.",
  whenToUse: [
    "Use NeoView to inspect a comic, list its pages, query a frame or stream one original page.",
  ],
  workflows: [
    {
      title: "CLI",
      summary: "Inspect metadata or stream an original page without starting the GUI.",
      cli: [
        "Run `xiranite neoview inspect <path> --json` for book and current-frame metadata.",
        "Run `xiranite neoview extract-page <path> --index 0 --output -` for binary stdout.",
        "Run `xiranite neoview thumbnail-db-stats --json` for aggregate thumbnail database health.",
        "Run `xiranite neoview presentation-cache-stats --json` for the shared L3 cache budget and hit counters.",
        "Run `xiranite neoview diagnostics --json` for a path-free process, scheduler, cache and queue snapshot.",
        "Run `xiranite neoview reader-data-inspect <backup.json> --json` before importing legacy history and bookmarks.",
      ],
    },
    {
      title: "TUI",
      summary: "Open the persistent terminal reader workbench.",
      cli: ["Run `xiranite neoview ui` in an interactive terminal."],
    },
  ],
  commands: [
    {
      title: "Inspect a comic",
      command: "xiranite neoview inspect D:/books/example.cbz --json",
      description: "Print book, frame and visible-page metadata without local source paths.",
      examples: [
        {
          label: "List pages",
          command: "xiranite neoview pages D:/books/example.cbz --limit 50 --json",
          description: "List a bounded page window.",
        },
        {
          label: "Extract one original page",
          command: "xiranite neoview extract-page D:/books/example.cbz --index 4 --output D:/temp/page.png",
          description: "Stream one page to a new file without buffering the entire page.",
        },
      ],
    },
    {
      title: "Migrate legacy reader data",
      command: "xiranite neoview reader-data-inspect D:/backup/neoview-backup.json --json",
      description: "Validate and summarize legacy history, bookmarks, lists and settings without exposing source paths.",
      examples: [{
        label: "Merge after preview",
        command: "xiranite neoview reader-data-import D:/backup/neoview-backup.json --strategy merge --yes --json",
        description: "Idempotently merge newer records into the original NeoView thumbnails database.",
      }],
    },
    {
      title: "Maintain thumbnail data",
      command: "xiranite neoview thumbnail-db-stats --json",
      description: "Inspect aggregate row, failure, WAL and writer statistics without exposing thumbnail keys.",
      examples: [{
        label: "Remove one expired batch",
        command: "xiranite neoview thumbnail-db-cleanup --kind expired --days 30 --limit 500 --yes --json",
        description: "Delete at most 500 expired file thumbnails while preserving every folder thumbnail.",
      }],
    },
    {
      title: "Inspect runtime diagnostics",
      command: "xiranite neoview diagnostics --json",
      description: "Read a side-effect-free process, scheduler, cache and queue snapshot without exposing source paths.",
      examples: [],
    },
    {
      title: "Maintain presentation cache",
      command: "xiranite neoview presentation-cache-stats --json",
      description: "Inspect the shared content-addressed L3 cache without exposing source paths or cache keys.",
      examples: [{
        label: "Remove expired entries",
        command: "xiranite neoview presentation-cache-cleanup --reason age --yes --json",
        description: "Run the same lease-aware age cleanup used by the Reader HTTP maintenance route.",
      }],
    },
  ],
  safety: {
    defaultMode: "read-only",
    notes: [
      "Existing output files are not overwritten unless --force is explicit.",
      "Archive passwords are read from named environment variables and never accepted as argv values.",
      "Binary stdout never contains status or log text.",
      "Thumbnail cleanup is bounded and requires --yes; online cleanup never runs VACUUM or TRUNCATE checkpoint.",
      "Reader data import requires --yes; overwrite only clears Xiranite-owned xr_ Reader tables and never modifies legacy thumbnail tables.",
      "Presentation-cache cleanup and clear require --yes, skip active leases and never touch thumbnails.db.",
    ],
  },
} satisfies NodeHelp
