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
      "cli": [
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
  ],
  "translations": {
    "zh-CN": {
      "title": "Lata",
      "short": "列出、规划并执行 Taskfile 任务。",
      "description": "列出、规划并执行 Taskfile 任务。",
      "whenToUse": [
        "当需要从工作区 UI 或 CLI 使用该节点的开发工作流时，使用 Lata。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 Lata，并在节点面板上运行。",
          "ui": [
            "打开模块库，将 Lata 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "运行预览或主操作，查看结果与日志后再应用真实变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接在终端运行 Lata。",
          "cli": [
            "命令支持交互式提示时，运行 `xiranite lata` 进入引导模式。",
            "运行 `xiranite lata --help` 查看该节点命令的完整参数与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite lata",
          "description": "打开节点 CLI，或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite lata",
              "description": "启动该节点的交互式终端工作流。"
            },
            {
              "label": "命令参数",
              "command": "xiranite lata --help",
              "description": "显示节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help lata",
              "description": "在根 CLI 中渲染这条共享帮助条目。"
            }
          ]
        }
      ]
    }
  },
} satisfies NodeHelp
