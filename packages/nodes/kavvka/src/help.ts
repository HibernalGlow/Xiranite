import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Kavvka",
  "short": "Prepare image folders for Czkawka comparison by scanning, moving siblings, and generating include paths.",
  "description": "Prepare image folders for Czkawka comparison by scanning, moving siblings, and generating include paths.",
  "whenToUse": [
    "Use Kavvka when you need this node's image workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Kavvka from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Kavvka to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Kavvka directly from a terminal.",
      "terminal": [
        "Run `xiranite kavvka` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite kavvka --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite kavvka",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite kavvka",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite kavvka --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help kavvka",
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
