import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "EngineV",
  "short": "Scan, filter, rename, delete, and export Wallpaper Engine workshop folders.",
  "description": "Scan, filter, rename, delete, and export Wallpaper Engine workshop folders.",
  "whenToUse": [
    "Use EngineV when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy EngineV from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy EngineV to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run EngineV directly from a terminal.",
      "terminal": [
        "Run `xiranite enginev` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite enginev --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite enginev",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite enginev",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite enginev --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help enginev",
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
