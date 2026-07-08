import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "ClassF",
  "short": "Orchestrate classification by calling PackU samea, crashu, and migratef logic.",
  "description": "Orchestrate classification by calling PackU samea, crashu, and migratef logic.",
  "whenToUse": [
    "Use ClassF when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy ClassF from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy ClassF to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run ClassF directly from a terminal.",
      "terminal": [
        "Run `xiranite classf` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite classf --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite classf",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite classf",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite classf --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help classf",
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
