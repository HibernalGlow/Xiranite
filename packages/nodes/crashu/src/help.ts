import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Crashu",
  "short": "Match similar folder names and optionally move matched folders.",
  "description": "Match similar folder names and optionally move matched folders.",
  "whenToUse": [
    "Use Crashu when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Crashu from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Crashu to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Crashu directly from a terminal.",
      "terminal": [
        "Run `xiranite crashu` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite crashu --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite crashu",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite crashu",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite crashu --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help crashu",
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
