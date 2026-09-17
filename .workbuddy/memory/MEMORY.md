# Xiranite 项目长期记忆

## 分支与提交

- 主线是 `master`；`neoxide` 承载 NeoView / CanvasReader(WebGPU) / egui 迁移工作。
- 用户的常见诉求是「某个改动两边都要」，且经常先混在某个分支的一个提交里，之后要求**抽成独立提交放到 master**。
  做法：`git checkout <源分支> -- <具体文件路径...>` → 校验 → 独立提交；无需重写源分支历史。
- 提交工具：`bun run commit '<中文 conventional message>' <仓库相对路径...>`
  → `scripts/commit-scope.sh` → `git commit --only`，只提交显式列出的路径，不碰其他人已暂存内容。
  路径必须显式列出（不要用目录），新增文件由脚本自动 `--intent-to-add`。
- 只提交本任务拥有的文件；`vendor/Xiranite-Nexus` 是 submodule（工作区常显示 ` m`），一律不动。

## 已知坑（务必先看）

1. **CRLF 会让 `commit-scope.sh` 直接 exit 2**：本仓库 `core.autocrlf=true`，脚本门禁是
   `git diff --check HEAD -- <paths>`，它把 CRLF 行尾的 `\r` 判为 trailing whitespace，
   于是每个新增行都报错、提交失败。
   解法：提交前把目标文件的工作区内容按索引 blob 重写为 LF
   （`node -e` 里 `execFileSync("git",["show",":"+p])` → `writeFileSync(p,buf)`），再 `git add` 刷新索引，
   门禁即通过，且暂存内容与源分支 byte-identical。注意 `git status` 可能短暂显示 `MM`，以 `git diff` 为准。
2. **源码单文件上限 1000 行、800 行预警**：`bun run check:source-size` 是硬门禁，
   修改历史超长文件（如 `packages/nodes/neoview/src/platform.ts`）时**不得增加行数**。
   需要「注释保留」的代码要外置到同域小文件，原处只留指针注释。
   门禁判定是 `lines > base` 才算失败（**等于 base 可以通过**），所以改动超长文件时要顺手
   在同一函数/用例内压掉等量行数；`src/nodes/neoview/app/ReaderApp.test.tsx`（1436 行）已属此类。
   注意 `Edit` 的 `old_string` 若在文件里不唯一，可能命中**前面**那处而不是你以为的那处，
   改完必须 `git diff` 复核命中位置。
3. **重生成注册表**：`bun run generate:node-registries`（`bun run typecheck` 会先跑它）。
   节点开关在 `xiranite.build.toml` 的 `[nodes].disabled`，共 4 份产物：
   `packages/runtime/src/node-runner.generated.ts`、`src/components/modules/packageModules.generated.ts`、
   `packages/cli/src/node-cli-registry.generated.ts`、`external_node_launch_registry.generated.go`。
   生成日志会打印 `Skipped: <id>, ...` 可作验证。**验证 build/typecheck 时优先 `bunx tsc --noEmit`**，
   避免重生成把工作区弄脏。

## 验证套路

- 「抽出的改动与源分支是否完全一致」：`git diff --cached <源分支> -- <paths>` 为空即一致。
- 「改动规模是否符合预期」：`git diff --stat <base> <branch> -- <paths>` 对比文件数与增删行数。
- 前端测试：Vitest，位置过滤**大小写不敏感**（`.../cards/folder` 会把 `.../cards/FolderMainCard.test.tsx` 一起跑）；
  排查失败文件必须用 `--reporter=json --outputFile` 落盘解析。
