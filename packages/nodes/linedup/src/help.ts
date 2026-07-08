import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Linedup",
  short: "Remove source lines that contain any token from a filter list.",
  description: "Linedup compares source lines with filter tokens, removes matched lines, and returns the kept lines with removal counts.",
  whenToUse: [
    "Clean a source list by subtracting another list of names, IDs, paths, or tags.",
    "Compare two pasted text blocks before committing the kept list back to a file.",
    "Run a repeatable text filtering step from scripts or the Xiranite workspace.",
  ],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Use the node surface for quick paste-and-preview filtering.",
      ui: [
        "Deploy Linedup from the module registry.",
        "Paste source lines and filter tokens into the node fields.",
        "Run the filter action, review kept and removed counts, then copy or download the result.",
      ],
      tips: [
        "Use one token per line when you want predictable removal behavior.",
        "Enable preserve-order behavior when the output should keep the original source order.",
      ],
    },
    {
      title: "CLI files",
      summary: "Use source.txt and filter.txt style inputs for repeatable command-line cleanup.",
      terminal: [
        "Place source lines in source.txt and filter tokens in filter.txt.",
        "Run `xiranite linedup` for guided mode or `xiranite linedup filter --sourceFile source.txt --filterFile filter.txt --outputFile output.txt` for scripts.",
        "Inspect output.txt or the terminal output before using the kept list downstream.",
      ],
    },
  ],
  commands: [
    {
      title: "Filter lines",
      command: "xiranite linedup filter",
      description: "Filter inline text or files and print the kept lines.",
      examples: [
        {
          label: "Guided mode",
          command: "xiranite linedup",
          description: "Open the interactive workflow with clipboard and preset file detection.",
        },
        {
          label: "Filter files",
          command: "xiranite linedup filter --sourceFile source.txt --filterFile filter.txt --outputFile output.txt",
          description: "Remove any source line containing a token from filter.txt and write kept lines to output.txt.",
        },
        {
          label: "JSON result",
          command: "xiranite linedup filter --source \"a\\nb\\nc\" --filter \"b\" --json",
          description: "Return kept lines, removed lines, and counts as JSON.",
        },
      ],
    },
  ],
  fields: [
    {
      name: "source",
      type: "text",
      required: true,
      description: "The source lines to keep or remove.",
    },
    {
      name: "filter",
      type: "text",
      required: true,
      description: "Tokens used to remove matching source lines.",
    },
    {
      name: "caseInsensitive",
      type: "boolean",
      description: "Match tokens without case sensitivity.",
      defaultValue: "false",
    },
    {
      name: "preserveOrder",
      type: "boolean",
      description: "Keep output in source order instead of sorting it.",
      defaultValue: "false",
    },
  ],
  safety: {
    defaultMode: "preview",
    notes: [
      "The core filter is non-destructive unless an output file is explicitly written.",
      "When writing an output file, choose a new file first so the source list remains available.",
    ],
  },
} satisfies NodeHelp
