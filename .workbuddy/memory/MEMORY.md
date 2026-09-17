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

1. **行尾 CRLF 是历史遗留，已清零，但 `commit-scope.sh` 仍会因 CRLF 直接 exit 2**：
   2026-09-15 的 ort merge 在 `core.autocrlf=true` 下把 1853 个文件写成 CRLF，之后该配置被移除、
   CRLF 就变成了"未跟踪脏改动"。2026-09-17 已按索引 blob 全部还原为 LF（真实差异只剩当时改动的 28 个文件）。
   注意：**`git status` 曾经只显示 7 个文件**，是因为 `git pull` 只列出会被覆盖的文件，不是全部脏文件。
   提交前若目标文件仍是 CRLF，把工作区内容按索引 blob 重写为 LF
   （`node -e` 里 `execFileSync("git",["show",":"+p])` → `writeFileSync(p,buf)`）再 `git add`，门禁即通过。
2. **改共享包必须重建 dist 才会生效**：`packages/*/dist` 被 gitignore 且本机可能是很旧的产物
   （2026-09-17 时 `packages/services/dist` 还是 7 月的），而 backend / 宿主是按 `dist` 消费
   `@xiranite/*` 的（`packages/<pkg>/package.json` 的 exports 指向 dist）。改完 `src` 后要么
   单独 `bunx tsc -p tsconfig.json`，要么 `bun run build:packages`，否则测试与运行时用的还是旧代码。
   本包自己的 vitest 用例走源码，容易造成"单测绿、集成仍旧"的假象。
3. **config-history 曾把整仓库提交**：`GitConfigVersionStore` 的仓库路径是 `<dataDir>/.xiranite/config-history`，
   测试数据目录在 `artifacts/test-runs/**`（仓库内部）时，旧实现 `checkIsRepo()` 会误判为已有仓库，
   于是 `git commit --all` 作用到外层 Xiranite 仓库（历史上 19 次，2026-09-17 一次卷走 1881 文件）。
   已于 2026-09-17 改为"必须是仓库根，否则 `git init`"并收紧为只提交快照，附回归用例。
   跑大规模测试前后建议各看一眼 `git log --oneline -1`。
4. **源码单文件上限 1000 行、800 行预警**：`bun run check:source-size` 是硬门禁，
   修改历史超长文件（如 `packages/nodes/neoview/src/platform.ts`）时**不得增加行数**。
   需要「注释保留」的代码要外置到同域小文件，原处只留指针注释。
   门禁判定是 `lines > base` 才算失败（**等于 base 可以通过**），所以改动超长文件时要顺手
   在同一函数/用例内压掉等量行数；`src/nodes/neoview/app/ReaderApp.test.tsx`（1436 行）已属此类。
   注意 `Edit` 的 `old_string` 若在文件里不唯一，可能命中**前面**那处而不是你以为的那处，
   改完必须 `git diff` 复核命中位置。
5. **重生成注册表**：`bun run generate:node-registries`（`bun run typecheck` 会先跑它）。
   节点开关在 `xiranite.build.toml` 的 `[nodes].disabled`，共 4 份产物：
   `packages/runtime/src/node-runner.generated.ts`、`src/components/modules/packageModules.generated.ts`、
   `packages/cli/src/node-cli-registry.generated.ts`、`external_node_launch_registry.generated.go`。
   生成日志会打印 `Skipped: <id>, ...` 可作验证。**验证 build/typecheck 时优先 `bunx tsc --noEmit`**，
   避免重生成把工作区弄脏。

## 平台层与 macOS 兼容

- 共享平台层是 `packages/platform`（`@xiranite/platform`，零运行时依赖）：OS 判定、per-OS
  data/config/cache/state/log 目录、原生库路径变量、path-list 拼接、打开路径命令；
  所有函数接受 `Partial<PlatformContext>`（platform/arch/env/homeDir）便于测试注入。
  **新增跨平台目录/命令逻辑一律走它，不要再写 `process.platform` 分支。**
- Go 侧对应 `platform_data_directory.go` 的 `xiraniteDataDirectory()` / `resolveXiraniteDataDirectory()`，
  保证原生宿主与 Bun 后端解析同一份数据目录；Go 测试用 `redirectXiraniteDataDirectory(t)` 重定向 4 个环境变量。
- 原生产物目前只有 `native/artifacts/win32-x64/**`；darwin/Linux 缺 czkawka / arcthumb / neoxide / slimg 的
  `.node`（需 cargo 构建）；`findz.dll` 是 Go 产物，macOS 可用 `-buildmode=c-shared` 出 `libfindz.dylib`。
  在 macOS 上依赖 czkawka 绑定的 backend 用例（reader sessions、cleanf 集成）会以
  「czkawka native binding was not found ... darwin-arm64」失败，属环境限制。


## 验证套路

- 「抽出的改动与源分支是否完全一致」：`git diff --cached <源分支> -- <paths>` 为空即一致。
- 「改动规模是否符合预期」：`git diff --stat <base> <branch> -- <paths>` 对比文件数与增删行数。
- 前端测试：Vitest，位置过滤**大小写不敏感**（`.../cards/folder` 会把 `.../cards/FolderMainCard.test.tsx` 一起跑）；
  排查失败文件必须用 `--reporter=json --outputFile` 落盘解析。
