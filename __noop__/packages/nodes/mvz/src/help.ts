import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "MVZ",
  "short": "Delete, extract, move, or rename files inside archives from findz output.",
  "description": "Delete, extract, move, or rename files inside archives from findz output.",
  "whenToUse": [
    "Use MVZ when you need this node's file workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy MVZ from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy MVZ to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run MVZ directly from a terminal.",
      "cli": [
        "Run `xiranite mvz` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite mvz --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite mvz",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite mvz",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite mvz --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help mvz",
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
      "title": "MVZ",
      "short": "根据 findz 输出，对归档内的文件执行删除、解压、移动或重命名。",
      "description": "根据 findz 输出，对归档内的文件执行删除、解压、移动或重命名。",
      "whenToUse": [
        "当需要从工作区 UI 或 CLI 使用该节点的文件工作流时，使用 MVZ。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 MVZ，并在节点面板上运行。",
          "ui": [
            "打开模块库，将 MVZ 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "运行预览或主操作，查看结果与日志后再应用真实变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接在终端运行 MVZ。",
          "cli": [
            "命令支持交互式提示时，运行 `xiranite mvz` 进入引导模式。",
            "运行 `xiranite mvz --help` 查看该节点命令的完整参数与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite mvz",
          "description": "打开节点 CLI，或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite mvz",
              "description": "启动该节点的交互式终端工作流。"
            },
            {
              "label": "命令参数",
              "command": "xiranite mvz --help",
              "description": "显示节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help mvz",
              "description": "在根 CLI 中渲染这条共享帮助条目。"
            }
          ]
        }
      ],
      "safety": {
        "defaultMode": "preview",
        "notes": [
          "修改文件前优先使用预览或 dry-run 模式。",
          "处理大文件夹时保留备份或撤销记录。"
        ]
      }
    }
  },
} satisfies NodeHelp
