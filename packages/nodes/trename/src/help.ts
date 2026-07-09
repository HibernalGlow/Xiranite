import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Trename",
  "short": "Scan folders into rename JSON, validate translated targets, rename, and undo.",
  "description": "Scan folders into rename JSON, validate translated targets, rename, and undo.",
  "whenToUse": [
    "Use Trename when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Trename from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Trename to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Trename directly from a terminal.",
      "cli": [
        "Run `xiranite trename` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite trename --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite trename",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite trename",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite trename --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help trename",
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
