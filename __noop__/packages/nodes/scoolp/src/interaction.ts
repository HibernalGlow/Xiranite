import type { InteractionField, InteractionValue, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction";
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n";
import { DEFAULT_SCOOLP_SYNC_TOML, formatSize, type ScoolpAction, type ScoolpInput, type ScoolpResult } from "./core.js";

export type ScoolpInteractionValues = InteractionValues & {
  action: ScoolpAction; bucketPath: string; packageName: string; packages: string;
  scoopDir: string; scoopRoot: string; cachePath: string; configPath: string;
  configText: string; dryRun: boolean;
};
export const defaultScoolpInteractionValues: ScoolpInteractionValues = {
  action: "cache_list", bucketPath: "", packageName: "", packages: "", scoopDir: "",
  scoopRoot: "", cachePath: "", configPath: "", configText: DEFAULT_SCOOLP_SYNC_TOML.trim(), dryRun: true,
};

export function createScoolpInteractionSchema(defaults: Partial<ScoolpInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<ScoolpInput, ScoolpResult> {
  const zh = language === "zh", initialValues: ScoolpInteractionValues = { ...defaultScoolpInteractionValues };
  for (const [key, value] of Object.entries(defaults)) if (value !== undefined) initialValues[key] = value;
  const is = (...actions: ScoolpAction[]) => (values: Readonly<InteractionValues>) => actions.includes(action(values.action));
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "工作区" : "Workspace", kind: "select", role: "action", options: [
      ["status", zh ? "状态" : "Status"], ["list_packages", zh ? "清单" : "Packages"], ["install", zh ? "安装" : "Install"],
      ["sync", zh ? "同步" : "Sync"], ["cache_list", zh ? "缓存" : "Cache"], ["cache_backup", zh ? "备份" : "Backup"], ["cache_delete", zh ? "清理" : "Purge"],
    ].map(([value, label]) => ({ value, label })) },
    { id: "bucketPath", label: "Bucket 目录", kind: "text", visibleWhen: is("list_packages", "package_info", "install") },
    { id: "packageName", label: zh ? "包名" : "Package", kind: "text", visibleWhen: is("package_info") },
    { id: "packages", label: zh ? "安装包（每行一个）" : "Packages", kind: "multiline", lines: 5, visibleWhen: is("install") },
    { id: "scoopDir", label: zh ? "安装目录" : "Install directory", kind: "text", visibleWhen: is("init") },
    { id: "scoopRoot", label: "Scoop 根目录", kind: "text", placeholder: "D:/scoop", visibleWhen: is("cache_list", "cache_backup", "cache_delete") },
    { id: "cachePath", label: zh ? "缓存目录" : "Cache directory", kind: "text", placeholder: "D:/scoop/cache", visibleWhen: is("cache_list", "cache_backup", "cache_delete") },
    { id: "configPath", label: "TOML 配置文件", kind: "text", visibleWhen: is("show_config", "sync") },
    { id: "configText", label: "同步 TOML", kind: "multiline", lines: 7, visibleWhen: is("show_config", "sync") },
    { id: "dryRun", label: zh ? "仅预演" : "Dry run", description: zh ? "关闭后可能安装、移动或删除文件" : "Off performs live system changes", kind: "boolean", visibleWhen: is("init", "install", "sync", "cache_backup", "cache_delete") },
  ];
  return {
    id: "scoolp", title: "Scoolp", description: zh ? "Scoop 软件包、Bucket 同步与缓存清理工作台" : "Scoop package, bucket and cache workbench",
    initialValues, fields,
    view: { sections: [
      { id: "source", title: zh ? "范围" : "Scope", fieldIds: ["action", "bucketPath", "packageName", "packages", "scoopDir", "scoopRoot", "cachePath"] },
      { id: "sync", title: zh ? "同步与安全" : "Sync & safety", fieldIds: ["configPath", "configText", "dryRun"] },
    ], dashboard: { title: zh ? "Scoop 工作台" : "Scoop workbench", display(values) { const input = scoolpInputFromInteractionValues(values); return { primary: label(input.action ?? "status", zh), secondary: input.cachePath || input.bucketPath || input.configPath || input.scoopRoot || "Scoop", metrics: [{ label: zh ? "执行方式" : "Execution", value: input.dryRun !== false ? (zh ? "安全预演" : "Preview") : (zh ? "真实执行" : "Live") }] }; } } },
    toInput: scoolpInputFromInteractionValues,
    validate(_values, input) {
      if (input.action === "install" && !input.packages?.length) return zh ? "至少输入一个安装包。" : "Enter at least one package.";
      if (["cache_list", "cache_backup", "cache_delete"].includes(input.action ?? "") && !input.cachePath && !input.scoopRoot) return zh ? "请输入 Scoop 根目录或缓存目录。" : "Enter a Scoop root or cache path.";
      return null;
    },
    preview(input) { return [`${zh ? "操作" : "Action"}: ${label(input.action ?? "status", zh)}`, input.cachePath ? `Cache: ${input.cachePath}` : input.scoopRoot ? `Scoop: ${input.scoopRoot}` : "", input.dryRun !== false ? (zh ? "安全预演" : "Preview") : (zh ? "真实系统操作" : "Live system action")].filter(Boolean); },
    isDangerous: (input) => input.dryRun === false && ["init", "install", "sync", "cache_backup", "cache_delete"].includes(input.action ?? ""),
    dangerPrompt(input) { return { title: input.action === "cache_delete" ? (zh ? "确认永久删除缓存" : "Confirm permanent cache deletion") : (zh ? "确认真实系统操作" : "Confirm live system action"), body: zh ? `将真实执行“${label(input.action ?? "status", true)}”。请先审阅目标与命令。` : "Review targets and commands before continuing.", confirmLabel: zh ? "确认执行" : "Execute" }; },
    result(result) { const data = result.data; return { success: result.success, message: result.message, lines: data ? [data.cache ? `${zh ? "过期缓存" : "Obsolete"}: ${data.cache.obsoleteCount} · ${formatSize(data.cache.obsoleteSize)}` : "", `${zh ? "成功" : "Success"}: ${data.installedCount + data.cleanedCount}`, `${zh ? "失败" : "Failed"}: ${data.failedCount}`].filter(Boolean) : [] }; },
  };
}

export function scoolpInputFromInteractionValues(values: Readonly<InteractionValues>): ScoolpInput {
  return { action: action(values.action), bucketPath: text(values.bucketPath), packageName: text(values.packageName), packages: String(values.packages ?? "").split(/[\r\n,;]+/).map((v) => v.trim()).filter(Boolean), scoopDir: text(values.scoopDir), scoopRoot: text(values.scoopRoot), cachePath: text(values.cachePath), configPath: text(values.configPath), configText: String(values.configText ?? ""), dryRun: values.dryRun !== false };
}
function action(value: InteractionValue | undefined): ScoolpAction { const allowed: ScoolpAction[] = ["status", "init", "list_packages", "package_info", "install", "show_config", "sync", "cache_list", "cache_backup", "cache_delete"]; return allowed.includes(value as ScoolpAction) ? value as ScoolpAction : "cache_list"; }
function text(value: InteractionValue | undefined) { const result = String(value ?? "").trim(); return result || undefined; }
function label(value: ScoolpAction, zh: boolean) { const map: Record<ScoolpAction, [string, string]> = { status: ["状态检查", "Status"], init: ["初始化", "Initialize"], list_packages: ["包清单", "Packages"], package_info: ["包详情", "Package info"], install: ["安装包", "Install"], show_config: ["配置预览", "Config"], sync: ["同步 Bucket", "Sync buckets"], cache_list: ["扫描缓存", "Scan cache"], cache_backup: ["备份缓存", "Backup cache"], cache_delete: ["永久清理", "Purge cache"] }; return map[value][zh ? 0 : 1]; }
