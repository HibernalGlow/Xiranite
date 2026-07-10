import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Lorat",
  "short": "Scan LoRA models, infer triggers, write sidecars, and export TriggerDB JSON.",
  "description": "Scan LoRA models, infer triggers, write sidecars, and export TriggerDB JSON.",
  "whenToUse": [
    "Use Lorat when you need this node's image workflow from either the workspace UI or CLI."
  ],
  "workflows": [
    {
      "title": "Workspace UI",
      "summary": "Deploy Lorat from the module registry and run it from the node surface.",
      "ui": [
        "Open the module registry and deploy Lorat to the current workspace.",
        "Fill the node fields or paste paths/configuration into the node surface.",
        "Run preview or the primary action, then review results and logs before applying live changes."
      ]
    },
    {
      "title": "CLI",
      "summary": "Run Lorat directly from a terminal.",
      "cli": [
        "Run `xiranite lorat` for the guided mode when the command supports interactive prompts.",
        "Run `xiranite lorat --help` for the node command's exact flags and subcommands."
      ]
    }
  ],
  "commands": [
    {
      "title": "Node CLI",
      "command": "xiranite lorat",
      "description": "Open the node CLI or inspect command-specific flags.",
      "examples": [
        {
          "label": "Guided mode",
          "command": "xiranite lorat",
          "description": "Start the node's interactive terminal workflow."
        },
        {
          "label": "Command flags",
          "command": "xiranite lorat --help",
          "description": "Show the node CLI's subcommands and options."
        },
        {
          "label": "Shared help",
          "command": "xiranite help lorat",
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
      "title": "Lorat",
      "short": "扫描 LoRA 模型、推断触发词、写入 sidecar 文件，并导出 TriggerDB JSON。",
      "description": "扫描 LoRA 模型、推断触发词、写入 sidecar 文件，并导出 TriggerDB JSON。",
      "whenToUse": [
        "当需要从工作区 UI 或 CLI 使用该节点的图像工作流时，使用 Lorat。"
      ],
      "workflows": [
        {
          "title": "工作区 UI",
          "summary": "从模块库部署 Lorat，并在节点面板上运行。",
          "ui": [
            "打开模块库，将 Lorat 部署到当前工作区。",
            "填写节点字段，或将路径/配置粘贴到节点面板。",
            "运行预览或主操作，查看结果与日志后再应用真实变更。"
          ]
        },
        {
          "title": "CLI",
          "summary": "直接在终端运行 Lorat。",
          "cli": [
            "命令支持交互式提示时，运行 `xiranite lorat` 进入引导模式。",
            "运行 `xiranite lorat --help` 查看该节点命令的完整参数与子命令。"
          ]
        }
      ],
      "commands": [
        {
          "title": "节点 CLI",
          "command": "xiranite lorat",
          "description": "打开节点 CLI，或查看命令专属参数。",
          "examples": [
            {
              "label": "引导模式",
              "command": "xiranite lorat",
              "description": "启动该节点的交互式终端工作流。"
            },
            {
              "label": "命令参数",
              "command": "xiranite lorat --help",
              "description": "显示节点 CLI 的子命令与选项。"
            },
            {
              "label": "共享帮助",
              "command": "xiranite help lorat",
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
