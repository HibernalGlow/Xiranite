import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "TransQ",
  "short": "Organize translation result files with PackU TransQ.",
  "description": "Organize translation result files with PackU TransQ.",
  "whenToUse": [
    "Use TransQ when you need this node's text workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy TransQ from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy TransQ to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run TransQ directly from a terminal.",
      "cli": [
        "Run `xiranite transq` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite transq --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite transq",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite transq",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite transq --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help transq",
          "description": "Render this shared help entry in the root CLI."
        }
      ]
    }
  ],
  "translations": {
    "zh-CN": {
      "title": "TransQ",
      "short": "使用 PackU TransQ 整理翻译结果文件。",
      "description": "使用 PackU TransQ 整理翻译结果文件。",
      "whenToUse": [
        "需要从工作区 UI 或 CLI 使用该节点的文本流程时，可使用 TransQ。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 TransQ，并在节点面板中运行。",
          "ui": [
            "打开模块库，将 TransQ 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "先运行预览或主操作，确认结果和日志后再应用真实更改。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接从终端运行 TransQ。",
          "cli": [
            "命令支持交互提示时，运行 `xiranite transq` 进入引导模式。",
            "运行 `xiranite transq --help` 查看该节点命令的具体参数和子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite transq",
          "description": "打开节点 CLI 或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite transq",
              "description": "启动该节点的交互式终端流程。"
            },
            {
              "label": "命令参数",
              "command": "xiranite transq --help",
              "description": "查看节点 CLI 的子命令和选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help transq",
              "description": "在根 CLI 中渲染本条共享帮助条目。"
            }
          ]
        }
      ]
    }
  }
} satisfies NodeHelp
