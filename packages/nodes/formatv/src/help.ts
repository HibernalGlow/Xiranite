import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "FormatV",
  "short": "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
  "description": "Scan video folders, add/remove .nov suffixes, and check prefixed duplicates.",
  "whenToUse": [
    "Use FormatV when you need this node's video workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy FormatV from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy FormatV to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run FormatV directly from a terminal.",
      "cli": [
        "Run `xiranite formatv` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite formatv --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite formatv",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite formatv",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite formatv --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help formatv",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ],
  "safety": {
    "defaultMode": "preview",
    "notes": [
      "Prefer preview or dry-run modes before changing files.",
      "Keep backups or undo records when processing large folders."
    ]
  }
} satisfies NodeHelp
