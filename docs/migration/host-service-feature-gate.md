# 宿主能力分级 → cargo feature：台账

时间：2026-10-06（本机 10-05 夜）。分支：`xiranite-rust-rewrite`。**本文件记录的四条改动均未提交**，原因见 §6。

## 1. 目标与拍板

独立分发（ADR-0069 §Standalone route A）需要动的 Rust 工作，分成两条正交的账：

- **带哪个节点的 bundle** —— 由 `crates/xiranite-builtin-host/build.rs:18` 那条手写 `const NODE_BUNDLES = &["dissolvef","kisaki"]` 决定，`tauri build --config` 的 overlay 改不动它。这条账的正确杠杆是「构建输入 = 节点 id 子集」，由 manifest 驱动。
- **带哪些宿主能力** —— 这条账才归 cargo feature，feature 集由节点的 `hostRequirements` 推导。

用户 2026-10-06 裁定：两条一起做，先落地第二链路上**必须先存在的那把尺**（生成物声明 ↔ 二进制真实表）。

## 2. 分级词表的实测分布（决定 feature 能省什么）

`docs/xiranite-target-node-manifest.json`（51 条记录，28 条 `retain-rewrite`）：

| tier 组合 | 节点数 |
|---|---|
| recursive-enumeration,file-io | 10 |
| file-io | 4 |
| external-process,recursive-enumeration,file-io | 3 |
| os-native,recursive-enumeration,file-io | 3 |
| os-native,external-process,recursive-enumeration,file-io | 2 |
| external-process | 2 |
| os-native,external-process,file-io | 1 |
| no-host-free-answer,os-native,file-io | 1 |
| external-process,file-io | 1 |
| **pure-logic** | **1** |

结论：`file-io`(24/28) 与 `recursive-enumeration`(14/28) 就是 `xiranite-core` 的主体，裁不掉；可裁的是 external-process / network / os-native / trash 那几项。**分级不能当"独立分发降本"的主杠杆**，它只在该节点没声明某能力时省掉那条引擎。

## 3. 已落地的第一格：声明与真实表的一致性尺

改动面（三处必须同批，`published_services` 是那把尺的唯一真值口）：

- `crates/xiranite-quickjs-executor/src/host_services.rs` —— 新增 `pub fn published_services() -> Vec<&'static str>`，读的就是 `resolve()` 用来分派的那张 `SERVICES` 表本身。
- `crates/xiranite-quickjs-executor/src/lib.rs` —— `pub use host_services::published_services;`。
- `crates/xiranite-scripted-nodes/tests/declared_services_are_answered.rs`（新文件，4 个测试）。

## 4. 为什么真值必须来自二进制，而不是脚本

三条都是实测，不是推理：

- `@ast-grep/napi`（`packages/tauri-migrate/package.json:27`，仓内三把 TS 尺在用）**不支持 Rust**：`parse("rust", …)` 报 `error: rust is not supported in napi`。PATH 上也没有 `ast-grep`/`sg` 二进制。所以"TS 用 AST 读 Rust 表"这条路在本仓是死的。
- 退化成扫源码文本更糟：feature 关掉一行 `HostService{…}` 时源码里那行**还在**（被 `#[cfg]` 门住），尺会照绿——正是 AGENTS.md「门禁必须检查实际构建参数与真实注册表」点名的失效形状。
- 零改动从 `quickjs-run` 取全集合也做不到：`--services <csv>` 是**授权输入**不是表导出，而 `crates/xiranite-quickjs-executor/bundles/kisaki.js` 的 `runKisaki` 内部硬编码调用 `czkawka`，我注入的 `__surface_probe__` 根本到不了 `resolve()`。实测命令与 rc 见 §7。

`#[cfg]` 能不能挂在切片字面量元素上（决定 feature 落地要不要绕道 `cfg!()`）：用 `rustc` 最小编译样本测过，同一份源码 feature OFF 得 `len=2`、ON 得 `len=3`。**合法，不需要绕道**。样本在 `/Users/glow/Base/Code/Freya/.xranite-inflight-20261006/probe/`。

## 5. 这把尺今天能看见什么、看不见什么

`crates/xiranite-scripted-nodes/src/registration.rs` 里生成的 descriptor **一条 `.with_services()` 都没有**（只有 `with_roots`/`walk_tree`/`budget`），对应 `scripts/embed-node-bundles.ts:220` 那条「platform node declares host services this table does not name」——它不是差集校验，而是**只要声明了任何 service 就一律不注册**的永真分支，而表里今天已有 `czkawka/findz/config/os/trash/power` 六个真名，文案已过期。

所以：`every_declared_service_is_answered_by_the_host` 走的是空集合，**只有两条对照测试在真跑**。这不是把尺当绿的理由，记在这里。等价性说明：feature 关掉某个 service 后，声明它的节点走的代码路径与 `a_service_the_host_does_not_answer_is_reported` 里那个假名完全相同（同一个 `unanswerable()`、同一张 `published_services()`），所以对照测到的是机制而非字面量。

**这把尺本身不够**。闭环还需要「生成物真的写出 services 名单」，而那要一张 `hostRequirements` tier → service 名的映射表——`scripts/embed-node-bundles.ts:101-104` 原话是 *inventing them here would be a grant with no source behind it*，所以那张映射不许由我编，须由用户或分析器给。

## 6. 为什么没提交（归属实测）

`but commit` 按路径整文件收。实测这两个文件都混着他人未提交行：

| 文件 | HEAD 行数 | 盘上行数 | 净增 | 其中我的 |
|---|---|---|---|---|
| `host_services.rs` | 218 | 237 | +19 | 11（`published_services`），余 8 是别人的 |
| `executor/src/lib.rs` | 72 | 85 | +13 | 1（`pub use`），余 12 是别人的 |
| `builtin-host/src/lib.rs` | 188 | 196 | +8 | ~7（import + `chain` 展开），余 ~1 是别人的 |
| `builtin-host/Cargo.toml` | 27 | 28 | +1 | 1，全是我加的依赖 |
| `builtin-host/tests/operations.rs` | 295 | 300 | +5 | 5，全是我改的派生断言 |

而 `declared_services_are_answered.rs` 单独提交会造出「提交了引用没提交被引用者」——干净检出必红，所以它必须和 `published_services` 同批；宿主接线那三处同理另成一批。前两个文件混着他人未提交行，`but commit` 整文件收会带走别人的 hunk，AGENTS.md 禁止。**全部留在工作树，等基线落定。**

本会话期间 HEAD 移动了六次：`162dc7dc` → `e5de037d` → `74f49591` → `83939dc2` → `a1375ceb`。撞到的两次并行写入都留了证据：16:28 的 `ClockSleep`（`host_calls.rs:480` 那条红，摘掉我那一行重跑仍 FAILED 才敢归给别人），以及 16:40 的 `NodeRequirements::run_deadline_ms`（`realm_run.rs:58` 报 no field，紧接着 `xiranite-node-registry` 一度语法残缺 `expected identifier, found ,`，约 60 秒后补完、我再验即绿）。

## 7. 验证记录

尺（4/4，含双向对照）：

```
cargo test -p xiranite-scripted-nodes --test declared_services_are_answered -j 1
→ test result: ok. 4 passed; 0 failed … RESTORED_TEST_RC=0
cargo clippy -p xiranite-quickjs-executor --lib --no-deps -j 1 -- -D warnings
→ Finished dev profile … CLIPPY_RC=0
```

宿主接线（三处，含减法跑）：

```
cargo test -p xiranite-builtin-host -j 1
→ test result: ok. 4 passed; 0 failed … HOST_RC=0
cargo test -p xiranite-scripted-nodes --test declared_services_are_answered -j 1
→ test result: ok. 4 passed; 0 failed … GAUGE_RC=0
cargo clippy -p xiranite-builtin-host --all-targets --no-deps -j 1 -- -D warnings
→ Finished dev profile in 21.20s … CLIPPY_RC=0

# 减法跑：摘掉 built_in_registry() 的两条 chain 后
cargo test -p xiranite-builtin-host --test operations the_built_in_host_lists_every_linked_node -j 1
→ FAILED  left: ["dissolvef","kisaki"]  right: [8 ids]  SUBTRACTION_RC=101
# 随后原样恢复，HOST_RC/GAUGE_RC/CLIPPY_RC 均回到 0
```

**一条既存红不是我的**：`host_calls::tests::a_cancel_lands_inside_a_wait_that_would_otherwise_run_for_minutes` 在 `host_calls.rs:480` panic。归属是实测出来的，不是推的：把我那一行 `pub use` 摘掉重跑该测试，仍然 FAILED（`WITHOUT_MY_EXPORT_RC=101`），随后原样恢复。旁证：`quickjs-host-protocol/src/operation.rs` 的 mtime 落在 16:28，而我 16:26 那次 `cargo check -p xiranite-quickjs-executor` 还是绿的——那批 `ClockSleep` 接线是并行会话正在做的。

在途改动备份：`/Users/glow/Base/Code/Freya/.xranite-inflight-20261006/inflight-20261006.tar`，360 个文件 21M（含 176 个未追踪源文件——`crates/quickjs-realm` 与 `crates/quickjs-host-protocol` 当时既不在 HEAD 也不在 index，git 无从恢复）。解包逐文件 sha256 比对 360/360 一致，并做过阳性对照（篡改一份副本必被检出，对照后已还原）。

## 8. 第二格：宿主开始吃生成表（2026-10-06 补）

接线前实测到的事实：**没有任何二进制消费 `xiranite_scripted_nodes`**（`rg -l` 跨 crate 为空），而 `crates/xiranite-builtin-host/src/lib.rs:92-94` 手工 `from_registrations([DISSOLVEF_DESCRIPTOR, KISAKI_DESCRIPTOR], [DISSOLVEF, KISAKI])`，节点靠 `build.rs` 的 const + 每节点一个手写 `kisaki.rs`/`dissolvef.rs`。清单驱动的那张表是悬空的。

改动三处：

- `crates/xiranite-builtin-host/Cargo.toml` —— 加 `xiranite-scripted-nodes = { path = … }`（原先没有，实测过）。
- `crates/xiranite-builtin-host/src/lib.rs` —— `built_in_registry()` 把 `SCRIPTED_REGISTRATIONS` 的两半分别 `chain` 进 descriptors/runnables；宿主节点集合从此由 manifest 决定的生成表给出。
- `crates/xiranite-builtin-host/tests/operations.rs:148` —— 原断言手抄 `vec!["dissolvef","kisaki"]`，改成这两个加 `SCRIPTED_NODE_IDS` 派生后排序比较。这条尺的文案本就是 *"the linked node set is spelled once"*，再抄一遍六个名字正是它要抓的漂移。

宿主现在报 8 个 id：`classq dissolvef kisaki linedup logx nameu samea timeu`。

**减法跑（关掉它必须红）**：临时摘掉 `chain` 两行重跑 ⇒ `the_built_in_host_lists_every_linked_node` FAILED，`left: ["dissolvef","kisaki"]` / `right: [8 个]`，`SUBTRACTION_RC=101`，随后原样恢复。这条尺抓得到"某节点静默停止被链接"，不是空断言。

顺带纠正我上一轮写下的一条判断：**`--node` 子集开关并非"没有消费者的空开关"了**——宿主已经吃生成表，子集改表即改宿主能力面。`embed-node-bundles.ts:69-71` 那条 `keep` 集合仍会让非 `--check` 路径**删掉不在子集里的 `bundles/` 文件**，所以 `--node` 只能过滤注册、不得过滤 bundles 写入与清理。

## 9. 第三格：`--node` 子集（已提交 `baba4274`）

与前两格不同，这一格的文件是干净的（`embed-node-bundles.ts` 只我改、测试是我新建），所以直接进了 `xiranite-rust-rewrite`。

- `--node <id>`（可重复，也接 `--node=<id>`）只过滤 `buildRegistration()` 的注册，**不碰 `bundles/`**。落点选在这里的原因：`:398-402` 那条 `keep` 集合会把不在子集里的 bundle 从工作树删掉，若 `--node` 走同一条路径，一次单节点构建会抹掉其余节点的产物。AGENTS.md 的口径是「独立交付是构建期属性，需要的是构建目标而不是源码树」，所以被排除的节点留在 `bundles/`，带 `"left out of this build by --node; the bundle is still embedded"` 进 `UNREGISTERED_BUNDLES`。
- `--print-registration`：生成的表打到 stdout、一律不写盘。既是 route A 的诊断口，也是这格唯一可测面。
- 未知 id 直接拒（`--node names X but no embedded bundle carries that id; embedded ids are: …`，实测列出 24 个）。静默缩表会让宿主少一个操作员点名的节点。

尺 `scripts/embed-node-bundle-subset.test.ts`：`bun test` 5 pass / 0 fail。每条负断言配同一条正断言（全量构建里那个 id 必须在），并断言签入的 `registration.rs` 摘要前后一致。**减法跑**：把过滤臂改成永假 ⇒ 恰好那两条子集断言红、另三条绿（`DISABLED_RC=1`），还原后回到 5 pass。

既存红不是我的：`--check` 报 25 条 `embedded bundle is stale vs the manifest`，用 `git show HEAD:` 那份脚本同跑出**同样 25 条**；`audit:node-bundles` 的 `bandia/cleanf/enginev/smartzip` 缺 bundle 与 `findz` 的 `Buffer` 越界同属存量。

这一格**没有接进 package.json**——`package.json` 正被他人占用（MM）。跑法：`bun test scripts/embed-node-bundle-subset.test.ts`。

## 9.1 route A 端到端验证（2026-10-06，未新增任何未提交改动）

`--node` 只是脚本参数不算交付，得证明 cargo 真能吃子集表编出少节点的宿主。做法是按「临时换生成物 → 跑宿主测试 → 原样归还并比摘要」：

1. 记 `registration.rs` 摘要 = `61f54bcd…`。
2. `embed --node classq --print-registration > registration.rs` ⇒ `SCRIPTED_NODE_IDS = &["classq"]`，23 个节点带 `left out of this build by --node` 进 `UNREGISTERED_BUNDLES`。
3. `cargo test -p xiranite-builtin-host --test operations` ⇒ **4/4 绿**（`SUBSET_HOST_RC=0`）；一致性尺同批 4/4（`SUBSET_GAUGE_RC=0`）。这条绿本身就是「少节点生效」的证明：期望值派生自 `SCRIPTED_NODE_IDS`，若 `logx` 等仍在 served，`assert_eq` 必红。
4. 归还：`git checkout HEAD --` 后摘要逐字节回到 `61f54bcd…`（`RESTORED EXACTLY`）。

两个顺带查实的东西：

- **porcelain 状态码在这棵树会骗人**。`core/Cargo.toml` 与 `core/src/lib.rs` 显示 `MM`，但 `git diff HEAD` 都是 0 行；`core/src/power.rs` 显示 `+0 −595` 是 Butler 索引标删后 diff 看不见工作树副本的假删除。判归属只能按 `git diff HEAD` 的内容，不能按状态码。
- **`--check` 有一条一直红着的既存臂**：`registration.rs is stale: rerun bun scripts/embed-node-bundles.ts`。重生成出来的差异全在 `UNREGISTERED_BUNDLES` 的原因文案——一类是 manifest 行号被别人在途改动挪了（bitv `:274→:294`、gifu、kisaki、mvz、repacku、sleept），一类是脚本把 ceiling 文案从 `memory_max_pages` 换成了 `maxLiveBytes evidence line` 而生成物没跟着重跑。**不在本任务里顺手重生成**，那会把别人的行号漂移一起带走。

## 9.2 链条打通 + feature 安全网证明（2026-10-06，已提交 `nzu`）

分级到 feature 的链条卡在一个没人注意的字段上：`derive-scripted-policy.ts` 的 `requirementsFromTiers` 返回 `services: []`，而 `FeasibilityNode` 接口**根本没声明** `services`——上游 `artifacts/node-host-requirements.json` 有 4 行带 services（每条自带 `via` 链与调用点）。类型定义把证据丢了，于是 `embed-node-bundles.ts:220` 那条「声明任何 service 就一律不注册」的永真拒绝**成立的前提正是这份中间产物恒空**。

修的是搬运，不是发明：接口收下 `services?: Array<{service,via,file,line}>`，值取 `(node.services ?? []).map(e => e.service)`；tier 永不成名（`os-native` ≠ `os`）。`embed` 侧删永真拒绝、发 `.with_services(&[…])`，差集判据留在 Rust。跑法 `bun scripts/derive-scripted-policy.ts --requirements`（package.json 未接线，那文件是 `MM`）；重跑后 policy 有 3 行 services 非空。

注册表今天仍无一条 `with_services`：`findz`/`kisaki` 缺外部程序名、`linku` 缺 `maxLiveBytes`，三个都各自被上游守卫拒。⇒ 「声明 ⊆ 表」那把尺主断言仍是空集。改由 **manifest 直接喂样本**（`crates/xiranite-quickjs-executor/tests/manifest_services_are_answered.rs`）：它读签入的 `docs/xiranite-target-node-manifest.json` 里 retain-rewrite 行的 `services`，今天就有 `findz/czkawka/config` 三个真样本，3 pass。

**feature 安全网已被证明（这是整条路线成立与否的判据）**：在真实 `SERVICES` 表的 `findz` 元素上挂 `#[cfg(feature = "nonexistent_gate_probe")]` ⇒ 编译通过且该行真的消失（`this build answers only: czkawka, config, os, trash, power`），尺主断言立刻红：

```
the manifest grants ["findz"] but this build answers only: czkawka, config, os, trash, power
  — the row needs a feature listing and a matching descriptor, not a silent refusal at run time
GATE_PROBE_RC=101 → 探针删除后 3 passed, FINAL_RC=0（`nonexistent_gate_probe` 全仓零命中）
```

对照臂一起变红，说明它绑的是真值而不是字面量。⇒ **cargo feature 关掉一个 service，会被这把尺在同一次提交里抓住**，feature 门不是无人看管的裁剪开关。

顺带一条 MSRV 实测：`impl Iterator<Item = &str>` 在这种自由函数签名上是 anonymous-lifetime-in-impl-trait（E0658，rust-version 1.96 下不编译），要写 `fn f<'a>(…: impl Iterator<Item = &'a str>)`。

## 9.3 core 侧能力门（2026-10-06，本批）

`crates/xiranite-core/{Cargo.toml,src/lib.rs}`（两文件相对 HEAD 均 0 行差异，真干净，可单独成批）。五个 feature 默认全开，所以 `cargo build/check/test` 的产物与加这一段之前完全一致。

分组按**实测的依赖使用者**，不按名字联想：

| feature | 模块 | 拖入的唯一 crate |
|---|---|---|
| `trash` | `trash_service` + `trash_journal` | 9 |
| `clipboard` | `clipboard` | 7 |
| `system-info` | `cpu` + `network` | 3 |
| `known-folders` | `known_folders` | 3 |
| `power` | `power` | 1 |

总数口径：唯一 crate 默认 **59** → 全关 **43**，省 **16** 个（各档相加 23 > 16，因为存在共享依赖）。第一次量出「每档 drags_in=0」是假数——`awk '{print $1}'` 取的是 `├──` 树形前缀不是包名，改 `cargo tree --prefix none` 才读出真值；而「102 vs 68」是含重复行的树行数，不能当 crate 数用。

两处只能靠组合跑才暴露的耦合：

1. **`dirs` 不属于 known-folders 一家**：`trash_service.rs:324` 调 `dirs::home_dir()`。`trash = ["dep:trash"]` 单开时 `cannot find module or crate dirs` 直接红 ⇒ 改成 `trash = ["dep:trash", "dep:dirs"]`。默认全开永远看不见这条。
2. **集成测试不会因 feature 关闭而自动跳过**：`cargo check -p xiranite-core --all-targets --no-default-features` 报 `unresolved import xiranite_core::trash_service` ⇒ 补 `[[test]] name="trash_service" required-features=["trash"]`。其余 5 个测试目标只碰未门控模块（逐个 `rg` 过）。

验证矩阵（`-j 1`，sccache）：默认 lib 绿、`--no-default-features` 绿、五档单开各绿、`--all-targets` 默认绿、`--all-targets --no-default-features` 绿；`cargo test -p xiranite-core` 默认组合下 `Running tests/trash_service.rs … 5 passed` 实跑（所以那条 `required-features` 不是让门禁靠 skip 变绿的装饰）；`clippy --all-targets -D warnings` rc=0；**`Cargo.lock` 摘要前后一致**（optional 化没动解析结果，没碰别人那份 MM 的锁）。

**边界（重要）**：这一批只关住 `cargo check -p xiranite-core` 的组合。宿主那条链上 `executor/src/{lib.rs,host_services.rs}` 还在无条件 `mod os_operations` / `use crate::power_operations`，而这两个文件是他人未提交（+50−37 / +19−8）⇒ executor 侧的门必须另成一批，届时 §9.2 那把尺就是它的减法判据。

## 9.4 分级 → feature 的推导与实测 flavor 表（2026-10-06，本批）

`scripts/lib/node-feature-set.ts` + `scripts/node-feature-set.test.ts`（两个新文件，无冲突）。feature 名是本仓自己在 core `[features]` 里定义的**构建词汇**，不是授权数据——授权仍只由 manifest 的 `services`/`programs`/`roots` 决定，由 §9.2 那把尺兜。

28 个保留节点按实测只落进 **3 种 flavor**（`cargo tree --prefix none` 数唯一 crate，基线=今天默认构建 59）：

| flavor | 唯一 crate | 省 | 节点数 |
|---|---|---|---|
| `(none)` | 43 | **16** | 3 — linedup, recycleu, sleept |
| `trash` | 52 | 7 | 18 |
| `clipboard,known-folders,power,system-info,trash` | 59 | 0 | 7 |

`recycleu` 是这张表里唯一反直觉、所以专门去验的一格：它的 tier 是 `external-process`（⇒ 我的推导给它空 flavor），可它的源码确实在弄回收站和剪贴板。按 manifest 复核后确认没问题——`services = None`、`programs = [powershell.exe]`，剪贴板是 `platform.ts:33` 的 `Get-Clipboard -Raw` 经 `proc.exec` 走的，**不经 core 的 trash/clipboard 服务**。⇒ `(none)` 不等于「这节点不需要能力」，而是「它要的那一档（external-process）在 executor 侧还没有 feature 可关」；`unmappedTiers` 存在的意义就是把这句话说出来，而不是假装省掉了。

两条不变式（测试钉住，负向都有对照）：
- 声明出的每个 feature 必须被某个 tier 推到（`uncoveredFeatures` 为空），否则构建词汇与 analyzer 词汇已经漂移。
- 认不出的 tier 一律进 `unmappedTiers`、**绝不**贡献 feature；喂一个 `"never-heard-of"` 时 features 必须仍是空 —— 这条是反空对照：一张什么都不映射的表也能让前一条测绿。

量的时候 `bun test` 里那 6 条绿是靠真数据，不是靠 skip：`the single pure-logic node asks for no feature at all` 的下一句就在断言「多一档的节点必须拿到非空答案」。

第一版实现有一处语法错就直接体现了这台机的坑：对象键 `pure-logic:` 含连字符必须加引号，`bun` 报的是 `Expected "}" but found "-"` 而不是「键名非法」，一眼看不出来。

**减法跑**：把 `{ feature: "known-folders" }` 从 os-native 那组里摘掉 ⇒ 恰好两条红（`every feature … is reachable` 与 `os-native asks for exactly the four …`），另四条不动，还原后回到 6 pass / 0 fail。所以那条"每个 feature 都能被推到"的断言看得见映射缺项。

**类型必须单文件验**：`scripts/` 不在根门禁的 include 里，而 `bun test` 只转译不查类型——第一版 6 条全绿的同时藏着两个真错（`string` 索引 `Partial<Record<Tier,…>>`、`nodes: []` 被推成 `never[]`）。用的命令是
`bunx tsgo --ignoreConfig --noEmit --strict --target esnext --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --types bun,node scripts/lib/node-feature-set.ts scripts/node-feature-set.test.ts`
（少 `--ignoreConfig` 会被 TS5112 挡回，少 `--types bun,node` 会冒出 5 条环境假错。）

## 9.5 route A 收成一条命令（2026-10-06，脚本已完成、批次待绿）

`scripts/build-node-flavor.ts` + `scripts/build-node-flavor.test.ts`（两个新文件）。

**为什么需要它**：实测打包路径根本不调 embed —— `bun run build` = `generate:node-registries && build:packages:turbo && typecheck && vite build && audit:build-chunks`，而 `generate-node-registries.ts` 是前端 registries、与 bundle 无关；`embed-node-bundles` 在 CI 里只以 `--check` 出现（`.github/workflows/ci.yml`）。⇒ 子集态必须手工跑、又必须手工撤销，忘了就给别人留一条红门禁。脚本把撤销做成 `finally` 里按开跑时读到的**原始字节**写回并用摘要断言，**不走** `git checkout HEAD --`（那会抹掉别人在该文件里的未提交内容）。

已被实跑证明的三件事：

1. `--node classq` 全程：写子集表 → `cargo build -p xiranite-builtin-host`（`Finished dev profile in 8.99s`）→ 归还，摘要 `61f54bcd…` 验证通过，`git status` 对该文件为空。
2. **子集真的进了二进制**：临时态下该文件里 `LOGX` 行数为 0，cargo 打印了 `Compiling xiranite-scripted-nodes` 后才编 `xiranite-builtin-host`（13.31s）。不是"构建绿但跑了旧代码"。
3. 要 1 个、表里 0 个 ⇒ 直接失败（`recycleu` 有 bundle 但被生成器拒），不许产出一个静默少服务 flavor。

**当前 3 条测红，红因在这批之外并已定位**（写入时的事实）：`embed-node-bundles.ts` 的 `buildRegistration` 抛 `TypeError: targetManifest.nodes.map is not a function`——那条路径上的 `nodes` 是 **dict（30 个键，bandia…）**，而 `docs/xiranite-target-node-manifest.json` 的 `nodes` 是 **list（51 条）**，两者形状不同。该文件 mtime 停在 16:24:24、约一分钟前另一条 lane 刚把 `requestedPolicy` 的 `ReferenceError` 修掉，错误随之下移，所以这是别人在途的 `--policy` 改造，不归我改。同一批次里不依赖 embed 的 3 条测保持绿。

**改口（16:27）**：上游那条 lane 在 16:26:39 落盘修好，重跑 `embed … --print-registration` rc=0，本批 6 条测随即 **6 pass / 0 fail**（`TEST_RC=0`），subset 尺同步绿，`registration.rs` 在测试跑完后 `git status` 为空。上面那段红是真实的历史状态、不是我这批的缺陷，但结论要跟着事实走：`build-node-flavor.ts` 与它的尺随本批一起提交，不再滞留工作树。

这次意外反倒送了一条非人为构造的证据：**依赖崩掉时，命令仍然归还了生成物**（三次失败跑都打印 `restored, digest verified: 61f54bcd…`），这正是它存在的理由。

## 9.6 step3 的目录缺陷与那条跑不了的打包（2026-10-06）

**打包这一层仍未验证**，原因具体到文件：`node_modules/@tauri-apps/` 里只有 `cli`，**没有 `cli-darwin-arm64`** 原生绑定，`bunx tauri --version` 直接抛错。补它要 `bun add`，而这仓的既有教训是别在仓里 add（会剪掉别人在途的 vendor 锁条目），磁盘此刻也只剩 13G。⇒ `.app` 产物与 `Info.plist` 的验证继续挂着，不在本批谎称做过。

不过这个阻塞暴露了我自己的一行真缺陷：step3 原本写 `run("bunx", ["tauri","build",…])` 而 `run` 的 cwd 是**仓库根**，那里没有 `tauri.conf.json`（它在 `crates/xiranite-desktop/`）。也就是说 step3 从来没真跑过（前面每次都是 `--config` 为 null 跳过），所以这个错一直藏着。

修法与可测性一起处理：`run()` 加 cwd 参数、桌面 crate 作为常量、并把**计划命令**也在 `--dry-run` 下打印出来（含 `[cd crates/xiranite-desktop]`）。于是这条在没有原生绑定的机器上也能被验证：

```
bun test scripts/build-node-flavor.test.ts → 8 pass / 0 fail, TEST_RC=0
tsgo --types bun,node … → TSGO_RC=0
减法跑：把打印的目录改回仓库根 ⇒ 恰好 the planned package command … 红，其余 7 条绿
        还原后回到 8 pass
```

同时补了一条 `--features clipboard,power` 必须原样变成 `--features=xiranite-core/clipboard …` 的断言，因为 feature 名不带包名前缀时 cargo 会报「feature 不存在」而不是「你少了个前缀」，静默丢参数比报错更难查。

## 9.7 闭环验到产品宿主，并改口一条（2026-10-06）

**改口**：上一条写「打包这一层仍未验证，因为 `bunx tauri` 缺原生绑定」——那句的前提是错的。仓内 `node_modules/@tauri-apps/` 确实只有 `cli`（没有 `cli-darwin-arm64`），但**全局那份是好的**：`~/.bun/bin/tauri --version` → `tauri-cli 3.0.0-alpha.4`，与 `crates/xiranite-desktop/Cargo.toml:26` 的 `tauri = "3.0.0-alpha.4"` 对得上。⇒ 命令解析改成优先可用那份，并开 `--tauri-bin` 覆盖；不去 `bun add`（那会重画别人占着的 lock）。

顺带抓到我自己刚写出来的一个真 bug：`--tauri-bin bunx` 会打印成 `bunx build --config …`——丢掉了 `tauri` 子命令，等于让 bunx 去执行任何它自己叫 `build` 的东西。规则定成「可执行文件名不是 `tauri` 时才补子命令」，并由 `the planned package command …` 那条测抓住（改坏时它红）。

**验到产品宿主**：实测确认生产路径吃的是这张表 —— `crates/xiranite-loopback-host/src/launcher.rs:44+` 调 `BuiltInNodeLauncher::new(...)`，而它就是 `xiranite-dev-host` 与 Tauri 窗口共用的后端本体。于是补 `crates/xiranite-loopback-host/tests/staged_nodes_come_from_the_generated_table.rs`（只用已有依赖，没碰任何在途 Cargo.toml）：

```
cargo test -p xiranite-loopback-host --test staged_nodes_come_from_the_generated_table
→ 3 passed, STAGED_RC=0
cargo test -p xiranite-loopback-host（全套）→ 11 / 4 / 6 / 3 全绿，LOOPBACK_RC=0
减法跑：把 built_in_registry() 的两条 chain 摘掉 ⇒ 恰好
  the_generated_table_arrived_rather_than_only_the_two_hand_linked_nodes FAILED
  红因：this host serves only the hand-linked nodes ["dissolvef","kisaki"]; … a `--node`
  subset build would be ignored by the product host   UNWIRED_RC=101
  还原后 `diff <(git show 分支:lib.rs) lib.rs` ⇒ IDENTICAL，无残留
```

三条断言的分工：宿主列出的 id 必须等于 registry 的 id（同源，不许第二处拼写）；宿主必须宽于手写的两个（证生成表真到了）；假 id 必须被同一比较报出来（证前一条不是恒真）。

另记一条自己踩到的假红：用 `cargo test … | rg -m1 "test result"` 判 rc 时，`rg -m1` 读完第一条就关管道，cargo 收到 SIGPIPE 退出 ⇒ `HOST_RC=101` 而实际 4 passed。这台机上「管道尾的 rc」这类坑已经踩过一次，这次是它的变体：**判 rc 的那条命令不许带会提前退出的过滤器**。

## 9.8 成品级取证：运行中的产品宿主自己报名（2026-10-06）

`--verify-host` 把这一层做成了命令的一部分：子集态下重编并启动 `xiranite-dev-host`（与 Tauri 窗口共用 `stage_from_environment()`），读它自己打印的 `staging_summary` 行，再与请求的节点集合**双向**比对。数据目录用 `mkdtempSync` 的临时目录并同时设 `XIRANITE_DATA_DIR`/`XIRANITE_ALLOWED_DIRS`——这不是整洁，是 AGENTS.md 禁止诊断脚本碰用户 live `xiranite.db`。

一条命令跑出来的终态：

```
bun scripts/build-node-flavor.ts --node classq --verify-host
[1/4] this host would serve: classq -> table lists 1 id(s): classq
[2b]  audit line confirms: nodes [classq, dissolvef, kisaki]
[4/4] restored, digest verified: 61f54bcdc038
FINAL_VERIFY_RC=0
```

**减法跑**（摘掉 `built_in_registry()` 的两条 chain 再跑同一条命令）：

```
flavour build failed: the running host serves [dissolvef, kisaki] but this flavour asked for [classq, dissolvef, kisaki]
restored, digest verified: 61f54bcdc038
UNWIRED_VERIFY_RC=1
```

三条性质同时成立：命令会失败、红因说清少服务了什么、**失败路径照样归还签入产物**。还原后 `diff <(git show 分支:lib.rs) lib.rs` ⇒ `IDENTICAL`。

判据抽成 `scripts/lib/node-flavor-assert.ts`（`bun test scripts/node-flavor-assert.test.ts` 6 pass，夹具是上面那行真日志）。抽出来有两个理由：`build-node-flavor.ts` 一 import 就跑，谓词没法在被引用的同时被测；以及比对必须**对称**——只查「请求的节点在不在」会放过一个悄悄留着全部节点的 flavor，而那正是子集分发要关的漏洞，所以「多服务了被排除的节点」单独有一条测。

另外记下并发事实：跑 `pgrep -fl xiranite-dev-host` 时命中的 release 构建（`cargo build --release -p xiranite-loopback-host --bin xiranite-dev-host`）**不是本任务起的**，属另一条 lane 在验 release 产物里的内嵌标记；没有 kill 它，也没有在同一时刻抢跑 release 打包。`.app`/`Info.plist` 那一层仍待验，overlay 覆盖 `productName`/`identifier` 的能力上一轮已验过真产物。

## 10. 下一步（按依赖排序）

1. ~~由用户或 `audit:node-feasibility` 给出 `hostRequirements` → service 名映射~~ **实测：分析器已经给了，不必任何人发明。** `artifacts/node-host-requirements.json` 30 行里有 4 行带 `services`，每条都是带出处的对象而非裸名字：`clipm → config`（`via: aliased @xiranite/config/node -> shims/config-service.ts`，`packages/nodes/clipm/src/platform.ts:2`）、`findz → findz`、`kisaki → czkawka`、`linku → config`。
   ⇒ 闭环变成两处一起改，且两边都有真源：`embed-node-bundles.ts:220` 的永真拒绝改成「照分析器把 services 写进 descriptor」，由 §3 那把 Rust 尺负责「声明 ⊆ 二进制表」。TS 侧仍然拿不到表全集（§4），所以差集那一半的判据留在 Rust 里是对的落点。
2. 那之后 `every_declared_service_is_answered_by_the_host` 才有非空样本，§3 那把尺从"待命"变"生效"。
3. feature 门本体。**已穷尽扫过的改动面**（`rg -l`/`rg -c` 按 `cap::` 与 `mod::` 形式扫 `crates/**/*.rs`；注意 `rg -r` 是 replace 不是 count，第一版扫出的「每个能力都 80」就是这个参数造的假数）：

   > **先读 §12**：这一条讲的五个 feature 都在 `xiranite-core` 的能力面上，量级是 16 个 crate；host 图真正的大头是 `native/czkawka-core` 那份**引擎**依赖，§12 把它做成 per-node feature 并量到 313–316 个 crate。两条账别混。

   | 能力 | 引用者（全部） | 匹配行 |
   |---|---|---|
   | power | `executor/src/power_operations.rs` 一个文件 | 24 |
   | cpu / clipboard / known_folders / network | `executor/src/os_operations.rs` 一个文件 | 1 / 4 / 8 / 1 |
   | trash_service / trash_journal | `core/src/trash_journal.rs`、`core/src/trash_service.rs`、`core/tests/trash_service.rs` | 16 / 6 |
   | os / power / trash / czkawka / findz 五个 service | **只有 `executor/src/host_services.rs`** | 即那张 `SERVICES` 表 |
   | proc | `host_calls.rs`、`machine.rs` | 走 machine surface，不是 service，得单独一档 |
   | watch | `sidecar.rs`、`findz_operations.rs`、`core/src/operation/{state,manager}.rs` | 跨两个 crate，不是单点 |

   要重依赖只需三行：`core/Cargo.toml:34` `trash`、`:39` `arboard`、`:41` `sysinfo`，外加 `executor/Cargo.toml:27` `process-wrap`、`:40` `notify`。
   ⇒ os-native 一档的真实挂载点是 **4 个文件、约 6 处 cfg**（`core/src/lib.rs` 的 mod、`executor/src/lib.rs` 的 mod、`host_services.rs` 的 `use` 与表元素、两个 Cargo.toml）。`#[cfg]` 挂在切片字面量元素上已证合法（§4）。
   **未做的原因（本段已按 `git diff HEAD` 纠正）**：porcelain 状态码在这棵树不可信——`core/src/power.rs` 显示 `+0 −595`，那是 Butler 索引把文件标删后 `git diff HEAD` 看不见工作树副本的**假删除**，不是真被删。按内容实测：`core/Cargo.toml` 与 `core/src/lib.rs` 的 `git diff HEAD` 都是 **0 行（真干净）**，而 `executor/Cargo.toml` +19−8、`executor/src/lib.rs` +50−37 确实混着他人未提交内容（后者是 ADR-0078 的三 crate 分工文档重写）。
   ⇒ 门不能只落 core 侧：只给 `core` 加 `#[cfg]` 而 `executor/src/{lib.rs,host_services.rs}` 还在无条件 `use crate::power_operations` 时，`--no-default-features` 那条臂根本编不过，等于交一把半开的门。executor 侧那两文件腾开之前，这格只能到「预埋 + 默认全开」，验证不了减法。
   HEAD 里仍没有 `quickjs-realm`/`quickjs-host-protocol`（`git cat-file -e` 两个都 ABSENT），所以独立 worktree 做完整减法验证要先搬这两个 crate（实测 184K + 36K）。
4. `build.rs:18` 那条 const 与逐节点 `kisaki.rs`/`dissolvef.rs` 的退役——宿主已吃生成表，它们只是集合的第二处拼写。
5. 把 `--node` 接到 route A 的实际构建流程：`embed --node X` → `cargo build -p xiranite-builtin-host` → `tauri build --config <node>.conf.json`（A1 overlay 只能改 productName/identifier/frontendDist/resources，改不动节点集合，这条现在才闭合）。

## 11. 明确不做

- 不为了这条链路先把他人未提交内容一并提交。
- 不在 TS 侧维护一份手抄的 service 名单（双真源）。
- 不自己发明 tier→service 映射，也不给 `--config` overlay 塞一个选不了节点的空开关。
- 能力档（§9.3 那五个 feature）的体积收益仍未量过，本文不写它的「省了 N MiB」；**引擎档量过了，数字在 §12**。

## 12. 引擎侧的 per-node feature：kisaki 与 findz 两条账（2026-10-06 本批，全部留在工作树）

用户 2026-10-06 01:2x 的构想是「重型节点（kisaki、findz）独立分发，并用 feature 不打包它们相关的 Rust 库来减编译量」。这一格把那句话拆成两条正交的账，然后**分别量了它们各值多少**——结论是一条成立、一条前提就不成立。

### 12.1 先纠正我自己交出去过的三个数

同一轮里我先报过「338 / 230 / 345 个 crate 只经 czkawka 可达」。那三个数是**越界算出来的**：静态解析 `cargo tree` 时把「目标节点之后的所有更深行」当成子树，而没有在遇到第一个「深度 ≤ 目标深度」的行时收口，于是把后面的兄弟依赖一起算了进去。正确口径只有两种，两种都做了：

- 静态（带子树边界）：executor 图 407 个唯一包，只经 czkawka 可达 **316**；builtin-host 441 ⇒ **311**；desktop 553 ⇒ **195**。
- 动态（真正的判据）：**两种 feature 组合各编一遍，比 `cargo tree` 的唯一包集合**，见下表。下面用的是这一份。

写在这里的理由不是自罚，是这条链后面还要被人复用：`cargo tree` 的缩进子树解析很容易写出「看着合理但偏大一档」的尺，而这类尺一旦进了文档就没人再验。

### 12.2 实测：引擎档比能力档大一到两个数量级

`cargo tree -p <crate> -e normal --prefix none` 现算，唯一包名去重；同一棵树两种 feature 组合各跑一次。

| 图 | 默认（两档全开） | `--no-default-features` | 省 |
|---|---|---|---|
| `xiranite-quickjs-executor` | 407 | 91 | **316** |
| `xiranite-builtin-host` | 441 | 127 | **314** |
| `xiranite-loopback-host`（`xiranite-dev-host` 那台无窗口宿主） | 442 | 129 | **313** |
| `xiranite-desktop` | 553 | 553（**开关还没接到这一层**） | 0 |

对照 §9.4 那张「28 个节点只有 3 种 flavor、最省档减 16」的表：那 16 是 **`xiranite-core` 一张图**的口径，而 host 图的大头从来不是 core 的能力，是 `native/czkawka-core` 那份引擎——它把 `czkawka_core 12` 的整个 image / avif / dav1d / rayon 世界拖进 `crates/xiranite-quickjs-executor/Cargo.toml:39` 那条 path 依赖里。⇒ **§9.4 的分级表和这一格是两把不同量级的杠杆，前一格不能拿来回答「独立分发能省多少编译量」。**

体积（同一台 mac arm64、dev profile、`loadavg` 8.9–11.6，`target/debug/xiranite-dev-host`）：

| 组合 | 字节 | 相对默认 |
|---|---|---|
| 默认（czkawka + findz） | 39,038,816 | — |
| 关 czkawka（留 findz） | 20,607,216 | **−17.6 MiB** |
| 关 findz（留 czkawka） | 37,923,408 | −1.1 MiB |
| 两档全关 | 19,436,704 | −18.7 MiB |

跑完把默认构建恢复回 39,038,816 B，工作树里的宿主二进制不是子集态。

墙钟**没量**（这台机当时 load 9–11，别的会话在编同一份 `target/`），所以本节不写任何「省了 N 秒」。省的是**冷构建 / CI / `cargo clean` / 换 lock** 那几次的编译单元数；热增量本来就不重编 czkawka。

### 12.3 findz 那条账：前提不成立，而且反面的路也还没建

用户设想的是「`findz` feature 关掉 ⇒ 它的 sidecar 不会被编进来」。实测三件事把它否了：

1. **sidecar 是 Go 可执行，不在 cargo 图里**。ADR-0077 定的形状是宿主按 run 起子进程，`crates/xiranite-quickjs-executor/src/sidecar.rs:91` 只认 `XIRANITE_SIDECAR_DIR` 与 PATH，而 `sidecar.rs:165` 的注释原话是「packaged executable 落在哪儿仍是 open decision」。全仓 `include_bytes!` 零命中 ⇒ 没有任何 Rust 构建步骤把它「编进来」。
2. **今天也没有任何打包步骤带它**：`crates/xiranite-desktop/tauri.conf.json` 没有 `bundle.resources`（`bundle.active: false`）。⇒ 「关掉 ⇒ 不进包」这句的反面（「开着 ⇒ 进包」） presently 也不成立，要先建的是那道**打包闸门**，不是关它的开关。
3. **`native/prebuilt/<triple>/findz.*.zip`（mac 4.0 MiB / win 8.6 MiB）装的是 `findz.dylib`**——ADR-0053 那份 c-shared 绑定，其绑定条款已被 ADR-0077 作废。它的生产者是 `packages/native-loader/scripts/build-native-assets.ts`，packaging 半段写进 `build/wails/native-assets`，而今天读那个目录的只剩两个 smoke 脚本（`packages/findz-native/scripts/smoke-embedded.ts:10`、`packages/native-loader/scripts/smoke-embedded.mjs:9`）；运行期入口 `packages/native-loader/src/index.ts:46` 读 `XIRANITE_NATIVE_ASSET_ROOT`，全仓**没有任何生产者设置它**（只在一份 9 月的发布计划文档里出现过）。⇒ 这条是待删旧层的残路，不是产品通路，不许在它上面加 flavor 开关。

Rust 侧能关的那点也量了：`findz` feature 只摘掉 dispatch 模块与那一条表元素，**依赖一个都动不了**——`notify` 只有 3 个唯一包是它独占、`process-wrap` 只有 2 个（builtin-host/desktop 图上更是 0，因为别的依赖已经在锁里），而且它们关不掉的真正原因是**引用链不经过 findz**：`machine.rs:44` 无条件 `use crate::sidecar::SidecarTable`，`sidecar.rs:56` 无条件 `use crate::watch::{LibraryWatch, PendingChange}`，`watch.rs:33` 才用 `notify`。sidecar 表是 machine surface 的一部分，不是 Findz 的细节。

⇒ 所以本节的结论按 ADR-0069 的口径重述：**kisaki 的「重」是 Rust 引擎，feature 关得掉且值 313–316 个编译单元；findz 的「重」是 14.9 MB 的 Go 可执行（ADR-0077 体积那节），它的独立分发要靠「带不带那份资源」，而这条路还不存在。**

### 12.4 本批改了什么（6 个文件，全在工作树）

| 文件 | 我的改动 | 该文件相对 HEAD 的总差异 |
|---|---|---|
| `crates/xiranite-quickjs-executor/Cargo.toml` | `[features] default=["czkawka","findz"]`、`czkawka=["dep:xiranite-czkawka-core"]`、`findz=[]`；`xiranite-czkawka-core` 改 optional；`[[test]] czkawka_service required-features=["czkawka"]`；`notify` 上写明为什么不许 optional | +49 −9（余下是 ADR-0077/0078 那批） |
| `crates/xiranite-quickjs-executor/src/lib.rs` | 两个 `#[cfg(feature=…)] mod`；`sidecar`/`watch` 挂 `#[cfg_attr(not(feature="findz"), allow(dead_code))]` | +59 −37（余下是他人 lane 的分工文档重写） |
| `crates/xiranite-quickjs-executor/src/host_services.rs` | 两条 `use` 与各一条 `SERVICES` 表元素上的 `#[cfg(feature=…)]` | +39 −7（含 §3 我那 11 行 `published_services`） |
| `crates/xiranite-builtin-host/Cargo.toml` | `[features]` 转发 + executor 依赖改 `default-features = false` | +12 −1（全是我的） |
| `crates/xiranite-scripted-nodes/Cargo.toml` | executor 依赖改 `default-features = false` | +5 −1（全是我的） |
| `crates/xiranite-loopback-host/Cargo.toml` | 再往下一层转发（`xiranite-dev-host` 才吃得到 flavor） | +12 −1（全是我的） |

`default-features = false` 那三处不是风格：**cargo 的特征合并是按整张图取并集**，只要 `scripted-nodes` 或 `loopback-host` 还吃着 executor 自己的 default，`cargo build -p xiranite-builtin-host --no-default-features` 照样会把 czkawka 链回来——那时那把门只是看着像开了。`desktop` 这一层还没接（553 ⇒ 553 就是证据），差的是它自己 `[features]` 里的两条转发，`crates/xiranite-desktop/Cargo.toml` 当前相对 HEAD 有 7 行他人未提交内容。

`allow(dead_code)` 那两行是**开关关掉后的产物**，不是长期豁免：默认的 `cargo clippy --all-targets -D warnings` 走不到它们（实测默认臂 0 warning），而 `--no-default-features` 臂本来还剩 31 条（sidecar 18 / watch 10 / machine 2），压到 2 条之后剩下的那 2 条落在 `machine.rs:155` 那只访问器上，要一起关死得动 `machine.rs`（他人未提交 +29 行）。

### 12.5 证伪与验证（`-j 1` + sccache，负载 8.9–14.4）

安全网这次是**双向**验的，比 §9.2 那次更进一步——那回是把不存在的 feature 挂到表元素上，这回是真开关：

```
默认组合          cargo test -p xiranite-quickjs-executor --test manifest_services_are_answered → 3 passed, RC=0
关 czkawka        cargo test … --no-default-features --features findz …  → RC=101
  the manifest grants ["czkawka"] but this build answers only: findz, config, os, trash, power
关 findz          cargo test … --no-default-features --features czkawka … → RC=101
  the manifest grants ["findz"] 但这张表当场少了 findz 那一行
还原默认          3 passed, RC=0
```

⇒ **「用 feature 关掉一个引擎 ⇒ 这把尺当场红」已经成立，feature 门不是无人看管的裁剪开关**。尺读的是 `published_services()`（真表），所以 `#[cfg]` 留在源码里的那一行骗不过它。

其余矩阵：`cargo check -p xiranite-quickjs-executor` 默认 / 全关 / 单开 czkawka / 单开 findz 四臂 rc=0；`cargo clippy -p xiranite-quickjs-executor --all-targets --no-deps` **CLEAN**；`cargo clippy -p xiranite-builtin-host --all-targets -- -D warnings` rc=0；`cargo test -p xiranite-builtin-host`（默认）**4/4**；`cargo test -p xiranite-scripted-nodes` 全绿（这一张图里 executor 是**无引擎**建的，仍编得过、测得绿，正是 §12.3 那条链的旁证）；`cargo build -p xiranite-{builtin,loopback}-host --no-default-features` rc=0（少节点的宿主真能编出来）；**`Cargo.lock` 摘要前后一致 `37180026952…`**（把依赖改 optional 没动解析结果，也没碰别人那份锁）。

**一次红没能归掉**：接到 `loopback-host` 之后那轮 `cargo test -p xiranite-builtin-host` 报 `3 passed; 1 failed`，随后连跑三次 4/4。失败那次的窗口里 `crates/xiranite-quickjs-executor/src/findz_operations.rs` mtime 01:41:23、`crates/xiranite-scripted-nodes/src/registration.rs` 01:43:23、HEAD 在这轮里从 `5a04fb6b` 走到 `8696bb01`——同一棵树上有别的会话正在写。同窗口里我还见过两次瞬时编译错（`E0308`、`findz_operations.rs:933` 的 `assert!(reply)` 在几分钟内自己变成 `assert!(reply.is_some())`）。**记成「未归属的瞬时红」，不记成「已证明与我无关」，也不把它算进这把门的验证结论。**

### 12.6 为什么一笔都没提交

`but commit` 按整文件收，而 `crates/xiranite-quickjs-executor/{Cargo.toml,src/lib.rs,src/host_services.rs}` 三个文件都混着他人未提交内容（+49−9 / +59−37 / +39−7，其中他人的部分见上表）。更硬的一条是：**HEAD 里至今没有 `crates/quickjs-realm` 与 `crates/quickjs-host-protocol`**（`git cat-file -e HEAD:crates/quickjs-realm/Cargo.toml` ABSENT），而工作树那份 executor `Cargo.toml` 已把依赖指向这两个 crate。⇒ 提交这个文件就是「提交了引用、被引用者不在提交里」，干净检出必红。`builtin-host` / `scripted-nodes` / `loopback-host` 那三个 Cargo.toml 单独提交也一样会红——它们转发的是 `xiranite-quickjs-executor/czkawka`，而那个 feature 定义还在他人文件里没落地。

所以本批的交付边界是：**文档（这一节）+ 一把已经验证过、留在工作树的门**。按 §11 第一条，不为这条链路把他人未提交内容一并提交。

### 12.7 这一格之后的下一步

1. `crates/xiranite-desktop/Cargo.toml` 补两条转发（它已有 `[features]`），桌面 flavor 才吃得到这 195 个包——现在那一层是 553 ⇒ 553。
2. `machine.rs` 腾开之后，把 `SidecarTable` 那只访问器与 `sidecar`/`watch` 两个 mod 一起挂进 `findz`，那时 `notify`/`process-wrap` 才允许 optional（省 3 + 2 个唯一包，主要收益是**少 2 条 dead_code 警告**、门变成完整闭合）。
3. findz 的独立分发按 §12.3 重开：先回答「Go 可执行怎么进包」（`bundle.resources` + 谁设 `XIRANITE_NATIVE_ASSET_ROOT`，或直接给 sidecar 单开一条资源条目），再谈 flavor 带不带它。**在「开着 ⇒ 进包」存在之前，不做「关掉 ⇒ 不进包」的开关**，那是 §11 点名的空开关形状。
4. 墙钟：如果要把「提升编译速度」写成数字，得在空 `target/` 上分别跑默认与 `--no-default-features`，并标负载；本文暂不写。

