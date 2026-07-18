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
  },
  "translations": {
    "zh-CN": {
      "title": "Trename",
      "short": "将文件夹扫描为重命名 JSON，校验翻译目标，执行重命名并撤销。",
      "description": "将文件夹扫描为重命名 JSON，校验翻译目标，执行重命名并撤销。",
      "whenToUse": [
        "需要从工作区 UI 或 CLI 使用该节点的文件流程时，可使用 Trename。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 Trename，并在节点面板中运行。",
          "ui": [
            "打开模块库，将 Trename 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，确认结果和日志后再应用真实更改。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接从终端运行 Trename。",
          "cli": [
            "命令支持交互提示时，运行 `xiranite trename` 进入引导模式。",
            "运行 `xiranite trename --help` 查看该节点命令的具体参数和子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite trename",
          "description": "打开节点 CLI 或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite trename",
              "description": "启动该节点的交互式终端流程。"
            },
            {
              "label": "命令参数",
              "command": "xiranite trename --help",
              "description": "查看节点 CLI 的子命令和选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help trename",
              "description": "在根 CLI 中渲染本条共享帮助条目。"
            }
          ]
        }
      ],
      "safety": {
        "defaultMode": "preview",
        "notes": [
          "更改文件前优先使用预览或试运行模式。",
          "处理大文件夹时保留备份或撤销记录。"
        ]
      }
    }
  }
} satisfies NodeHelp
