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
  ],
  safety: {
    defaultMode: "read-only",
    notes: [
      "Existing output files are not overwritten unless --force is explicit.",
      "Archive passwords are read from named environment variables and never accepted as argv values.",
      "Binary stdout never contains status or log text.",
    ],
  },
} satisfies NodeHelp
