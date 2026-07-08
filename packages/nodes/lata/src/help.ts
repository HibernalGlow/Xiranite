import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Lata",
  "short": "List, plan, and execute Taskfile tasks.",
  "description": "List, plan, and execute Taskfile tasks.",
  "whenToUse": [
    "Use Lata when you need this node's dev workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Lata from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Lata to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Lata directly from a terminal.",
      "terminal": [
        "Run `xiranite lata` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite lata --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite lata",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite lata",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite lata --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help lata",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ]
} satisfies NodeHelp
