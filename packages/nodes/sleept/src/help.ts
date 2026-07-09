import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Sleept",
  "short": "System timer for countdown, scheduled time, network, and CPU triggers.",
  "description": "System timer for countdown, scheduled time, network, and CPU triggers.",
  "whenToUse": [
    "Use Sleept when you need this node's system workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Sleept from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Sleept to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Sleept directly from a terminal.",
      "cli": [
        "Run `xiranite sleept` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite sleept --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite sleept",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite sleept",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite sleept --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help sleept",
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
