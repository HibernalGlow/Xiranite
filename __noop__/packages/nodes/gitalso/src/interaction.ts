import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { NodeRunResult } from "@xiranite/contract"
import type { GitalsoAction, GitalsoData, GitalsoInput } from "./core.js"

export type GitalsoInteractionValues = InteractionValues & { action: GitalsoAction; repoPath: string; paths: string; branchName: string; message: string; noVerify: boolean; dryRun: boolean }
const actions: Array<{ value: GitalsoAction; zh: string; en: string }> = [
  { value: "status", zh: "◌ 状态", en: "Status" }, { value: "stage_all", zh: "+ 全部暂存", en: "Stage all" }, { value: "unstage_all", zh: "− 取消暂存", en: "Unstage all" },
  { value: "generate", zh: "✦ 生成提交信息", en: "Generate message" }, { value: "commit", zh: "✓ 提交", en: "Commit" }, { value: "push", zh: "↑ 提交并推送", en: "Commit & push" },
  { value: "fetch", zh: "↓ 获取", en: "Fetch" }, { value: "pull", zh: "⇣ 拉取", en: "Pull" }, { value: "branch_create", zh: "⑂ 新分支", en: "New branch" }, { value: "branch_checkout", zh: "⑂ 切换分支", en: "Checkout" },
]
export function createGitalsoInteractionSchema(defaults: Partial<GitalsoInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<GitalsoInput, NodeRunResult<GitalsoData>> {
  const zh = language === "zh", initialValues: GitalsoInteractionValues = { action: "status", repoPath: "", paths: "", branchName: "", message: "", noVerify: false, dryRun: true, ...defaults }
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "Git 操作" : "Git action", kind: "select", role: "action", options: actions.map((a) => ({ value: a.value, label: zh ? a.zh : a.en })) },
    { id: "repoPath", label: zh ? "仓库路径" : "Repository path", kind: "text" },
    { id: "paths", label: zh ? "文件路径" : "File paths", kind: "path-list", lines: 4 },
    { id: "branchName", label: zh ? "分支名称" : "Branch name", kind: "text" },
    { id: "message", label: zh ? "提交信息" : "Commit message", kind: "multiline", lines: 3 },
    { id: "noVerify", label: zh ? "跳过钩子" : "Skip hooks", kind: "boolean" },
    { id: "dryRun", label: zh ? "仅预演" : "Dry run", kind: "boolean" },
  ]
  return { id: "gitalso", title: "GitAlso", description: zh ? "仓库状态、暂存、提交信息与同步工作台" : "Repository staging and commit workbench", initialValues, fields,
    view: { sections: [{ id: "git", title: "Git", fieldIds: fields.map((f) => f.id) }], dashboard: { title: "GitAlso", display: (v) => ({ primary: String(v.action ?? "status"), secondary: v.dryRun !== false ? "Preview" : "Live", metrics: [] }) } },
    toInput: (v) => ({ action: (actions.some((a) => a.value === v.action) ? v.action : "status") as GitalsoAction, repoPath: String(v.repoPath ?? ""), paths: String(v.paths ?? "").split(/[\r\n;]+/).map((x) => x.trim()).filter(Boolean), branchName: String(v.branchName ?? ""), message: String(v.message ?? ""), noVerify: v.noVerify === true, dryRun: v.dryRun !== false }),
    validate: (_v, input) => input.repoPath?.trim() ? null : (zh ? "请输入仓库路径。" : "Enter a repository path."),
    preview: (input) => [`${zh ? "仓库" : "Repo"}: ${input.repoPath}`, input.dryRun !== false ? (zh ? "安全预演" : "Safe preview") : (zh ? "将修改 Git 工作区" : "Will modify Git worktree")],
    isDangerous: (input) => ["stage_all", "unstage_all", "commit", "push", "pull", "branch_create", "branch_checkout"].includes(input.action ?? "") && input.dryRun === false,
    dangerPrompt: () => ({ title: zh ? "确认 Git 操作" : "Confirm Git operation", body: zh ? "此操作会修改暂存区、分支或提交历史。" : "This action changes staging, branches, or commit history.", confirmLabel: zh ? "确认执行" : "Execute" }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.data?.repository ? [`Branch: ${result.data.repository.branch}`, `Files: ${result.data.repository.files.length}`] : [] }),
  }
}
