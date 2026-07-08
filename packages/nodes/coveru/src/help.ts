import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "CoverU",
  "short": "Extract and convert archive cover images with PackU CoverU.",
  "description": "Extract and convert archive cover images with PackU CoverU.",
  "whenToUse": [
    "Use CoverU when you need this node's image workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy CoverU from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy CoverU to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run CoverU directly from a terminal.",
      "terminal": [
        "Run `xiranite coveru` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite coveru --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite coveru",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite coveru",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite coveru --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help coveru",
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
