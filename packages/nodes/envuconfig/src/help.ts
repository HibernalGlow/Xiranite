import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "EnvU Config",
  "short": "Inventory, record, and back up EnvU installation configuration files.",
  "description": "Inventory, record, and back up EnvU installation configuration files.",
  "whenToUse": [
    "Use EnvU Config when you need this node's system workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy EnvU Config from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy EnvU Config to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run EnvU Config directly from a terminal.",
      "cli": [
        "Run `xiranite envuconfig` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite envuconfig --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite envuconfig",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite envuconfig",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite envuconfig --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help envuconfig",
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
