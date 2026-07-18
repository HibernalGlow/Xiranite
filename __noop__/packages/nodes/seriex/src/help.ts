import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Seriex",
  "short": "Detect related archive files, plan series folders, and move them safely.",
  "description": "Detect related archive files, plan series folders, and move them safely.",
  "whenToUse": [
    "Use Seriex when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Seriex from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Seriex to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Seriex directly from a terminal.",
      "cli": [
        "Run `xiranite seriex` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite seriex --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite seriex",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite seriex",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite seriex --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help seriex",
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
  },
  "translations": {
    "zh-CN": {
      "title": "Seriex",
      "short": "检测相关归档文件，规划系列文件夹，并安全地移动它们。",
      "description": "检测相关归档文件，规划系列文件夹，并安全地移动它们。",
      "whenToUse": [
        "需要从工作区 UI 或 CLI 使用此节点的文件工作流时，可使用 Seriex。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 Seriex，并在节点面板中运行。",
          "ui": [
            "打开模块库，将 Seriex 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，查看结果与日志后再实际应用变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接在终端中运行 Seriex。",
          "cli": [
            "当命令支持交互式提示时，运行 `xiranite seriex` 进入引导模式。",
            "运行 `xiranite seriex --help` 查看节点命令的具体标志与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite seriex",
          "description": "打开节点 CLI 或查看命令专属标志。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite seriex",
              "description": "启动节点的交互式终端工作流。"
            },
            {
              "label": "命令标志",
              "command": "xiranite seriex --help",
              "description": "查看节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help seriex",
              "description": "在根 CLI 中渲染此共享帮助条目。"
            }
          ]
        }
      ],
      "safety": {
        "defaultMode": "preview",
        "notes": [
          "修改文件前，优先使用预览或试运行模式。",
          "处理大型文件夹时，请保留备份或撤销记录。"
        ]
      }
    }
  }
} satisfies NodeHelp
