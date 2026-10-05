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

## 10. 下一步（按依赖排序）

1. ~~由用户或 `audit:node-feasibility` 给出 `hostRequirements` → service 名映射~~ **实测：分析器已经给了，不必任何人发明。** `artifacts/node-host-requirements.json` 30 行里有 4 行带 `services`，每条都是带出处的对象而非裸名字：`clipm → config`（`via: aliased @xiranite/config/node -> shims/config-service.ts`，`packages/nodes/clipm/src/platform.ts:2`）、`findz → findz`、`kisaki → czkawka`、`linku → config`。
   ⇒ 闭环变成两处一起改，且两边都有真源：`embed-node-bundles.ts:220` 的永真拒绝改成「照分析器把 services 写进 descriptor」，由 §3 那把 Rust 尺负责「声明 ⊆ 二进制表」。TS 侧仍然拿不到表全集（§4），所以差集那一半的判据留在 Rust 里是对的落点。
2. 那之后 `every_declared_service_is_answered_by_the_host` 才有非空样本，§3 那把尺从"待命"变"生效"。
3. feature 门本体。**已穷尽扫过的改动面**（`rg -l`/`rg -c` 按 `cap::` 与 `mod::` 形式扫 `crates/**/*.rs`；注意 `rg -r` 是 replace 不是 count，第一版扫出的「每个能力都 80」就是这个参数造的假数）：

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
- 体积收益未量过，本文不写任何「省了 N MiB」。
