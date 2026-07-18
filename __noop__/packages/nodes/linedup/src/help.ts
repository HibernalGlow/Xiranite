import type { NodeHelp } from "@xiranite/contract"

export const help = {
  title: "Linedup",
  short: "Remove source lines that contain any token from a filter list.",
  description: "Linedup compares source lines with filter tokens, removes matched lines, and returns the kept lines with removal counts.",
  whenToUse: [
    "Clean a source list by subtracting another list of names, IDs, paths, or tags.",
    "Compare two pasted text blocks before committing the kept list back to a file.",
    "Run a repeatable text filtering step from scripts or the Xiranite workspace.",
  ],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Use the node surface for quick paste-and-preview filtering.",
      ui: [
        "Deploy Linedup from the module registry.",
        "Paste source lines and filter tokens into the node fields.",
        "Run the filter action, review kept and removed counts, then copy or download the result.",
      ],
      tips: [
        "Use one token per line when you want predictable removal behavior.",
        "Enable preserve-order behavior when the output should keep the original source order.",
      ],
    },
    {
      title: "CLI files",
      summary: "Use source.txt and filter.txt style inputs for repeatable command-line cleanup.",
      cli: [
        "Place source lines in source.txt and filter tokens in filter.txt.",
        "Run `xiranite linedup` for guided mode or `xiranite linedup filter --sourceFile source.txt --filterFile filter.txt --outputFile output.txt` for scripts.",
        "Inspect output.txt or the terminal output before using the kept list downstream.",
      ],
    },
  ],
  commands: [
    {
      title: "Filter lines",
      command: "xiranite linedup filter",
      description: "Filter inline text or files and print the kept lines.",
      examples: [
        {
          label: "Guided mode",
          command: "xiranite linedup",
          description: "Open the interactive workflow with clipboard and preset file detection.",
        },
        {
          label: "Filter files",
          command: "xiranite linedup filter --sourceFile source.txt --filterFile filter.txt --outputFile output.txt",
          description: "Remove any source line containing a token from filter.txt and write kept lines to output.txt.",
        },
        {
          label: "JSON result",
          command: "xiranite linedup filter --source \"a\\nb\\nc\" --filter \"b\" --json",
          description: "Return kept lines, removed lines, and counts as JSON.",
        },
      ],
    },
  ],
  fields: [
    {
      name: "source",
      type: "text",
      required: true,
      description: "The source lines to keep or remove.",
    },
    {
      name: "filter",
      type: "text",
      required: true,
      description: "Tokens used to remove matching source lines.",
    },
    {
      name: "caseInsensitive",
      type: "boolean",
      description: "Match tokens without case sensitivity.",
      defaultValue: "false",
    },
    {
      name: "preserveOrder",
      type: "boolean",
      description: "Keep output in source order instead of sorting it.",
      defaultValue: "false",
    },
  ],
  safety: {
    defaultMode: "preview",
    notes: [
      "The core filter is non-destructive unless an output file is explicitly written.",
      "When writing an output file, choose a new file first so the source list remains available.",
    ],
  },
  translations: {
    "zh-CN": {
      title: "Linedup",
      short: "从源文本中移除包含任意过滤 token 的行。",
      description: "Linedup 会把源文本行与过滤 token 对比，移除命中的行，并返回保留行和移除统计。",
      whenToUse: [
        "用一份名称、ID、路径或标签列表，从另一份源列表中做减法。",
        "提交保留列表前，先比较两段粘贴文本。",
        "把可重复的文本过滤步骤放进脚本或 Xiranite 工作区。",
      ],
      workflows: [
        {
          title: "工作区 UI",
          summary: "适合快速粘贴文本并预览过滤结果。",
          ui: [
            "从模块库部署 Linedup。",
            "把源文本行和过滤 token 粘贴到节点字段。",
            "运行过滤，查看保留/移除数量，然后复制或下载结果。",
          ],
          tips: [
            "想让移除行为更可预测时，每行放一个 token。",
            "输出需要保持原顺序时，启用 preserve-order 行为。",
          ],
        },
        {
          title: "CLI 文件流",
          summary: "适合用 source.txt 和 filter.txt 做可重复的命令行清理。",
          cli: [
            "把源文本行放到 source.txt，把过滤 token 放到 filter.txt。",
            "运行 `xiranite linedup` 进入引导模式，或用 `xiranite linedup filter --sourceFile source.txt --filterFile filter.txt --outputFile output.txt` 写脚本。",
            "下游使用前，检查 output.txt 或终端输出。",
          ],
        },
      ],
      commands: [
        {
          title: "过滤行",
          command: "xiranite linedup filter",
          description: "过滤内联文本或文件，并打印保留行。",
          examples: [
            {
              label: "引导模式",
              command: "xiranite linedup",
              description: "打开交互式流程，并检测剪贴板和约定文件。",
            },
            {
              label: "过滤文件",
              command: "xiranite linedup filter --sourceFile source.txt --filterFile filter.txt --outputFile output.txt",
              description: "移除 source.txt 中包含 filter.txt token 的行，并把保留行写到 output.txt。",
            },
            {
              label: "JSON 结果",
              command: "xiranite linedup filter --source \"a\\nb\\nc\" --filter \"b\" --json",
              description: "以 JSON 返回保留行、移除行和统计数量。",
            },
          ],
        },
      ],
      fields: [
        {
          name: "source",
          type: "text",
          required: true,
          description: "待保留或移除的源文本行。",
        },
        {
          name: "filter",
          type: "text",
          required: true,
          description: "用于移除匹配源文本行的 token。",
        },
        {
          name: "caseInsensitive",
          type: "boolean",
          description: "忽略大小写匹配 token。",
          defaultValue: "false",
        },
        {
          name: "preserveOrder",
          type: "boolean",
          description: "保持源文本顺序，而不是对输出排序。",
          defaultValue: "false",
        },
      ],
      safety: {
        defaultMode: "preview",
        notes: [
          "核心过滤逻辑不破坏原数据，除非显式写入输出文件。",
          "写输出文件时，优先选择新文件，保留原始源列表。",
        ],
      },
    },
  },
} satisfies NodeHelp
