# Mac 是唯一开发机，Windows 与 Linux 的 bug 由 CI 那两条腿找出来

- Status: **accepted** — 2026-10-06 由用户当场判定：开发主力在 Mac，「让 CI 帮我找出来 Windows 端有没有哪些 bug，我在 Mac 上顺便修复，实在修复不了再 SSH 到 Windows 端」；追问范围时他又补「Linux 的 bug CI 也顺便检查一下，我手头没设备、也不怎么用」「允许 CI 直接当首次测试执行场所」「平台的话 AGENTS.md 改一下」。SSH/实机要验什么他说「这个你不用管我，到时候我自己来决定」⇒ **本篇不给实机派活**，只把 CI 这一侧的分工、覆盖与盲区写死。
- Date: 2026-10-06
- Related: `docs/adr/0078-keep-the-quickjs-substrate-in-two-portable-crates.md`（§前置条件那条红是它欠的账；**那篇 ADR 此刻也还在未提交栈里** —— 现测 `git cat-file -e HEAD:docs/adr/0078-keep-the-quickjs-substrate-in-two-portable-crates.md` 失败，而 `but status` 给它的是 `??`/`A` ⇒ 这条链接在推上去的树上暂时是悬的，它和那两个 crate 是同批欠账）、
  `docs/adr/0075-keep-bun-as-runner-and-drop-bun-apis.md`（TS 面为什么必须在别的操作系统上跑）、
  `docs/adr/0077-keep-findz-go-core-as-a-run-scoped-sidecar.md`（Windows `JobObject` 臂，本篇明确它**不在**这张网络里）、
  `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md`（门禁必须查真实构建参数）、
  `AGENTS.md`「正式编译、运行与发布门禁的对象」那条（本篇把它的「Windows 优先」改成 Mac 优先 + CI 找跨 OS bug）

## 为什么这是一条决策，不是一行 YAML

四条现读事实决定了后面所有取舍：

1. **日常开发机只有 macOS 一台**。用户 2026-10-05 已把平台优先级改成 Mac 优先，`AGENTS.md` 里那句「Tauri 2 + Rust 宿主（Windows 优先）」是残留旧口径，本篇一并改掉。Windows 侧确实有一台可免密 SSH 的 Win11（PTEROSAUR），但它的形态是**取证工具**而不是编译机——那台机器上没有仓库，拿原生执行证据的姿势是「平铺 scp 几个 `.rs` + 空 `[workspace]` 的 `Cargo.toml`，远端 `cargo test -j 1`」。
2. **Linux 侧没有任何设备**，用户也不用。但 2026-10-06 现测：那台 Windows 主机装着 WSL2 发行版 `archlinux`（`wsl -l -v` ⇒ `* archlinux Stopped 2`；输出是 UTF-16LE，`iconv` 之后才读得出来，直接看是乱码）。⇒ Linux 并非「只能编译验证」，只是那是另一条 SSH 管路，按上面最后一句用户的话，本篇不替它排程。
3. **仓库是 PUBLIC**（`gh repo view --json visibility` ⇒ `{"visibility":"PUBLIC"}`）⇒ GitHub Actions 的托管分钟数对公开仓库不计费，多跑两条腿的代价是墙钟时间，不是钱。这条直接取消了「Windows 腿太贵所以少跑」这一类论据。
4. **`master` 没有分支保护**（`gh api repos/HibernalGlow/Xiranite/branches/master/protection` ⇒ 404 `Branch not protected`）⇒ 新加的腿红了是一份**报告**，不是拦路。有了这条，才敢把 CI 当首次执行场所（§决策 2）。

## 现状：三条腿各自跑到哪一层（按 2026-10-06 这份 ci.yml 的行号读，不是回忆）

| 层 | ubuntu-latest | windows-latest | macos-latest |
| --- | --- | --- | --- |
| Rust 宿主（`xiranite-core` clippy+lib+回收站+五套集成测、quickjs 三 crate、scripted-nodes、builtin-host check） | 编译**并执行**（`ci.yml:486`、`:504`） | 编译**并执行**（同一批步骤，矩阵腿） | 编译**并执行** |
| `verify` 的门禁链（lint / typecheck 基线 / build / 25 条审计） | ✅ | ❌ 被否决，理由见 §被否决的替代 | ❌ |
| TS 面的**测试**（`src` 应用套 + 逐包套，503 个 `*.test.ts(x)`） | 本篇起 ✅（`ts-faces`，`ci.yml:198`） | 本篇起 ✅ | ❌（云上无 mac 腿；这台机本来就是靠日常开发在跑） |
| `xiranite-desktop`（Tauri 宿主本体） | ❌ | ❌ | ✅ 仅此腿（`ci.yml:601`） |
| Go：findz sidecar | 编译 + 跑管道 | ❌ 从不 | ❌ 从不 |
| Go：browser native host | 编译 | 只**交叉编译**（`ci.yml:255`、`:264`），从不执行 | ❌ |

## 决策

1. **分工**：Mac 只负责「我改的这份能编能跑」；Windows 与 Linux 的问题**由 CI 报出来**，红信本身就是定位，所以在 Mac 上改同一份源码修；修不动才回实机。顺序不许倒过来——先在 Mac 上交叉编译出一个「编得过」的假象，正是本篇要否决的东西（见 §被否决的替代第 1 条）。
2. **CI 允许成为某条测试的首次执行场所**（用户 2026-10-06 当场判定）。这作废了此前默认的前置规矩「先在目标机实测过，才把步骤扩到那条腿」；回收站那条的旧路（`ci.yml:488-504` 记的「按推理排除 Windows ⇒ SSH 实测 4 passed ⇒ 解禁」）不再是模板，只是历史。代价照实说：新腿的第一批红里**既会有真平台 bug，也会有门禁自己的平台假设**（基线台账、夹具里的 POSIX 可写路径、Windows 不归属的 loopback 那类），要逐条判归属，禁止整体重跑到绿。
3. **触发管路**：`push` 覆盖 `master` / `main` / **`xiranite-rust-rewrite`**（`ci.yml:13-20`，后者是 AGENTS.md 钉住的重写分支）+ `pull_request` + `workflow_dispatch`（任意 ref：`gh workflow run ci.yml --ref <branch>`）。**不加 `schedule`**——用户没要，而且见 §被否决的替代第 2 条那条 GitHub 语义。
4. **本次接线 = 新增 `ts-faces` job**（`ci.yml:198`，矩阵 `[ubuntu-latest, windows-latest]`）：`audit:no-bun-apis` + `test:unit`（应用套，`happy-dom` 环境来自 `vite.config.ts:367`）+ `test:packages:turbo`（逐包、逐节点 core 的套；并发由 `scripts/run-turbo.ts:24` 按 runner 自己的核数与空闲内存算，所以不需要额外传 `--maxWorkers`）。为什么补的是这个而不是「给 verify 加一条 Windows 腿」：写本篇前 grep 过整份 `ci.yml`——**`test:unit`、`test:packages`、`vitest` 三个词零命中**，也就是说那 503 个 TS 测试文件在云上任何操作系统上都没执行过，ADR-0075 的尺 `audit:no-bun-apis` 同样从没跑过。所以 TS 层的跨 OS 洞不是「少一条腿」，是**根本没有腿**。
5. **盲区逐条记账，禁止把它写成「CI 覆盖三平台」**——矩阵名会让人以为三条腿等价，这是最容易漂出去的一句话。当前三条真实缺口：
   - `-p xiranite-desktop` 只在 mac 腿（`ci.yml:601`）。不扩的理由**不是**「没测过」，而是它现在任何宿主都编不过（另一条 lane 在接 `src/shell.rs`，`__tauri_command_name_*` 未解析），把步骤扩过去等于宣告一条谁都没见过的绿；Linux 那条腿另外还需要 webkit2gtk 系统库，装不装是独立决策。
   - **Go 不在这张网络里**（用户当场的话就是「这个 CI 只覆盖 rust 和 TS」）：`findz-sidecar` 只 ubuntu（`ci.yml:304`、`:306`），`native-host-compile` 只把 Go 交叉编译到 windows-x64（`ci.yml:255`、`:264`）而从不执行 ⇒ ADR-0077 的 Windows `JobObject` 终止臂仍然零云上执行证据。本篇按他给的范围收口，把这条列为**显式未覆盖项**，不写成已完成。
   - `test:browser`（Vitest Browser Mode，AGENTS.md 指定的 UI/布局回归手段）不在任何腿上 ⇒ UI 回归仍然只有 Mac 一份证据。
6. **诚实口径**：只在某条腿上编译过、没执行过的断言，文档与提交说明必须写成「compile-verified only」，不得升格为「该平台可用」。这条已同步进 `AGENTS.md`，因为它是第 2 条（允许 CI 首次执行）唯一的对冲物——首次执行场所放宽了，措辞纪律就必须收紧。
7. **前置条件（本篇不解决，但它不成立时上面第 1 条只是计划）**：云上四条 job 全死在**第一步**。最近那条 run（`37329010960`，2026-10-05 14:58 在 `xiranite-rust-rewrite` 上 dispatch）1m7s 红，四条 job 同因：`audit:ci-build-targets` 报 `quickjs-host-protocol` / `quickjs-realm` 不是 workspace 成员。本地实测：两 crate 在盘上、`Cargo.toml:26-27` 已把它们列进 `members`、`bun run audit:ci-build-targets` ⇒ `56 mentions … 16 workspace members … ok`；而 `git ls-files crates/quickjs-realm crates/quickjs-host-protocol` ⇒ **0 个被跟踪文件**。⇒ 这是 ADR-0078 那批「workflow 与文档进了提交、crate 本体没进」的同一笔欠账（`ci.yml:405-409` 那段注释写的就是它）。它归那条 lane 的 owner 提交，不在本篇范围；**在它进仓之前，Windows 与 Linux 腿连第一步都过不去**。

## 被否决的替代

- **在 Mac 上交叉编译 Windows 目标当日常门禁**：`x86_64-pc-windows-msvc` 需要 MSVC 头/库与目标链接器，而 `cargo test` 在另一台 OS 上根本无法执行——它给的是「编得过」，本篇要修的恰是「跑得对」。
- **加 `schedule:` 每晚跑全矩阵**：GitHub 的语义是 schedule 只在**默认分支**上的 workflow 文件里生效。本篇要覆盖的是在飞的 `xiranite-rust-rewrite`，定时那条会稳定地测「已经合并的部分」而测不到问题所在；等重写分支合进 `master` 之后要定时再单开，届时有独立价值（能发现无人改动也能长出来的腐烂）。
- **把 `verify` 整体改成 `[ubuntu, windows]` 矩阵**：那条链是 25 个门禁/审计，其中多个读**基线台账**（`audit:typecheck-baseline`、`check:source-size`、`audit:node-cli-surface`），基线是在一台机上生成的。在 Windows 上重放它们会把「真平台 bug」和「基线自己的平台假设」两类红混进同一条腿，而本篇要的正是能分辨的红。
- **给 CI 加编译缓存**（`Swatinem/rust-cache` 或 sccache + 后端）：本篇不做。理由已在 `ci.yml:435-449` 记过一次——开发机上 `du -sh target` 是 33 GB，超出公开的每仓 10 GB 缓存额度，而错 key 的缓存会挤掉别的 job 真正命中的条目；加上分钟数免费，缓存省的是等待不是成本。真要做是一条单独的决策（含凭证问题）。

## 本篇欠另外两条 lane 的说法（`docs/migration/findz-go-sidecar-roadmap.md:806-811` 逐条点名的就是这两句）

那条 lane 记下过「AGENTS.md 引用的 ADR-0082 文件还不存在，权威句悬在一篇没落盘的 ADR 上」，并写明真出现这篇时要由它负责两条：

1. **谁首次执行 Windows 臂** ⇒ 答案是 CI 的 `windows-latest` 腿（§决策 2），不需要先有目标机测量。`crates/xiranite-quickjs-executor` 那批步骤（clippy `--all-targets --no-deps` 加 `-p`，`--lib` 与逐条 `--test` 各一步，findz 侧已量到本机 clippy rc=0）按这篇放行；**那三条步骤不是本篇落的** —— 它们属于 findz lane 的 §8.17，本篇只是把「谁首次执行」这句权威话说完，不再让 ci.yml 的注释里那句「has never been clippy-green from this box」继续当准入条件（那句话现在已被本机实测推翻）。
2. **「compile-verified only」的措辞纪律** ⇒ §决策 6，并已同步进 `AGENTS.md` 那条门禁句。findz 侧 `sidecar/tests.rs` 的 Windows `pid_running` 分支注释已经按这个措辞改过，本篇给它一个可引用的出处。

## 验证

- `actionlint .github/workflows/ci.yml` ⇒ rc=0，零 findings；用 `yaml` 解析同一份文件得到 jobs `verify,ts-faces,native-host-compile,findz-sidecar,rust-host` 与 `on.push.branches = [master, main, xiranite-rust-rewrite]`。
- `bun run audit:ci-build-targets`（本篇新 job 点了 6 个脚本名，正是这把尺该管的东西）⇒ 本地 `56 mentions over 2 workflows against 16 workspace members and 121 scripts — ok`。
- **未验，且故意留给第一次真跑**（按 §决策 2 这就是它们的首次执行场所）：`ts-faces` 整条链；`bun install --frozen-lockfile` 在 windows-latest 上的状态（云上最近那条 run 没走到那一步——它在门禁就停了；`a94b5500` 那次报过它红，此后再无证据）；`test:unit` 与 `test:packages:turbo` 在 Windows runner 上的通过情况；`audit:no-bun-apis` 的云上首次执行。**本篇落盘不等于以上任何一条变绿。**
