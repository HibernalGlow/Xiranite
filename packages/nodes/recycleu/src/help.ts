import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Recycleu",
  "short": "Empty the Windows recycle bin immediately or on a bounded timer.",
  "description": "Empty the Windows recycle bin immediately or on a bounded timer.",
  "whenToUse": [
    "Use Recycleu when you need this node's system workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Recycleu from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Recycleu to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Recycleu directly from a terminal.",
      "terminal": [
        "Run `xiranite recycleu` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite recycleu --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite recycleu",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite recycleu",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite recycleu --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help recycleu",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ],
  "safety": {
    "defaultMode": "preview",
    "notes": [
      "Review configuration and affected system state before running live actions.",
      "Prefer preview modes when available."
    ]
  }
} satisfies NodeHelp
