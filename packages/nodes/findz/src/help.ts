import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Findz",
  "short": "Search files and archive members with SQL-like filters.",
  "description": "Search files and archive members with SQL-like filters.",
  "whenToUse": [
    "Use Findz when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Findz from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Findz to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Findz directly from a terminal.",
      "terminal": [
        "Run `xiranite findz` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite findz --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite findz",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite findz",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite findz --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help findz",
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
