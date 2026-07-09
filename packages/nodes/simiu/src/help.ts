import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Simiu",
  "short": "Scan image folders and group similar files into managed sets.",
  "description": "Scan image folders and group similar files into managed sets.",
  "whenToUse": [
    "Use Simiu when you need this node's image workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Simiu from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Simiu to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Simiu directly from a terminal.",
      "cli": [
        "Run `xiranite simiu` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite simiu --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite simiu",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite simiu",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite simiu --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help simiu",
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
