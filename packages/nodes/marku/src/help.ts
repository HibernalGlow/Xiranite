import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Marku",
  "short": "Run Markdown cleanup and conversion modules with preview diff.",
  "description": "Run Markdown cleanup and conversion modules with preview diff.",
  "whenToUse": [
    "Use Marku when you need this node's text workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Marku from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Marku to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Marku directly from a terminal.",
      "terminal": [
        "Run `xiranite marku` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite marku --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite marku",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite marku",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite marku --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help marku",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ]
} satisfies NodeHelp
