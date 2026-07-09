import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "MigrateF",
  "short": "Move or copy files with preserve, flat, and direct modes plus undo history.",
  "description": "Move or copy files with preserve, flat, and direct modes plus undo history.",
  "whenToUse": [
    "Use MigrateF when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy MigrateF from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy MigrateF to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run MigrateF directly from a terminal.",
      "cli": [
        "Run `xiranite migratef` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite migratef --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite migratef",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite migratef",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite migratef --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help migratef",
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
