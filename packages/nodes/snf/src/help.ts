import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "SNF",
  "short": "Repair numbered folder sequence order with PackU SNF.",
  "description": "Repair numbered folder sequence order with PackU SNF.",
  "whenToUse": [
    "Use SNF when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy SNF from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy SNF to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run SNF directly from a terminal.",
      "terminal": [
        "Run `xiranite snf` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite snf --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite snf",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite snf",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite snf --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help snf",
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
