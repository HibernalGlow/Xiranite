import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "Lorat",
  "short": "Collect LoRA downloads, infer triggers, write sidecars, and export TriggerDB JSON.",
  "description": "Collect dropped LoRA files into a library with an optional preview image and trigger sidecar, then manage existing models and TriggerDB JSON.",
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
      "title": "LoRA collection",
      "summary": "Collect a downloaded LoRA into the target library without losing its preview or trigger words.",
      "ui": [
        "Open the Collect tab and drop one or more .safetensors, .ckpt, or .pt files from the desktop app.",
        "Choose the relative library directory, bind an optional image, and edit the trigger tags.",
        "Confirm collection to copy the model, preview image, and .trigger.txt sidecar. Existing files are skipped unless overwrite is enabled."
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
      "short": "收集下载的 LoRA、推断触发词、写入 sidecar 文件，并导出 TriggerDB JSON。",
      "description": "将拖入的 LoRA 收集到模型库，可附带预览图和触发词 sidecar；同时保留已有模型和 TriggerDB 的整理流程。",
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
          "title": "LoRA 收集",
          "summary": "把下载完成的 LoRA 收入指定模型库，同时保留预览图和触发词。",
          "ui": [
            "打开“收集”页，在桌面端拖入一个或多个 .safetensors、.ckpt 或 .pt 文件。",
            "选择相对目录，按需绑定图片并编辑触发词标签。",
            "确认收集后复制模型、预览图和 .trigger.txt sidecar；未开启覆盖时会跳过同名文件。"
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
