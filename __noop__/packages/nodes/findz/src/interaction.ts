import type {
  InteractionField,
  InteractionValues,
  TerminalInteractionSchema,
} from "@xiranite/cli-runtime/interaction";
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n";
import type {
  FindzAction,
  FindzInput,
  FindzOutputFormat,
  FindzResult,
} from "./core.js";

export type FindzInteractionValues = InteractionValues & {
  action: FindzAction;
  paths: string;
  where: string;
  followSymlinks: boolean;
  noArchive: boolean;
  longFormat: boolean;
  maxResults: number;
  maxReturnFiles: number;
  continueOnError: boolean;
  withImageMeta: boolean;
  groupBy: string;
  refine: string;
  sortBy: string;
  sortDesc: boolean;
  outputFormat: FindzOutputFormat;
  outputPath: string;
  archiveSeparator: string;
  printZero: boolean;
};

export function createFindzInteractionSchema(
  d: Partial<FindzInteractionValues> = {},
  language: TerminalLanguage = "zh",
): TerminalInteractionSchema<FindzInput, FindzResult> {
  const zh = language === "zh",
    base: FindzInteractionValues = {
      action: "search",
      paths: "",
      where: "1",
      followSymlinks: false,
      noArchive: false,
      longFormat: true,
      maxResults: 0,
      maxReturnFiles: 5000,
      continueOnError: true,
      withImageMeta: false,
      groupBy: "",
      refine: "",
      sortBy: "avgSize",
      sortDesc: true,
      outputFormat: "text",
      outputPath: "",
      archiveSeparator: "//",
      printZero: false,
    },
    initialValues = {
      ...base,
      ...Object.fromEntries(
        Object.entries(d).filter(([, v]) => v !== undefined),
      ),
    } as FindzInteractionValues;
  const fields: InteractionField[] = [
    {
      id: "action",
      label: zh ? "查询动作" : "Query action",
      kind: "select",
      role: "action",
      options: [
        { value: "search", label: zh ? "⌕ 搜索" : "⌕ Search" },
        { value: "archives_only", label: zh ? "▣ 仅归档" : "▣ Archives" },
        { value: "nested", label: zh ? "▦ 嵌套归档" : "▦ Nested" },
        { value: "refine", label: zh ? "◇ 分组精炼" : "◇ Refine" },
        { value: "help", label: zh ? "？过滤帮助" : "? Filter help" },
      ],
    },
    {
      id: "paths",
      label: zh ? "搜索路径" : "Search paths",
      kind: "text",
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "where",
      label: "WHERE",
      kind: "text",
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "groupBy",
      label: zh ? "分组字段" : "Group by",
      kind: "text",
      visibleWhen: (v) => v.action === "refine",
    },
    {
      id: "refine",
      label: zh ? "分组过滤" : "Group filter",
      kind: "text",
      visibleWhen: (v) => v.action === "refine",
    },
    {
      id: "maxResults",
      label: zh ? "上限" : "Limit",
      kind: "number",
      min: 0,
      max: 100000,
      step: 100,
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "maxReturnFiles",
      label: zh ? "返回上限" : "Return limit",
      kind: "number",
      min: 0,
      max: 100000,
      step: 100,
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "noArchive",
      label: zh ? "不进入归档" : "Skip archives",
      kind: "boolean",
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "followSymlinks",
      label: zh ? "跟随链接" : "Follow links",
      kind: "boolean",
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "withImageMeta",
      label: zh ? "图像元数据" : "Image metadata",
      kind: "boolean",
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "outputFormat",
      label: zh ? "输出格式" : "Output format",
      kind: "select",
      options: [
        { value: "text", label: "TEXT" },
        { value: "json", label: "JSON" },
        { value: "csv", label: "CSV" },
        { value: "efu", label: "EFU" },
      ],
      visibleWhen: (v) => v.action !== "help",
    },
    {
      id: "outputPath",
      label: zh ? "输出文件" : "Output path",
      kind: "text",
      visibleWhen: (v) => v.action !== "help",
    },
  ];
  return {
    id: "findz",
    title: "FindZ",
    description: zh
      ? "文件、目录与归档成员查询工作台"
      : "File, directory, and archive member query workbench",
    initialValues,
    fields,
    view: {
      sections: [
        {
          id: "query",
          title: zh ? "查询" : "Query",
          fieldIds: fields.map((x) => x.id),
        },
      ],
      dashboard: {
        title: "FindZ",
        display: (v) => ({
          primary: String(v.where),
          secondary: String(v.paths),
          metrics: [],
        }),
      },
    },
    toInput: (v) => ({
      action: v.action as FindzAction,
      pathText: String(v.paths ?? ""),
      where: String(v.where ?? "1"),
      followSymlinks: v.followSymlinks === true,
      noArchive: v.noArchive === true,
      longFormat: v.longFormat !== false,
      maxResults: Number(v.maxResults ?? 0),
      maxReturnFiles: Number(v.maxReturnFiles ?? 5000),
      continueOnError: v.continueOnError !== false,
      withImageMeta: v.withImageMeta === true,
      groupBy: String(v.groupBy ?? "") || undefined,
      refine: String(v.refine ?? "") || undefined,
      sortBy: String(v.sortBy ?? "avgSize") as FindzInput["sortBy"],
      sortDesc: v.sortDesc !== false,
      outputFormat: v.outputFormat as FindzOutputFormat,
      outputPath: String(v.outputPath ?? "") || undefined,
      archiveSeparator: String(v.archiveSeparator ?? "//"),
      printZero: v.printZero === true,
    }),
    validate(_v, i) {
      return i.action === "help" || i.pathText?.trim()
        ? null
        : zh
          ? "请输入搜索路径。"
          : "Enter a search path.";
    },
    preview: (i) => [
      `${zh ? "动作" : "Action"}: ${i.action}`,
      `WHERE ${i.where ?? "1"}`,
    ],
    isDangerous: () => false,
    result: (r) => ({
      success: r.success,
      message: r.message,
      lines: r.data
        ? [
            `Matches: ${r.data.totalCount}`,
            `Archives: ${r.data.archiveCount}`,
            `Nested: ${r.data.nestedCount}`,
            `Scanned: ${r.data.scannedFiles}`,
          ]
        : [],
    }),
  };
}
