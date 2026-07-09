import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "TransQ",
  "short": "Organize translation result files with PackU TransQ.",
  "description": "Organize translation result files with PackU TransQ.",
  "whenToUse": [
    "Use TransQ when you need this node's text workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy TransQ from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy TransQ to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run TransQ directly from a terminal.",
      "cli": [
        "Run `xiranite transq` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite transq --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite transq",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite transq",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite transq --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help transq",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ]
} satisfies NodeHelp
