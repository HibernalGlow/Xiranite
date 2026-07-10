import type { NodeHelp } from "@xiranite/contract"

export const help = {
  "title": "GitAlso",
  "short": "Safe AI-powered git commit-message assistant wrapping the diny binary.",
  "description": "Wraps the diny CLI binary (`diny commit --print`) to generate AI commit messages from staged git changes. Uses simple-git for local git operations (staged files, diff, commit, push). Does not modify or fork diny source — only depends on the binary being in PATH.",
  "whenToUse": [
    "Use diny when you want AI-generated commit messages from your staged git changes.",
    "Use `generate` to preview a message without committing.",
    "Use `commit` to generate and commit in one step.",
    "Use `push` to generate, commit, and push in one step.",
    "Use `status` to check diny installation and staged file status."
  ],
  "workflows": [
    {
      "title": "Generate → Review → Commit",
      "summary": "Generate a commit message, review it, then commit.",
      "ui": [
        "Open the diny node in the workspace UI.",
        "The node shows staged files and diff preview automatically.",
        "Click 'Generate' to get an AI commit message from diny.",
        "Edit the message if needed, then click 'Commit'.",
        "Optionally click 'Push' to push to remote."
      ],
      "cli": [
        "Run `xdiny status` to check staged files.",
        "Run `xdiny generate` to get an AI message without committing.",
        "Run `xdiny commit` to generate and commit.",
        "Run `xdiny push` to generate, commit, and push."
      ],
      "tips": [
        "Pipe a manual message: `echo 'feat: add login' | xdiny commit`",
        "Use `--dry-run` to preview what would be committed.",
        "Use `--no-verify` to skip pre-commit hooks."
      ]
    }
  ],
  "commands": [
    {
      "title": "Status",
      "command": "xdiny status",
      "description": "Check diny installation and show staged file status.",
      "examples": [
        {
          "label": "Check status",
          "command": "xdiny status",
          "description": "Show diny version, branch, and staged files."
        },
        {
          "label": "Specific repo",
          "command": "xdiny status --path /path/to/repo --json",
          "description": "Check status of a specific repository."
        }
      ]
    },
    {
      "title": "Generate",
      "command": "xdiny generate",
      "description": "Generate a commit message with diny AI without committing.",
      "examples": [
        {
          "label": "Generate message",
          "command": "xdiny generate",
          "description": "Output an AI-generated commit message to stdout."
        },
        {
          "label": "JSON output",
          "command": "xdiny generate --json",
          "description": "Output structured result with git info and message."
        }
      ]
    },
    {
      "title": "Commit",
      "command": "xdiny commit",
      "description": "Generate a commit message and create a git commit.",
      "examples": [
        {
          "label": "Generate and commit",
          "command": "xdiny commit",
          "description": "AI generates message, then commits."
        },
        {
          "label": "Manual message",
          "command": "xdiny commit --message \"feat: add login page\"",
          "description": "Skip AI generation, commit with provided message."
        },
        {
          "label": "Dry run",
          "command": "xdiny commit --dry-run",
          "description": "Preview the commit without actually committing."
        },
        {
          "label": "From stdin",
          "command": "echo \"fix: typo\" | xdiny commit",
          "description": "Read commit message from stdin pipe."
        }
      ]
    },
    {
      "title": "Push",
      "command": "xdiny push",
      "description": "Generate, commit, and push in one step.",
      "examples": [
        {
          "label": "Generate + commit + push",
          "command": "xdiny push",
          "description": "AI generates message, commits, and pushes to origin."
        },
        {
          "label": "Manual message + push",
          "command": "xdiny push -m \"chore: cleanup\" --json",
          "description": "Commit with manual message and push, JSON output."
        }
      ]
    }
  ],
  "fields": [
    { "name": "--path", "type": "string", "description": "Git repository path. Defaults to cwd." },
    { "name": "--dinyPath", "type": "string", "description": "Path to diny binary. Defaults to PATH lookup." },
    { "name": "--message / -m", "type": "string", "description": "Manual commit message. Skips diny AI generation." },
    { "name": "--no-verify", "type": "boolean", "description": "Skip pre-commit hooks." },
    { "name": "--dry-run", "type": "boolean", "description": "Preview without committing or pushing." },
    { "name": "--timeout", "type": "number", "description": "Timeout for diny AI generation in ms. Default: 60000." },
    { "name": "--json", "type": "boolean", "description": "Output structured JSON." }
  ],
  "safety": {
    "defaultMode": "dry-run",
    "destructive": [
      "commit — creates a git commit with the generated or provided message",
      "push — pushes the commit to the remote repository"
    ],
    "notes": [
      "diny binary must be installed and in PATH (or specified via --dinyPath).",
      "Install diny: scoop install diny (Windows) or brew install dinoDanic/tap/diny (macOS).",
      "diny configuration (tone, length, conventional, etc.) is managed by diny itself, not this node.",
      "The node only uses `diny commit --print` — it does not invoke diny's interactive TUI."
    ]
  },
  "links": [
    {
      "label": "diny GitHub",
      "href": "https://github.com/dinoDanic/diny",
      "description": "diny source repository and documentation."
    },
    {
      "label": "diny Releases",
      "href": "https://github.com/dinoDanic/diny/releases",
      "description": "Download pre-built diny binaries."
    }
  ],
  "translations": {
    "zh-CN": {
      "title": "Diny",
      "short": "AI 驱动的 git commit 消息生成器，封装 diny 二进制。",
      "description": "封装 diny CLI 二进制（`diny commit --print`），从 git 暂存区变更生成 AI commit 消息。使用 simple-git 执行本地 git 操作（暂存文件、diff、commit、push）。不修改或 fork diny 源码 — 仅依赖二进制存在于 PATH 中。",
      "whenToUse": [
        "当你想从 git 暂存区变更生成 AI commit 消息时使用。",
        "使用 `generate` 预览消息但不提交。",
        "使用 `commit` 一步生成并提交。",
        "使用 `push` 一步生成、提交并推送。",
        "使用 `status` 检查 diny 安装状态和暂存文件。"
      ],
      "workflows": [
        {
          "title": "生成 → 审查 → 提交",
          "summary": "生成 commit 消息，审查后提交。",
          "ui": [
            "在工作区 UI 中打开 diny 节点。",
            "节点自动显示暂存文件和 diff 预览。",
            "点击'生成'获取 diny AI commit 消息。",
            "如需编辑消息，然后点击'提交'。",
            "可选点击'推送'推送到远程。"
          ],
          "cli": [
            "运行 `xdiny status` 检查暂存文件。",
            "运行 `xdiny generate` 获取 AI 消息但不提交。",
            "运行 `xdiny commit` 生成并提交。",
            "运行 `xdiny push` 生成、提交并推送。"
          ],
          "tips": [
            "管道传入手动消息：`echo 'feat: add login' | xdiny commit`",
            "使用 `--dry-run` 预览将要提交的内容。",
            "使用 `--no-verify` 跳过 pre-commit 钩子。"
          ]
        }
      ],
      "commands": [
        {
          "title": "状态",
          "command": "xdiny status",
          "description": "检查 diny 安装和暂存文件状态。",
          "examples": [
            {
              "label": "检查状态",
              "command": "xdiny status",
              "description": "显示 diny 版本、分支和暂存文件。"
            },
            {
              "label": "指定仓库",
              "command": "xdiny status --path /path/to/repo --json",
              "description": "检查指定仓库的状态。"
            }
          ]
        },
        {
          "title": "生成",
          "command": "xdiny generate",
          "description": "用 diny AI 生成 commit 消息但不提交。",
          "examples": [
            {
              "label": "生成消息",
              "command": "xdiny generate",
              "description": "输出 AI 生成的 commit 消息到 stdout。"
            },
            {
              "label": "JSON 输出",
              "command": "xdiny generate --json",
              "description": "输出包含 git 信息和消息的结构化结果。"
            }
          ]
        },
        {
          "title": "提交",
          "command": "xdiny commit",
          "description": "生成 commit 消息并创建 git 提交。",
          "examples": [
            {
              "label": "生成并提交",
              "command": "xdiny commit",
              "description": "AI 生成消息，然后提交。"
            },
            {
              "label": "手动消息",
              "command": "xdiny commit --message \"feat: add login page\"",
              "description": "跳过 AI 生成，使用提供的消息提交。"
            },
            {
              "label": "预演",
              "command": "xdiny commit --dry-run",
              "description": "预览提交但不实际提交。"
            },
            {
              "label": "从 stdin",
              "command": "echo \"fix: typo\" | xdiny commit",
              "description": "从 stdin 管道读取 commit 消息。"
            }
          ]
        },
        {
          "title": "推送",
          "command": "xdiny push",
          "description": "一步生成、提交并推送。",
          "examples": [
            {
              "label": "生成 + 提交 + 推送",
              "command": "xdiny push",
              "description": "AI 生成消息，提交，并推送到 origin。"
            },
            {
              "label": "手动消息 + 推送",
              "command": "xdiny push -m \"chore: cleanup\" --json",
              "description": "使用手动消息提交并推送，JSON 输出。"
            }
          ]
        }
      ],
      "fields": [
        { "name": "--path", "type": "string", "description": "Git 仓库路径。默认为当前目录。" },
        { "name": "--dinyPath", "type": "string", "description": "diny 二进制路径。默认从 PATH 查找。" },
        { "name": "--message / -m", "type": "string", "description": "手动 commit 消息。跳过 diny AI 生成。" },
        { "name": "--no-verify", "type": "boolean", "description": "跳过 pre-commit 钩子。" },
        { "name": "--dry-run", "type": "boolean", "description": "预览模式，不实际提交或推送。" },
        { "name": "--timeout", "type": "number", "description": "diny AI 生成的超时时间（毫秒）。默认 60000。" },
        { "name": "--json", "type": "boolean", "description": "输出结构化 JSON。" }
      ],
      "safety": {
        "defaultMode": "dry-run",
        "destructive": [
          "commit — 使用生成或提供的消息创建 git 提交",
          "push — 将提交推送到远程仓库"
        ],
        "notes": [
          "diny 二进制必须已安装且在 PATH 中（或通过 --dinyPath 指定）。",
          "安装 diny：scoop install diny（Windows）或 brew install dinoDanic/tap/diny（macOS）。",
          "diny 配置（语气、长度、conventional 等）由 diny 自身管理，不由本节点管理。",
          "本节点仅使用 `diny commit --print` — 不调用 diny 的交互式 TUI。"
        ]
      }
    }
  }
} satisfies NodeHelp
