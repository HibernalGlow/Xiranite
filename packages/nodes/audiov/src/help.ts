import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "AudioV",
  "short": "Extract audio tracks from video files with the native ffmpeg workflow.",
  "description": "Extract the first audio stream from each video using a fixed AAC/M4A ffmpeg profile.",
  "whenToUse": [
    "Use AudioV when you need this node's video workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy AudioV from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy AudioV to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run AudioV directly from a terminal.",
      "cli": [
        "Run `xiranite audiov` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite audiov --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite audiov",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite audiov",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite audiov --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help audiov",
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
