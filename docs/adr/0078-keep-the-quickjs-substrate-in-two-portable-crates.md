# QuickJS 底座集中在两个 crate：`quickjs-realm` 与 `quickjs-host-protocol`

- Superseded in part (2026-10-06, by `docs/adr/0083-run-node-cores-in-a-host-owned-node-executor-and-drop-host-authorization.md`
  §10): the **engine** half of this split retires — no realm evaluates node cores any more. The *reason* for the split
  does not: "engine facts and protocol facts get written down in exactly two places" still holds, which is why
  `quickjs-host-protocol` is **renamed (`xiranite-host-protocol`) rather than deleted** — it remains the only authority
  for the wire names, the closed `ALL` list, the text/byte envelopes and the cancel/checkpoint vocabulary. Its
  module docs stay the place a new protocol fact must be written; engine facts there become historical.

- Status: **accepted** — 2026-10-05 由用户判定：「抽这两个 crate 后添加 ADR，不要再分散在各处了，集中在 crate 进行维护」。搬迁与验证均在本篇 §验证 里现测。
- Date: 2026-10-05
- Related: `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md`（§1/§2/§4：一份实现、环境答案归宿主、字节不进 JSON —— 本篇**不推翻**它的任何判断，只搬它落地的地方）、
  `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md`（`NodeRequirements` 与「门禁查真实构建参数」）、
  `docs/adr/0069-keep-node-cli-tui-gui-triad-with-clap-ratatui-react.md`（危险门挂在注册点）、
  `docs/adr/0077-keep-findz-go-core-as-a-run-scoped-sidecar.md`（`service.invoke` 与 sidecar 留在宿主侧）

## 这两个 crate 现在持有什么

| crate | 职责 | 实测 |
| --- | --- | --- |
| `crates/quickjs-host-protocol` | `xrh` 协议本身：30 个 wire 名（`HostOperation`）、两个信封（`HostAnswer` 文本=JSON / 字节=bytes，`HostRefusal` 拒绝即数据）、运行控制字符串（cancel 文本 + 4 个 checkpoint phase：pump / interrupt / wait-while-paused / run-start）、上限（`MAX_PROCESS_OUTPUT_BYTES`/`MAX_RANDOM_BYTES`）、`PROTOCOL_VERSION`，以及 realm 与宿主唯一相遇点 `HostDispatch` | 4 模块 / 491 行 / 依赖只有 `serde_json` / 5 测绿 |
| `crates/quickjs-realm` | 引擎与胶水：一次 run 一个 `Runtime` + 一个全新 `Context`、`__xrh` 桥（`call`/`callAsync`/`callBytes`/`sendBytes`/`now`/`platform`）、异步泵（parked promise 由宿主放行，不是由引擎抢占）、bundle 装载与入口解析、`HostSlot`、host 侧 `digest`/熵/hex | 11 模块 / 3,171 行 / 依赖 `rquickjs` 0.14(`array-buffer`、**bindgen 关**)+`crossbeam-channel`+`serde`+`serde_json`+`sha1`+`sha2`+协议 crate / 25 测绿 |
| `crates/xiranite-quickjs-executor` | **退化成适配器**：`JsNode`（`BuiltInNode` 实现）、`RealmRun`（读 `NodeDescriptor` 得天花板与机器需求、建 `MachineAccess`、`with_files`/`has_grant` 调用形状不变）、`dispatch.rs`（把 `HostDispatch` 三个方法接到本机的 `host_calls::execute`）、所有宿主 arms（fs/proc/config/czkawka/trash/os/power/sidecar/findz/service） | 17 模块 / 6,148 行 / **不再依赖 `rquickjs`、`sha1`、`sha2`** |

搬出前 `crates/xiranite-quickjs-executor` 是 18 个模块 9,798 行、对 `xiranite_*` 有 64 处引用，而引擎管线那 6 个文件（`engine`/`shims`/`jobs`/`bundle`/`host_slot`/`digest`，2,976 行）里真正的类型接缝只有两个：`NodeHost` 与 `FileCapability`。**这就是「别的项目要用还得再写一遍」的实际形状。**

## 决策

1. **依赖方向只有一条**：`executor → realm → protocol`。`rg xiranite crates/quickjs-realm/` 的命中全是注释里的路径引用（`crates/xiranite-native-host/src/lib.rs:46` 那种事实出处），**零代码依赖** —— realm 不认识节点、注册表、授权根，只认 `HostDispatch`。
2. **词表与运行控制字符串的唯一真源在协议 crate**。此前 `host.ts` 的 `OPERATIONS_V1` 与 Rust 的 `HostOperation` 是两份手写镜像，靠 `audit:quickjs-host-ops` 对账；`jobs.rs` 还私存了 `WAIT_CHECKPOINT_PHASE`/`RUN_START_CHECKPOINT_PHASE` 两份字符串拼写。现在拼写只有一处，audit 的读数不变（§验证）。
3. **拒绝类型分两层，不做统一改名**：跨 realm 边界的是 `HostRefusal`（协议），宿主 arms 内部继续用 `CallError`（`xiranite-quickjs-executor/src/host_calls.rs`），转换只在 `host_calls.rs` 的两个 `impl From` 里。理由不是风格：`impl From<FsCapabilityError> for CallError` 与 `CallError::from_host(NodeHostError)` 只能在**定义 `CallError` 的那个 crate** 写，而协议 crate 不许认识 `xiranite-core`/`xiranite-node-registry`（孤儿规则 + 分层同一条）。实测 executor 侧 `CallError` 有 190 处、`?` 转换 14 处，其中 `fs_operations.rs`/`machine.rs` 正被另一条 lane 修改 —— 统一改名会把改动面铺到别人的在途文件上。
4. **答案 JSON 形状不进协议 crate**。`fs.stat` 的键、`proc.poll` 的报告由各 arm 自己产出，因为「拒绝措辞 + 上限 + 授权规则」必须和产生它的那段代码同处一地；在协议里再登记一份形状表**没人读**，那是 AGENTS.md 禁的「绿而假」。协议管的是名字、信封、上限、控制字符串。同一条理由挡掉了另一个诱惑：给 TS 侧补一份 `HOST_CEILINGS` 常量表再让 `audit:quickjs-host-ops` 去对——那些数字在 shim 里只出现在拒绝文案与 surface 说明里，**没有任何运行期读者**，所以那张表只会是一台永远绿、永远抓不到漂移的假门禁。上限的真值就住在产出它的那行 Rust 里（`MAX_PROCESS_OUTPUT_BYTES` 与它 `/4` 的窗口、`machine.rs` 的活子进程转录上限），要改去改代码。
5. **生命周期擦除只允许两处**：`crates/quickjs-realm/src/host_slot.rs`（run 作用域的 host 槽）与 `crates/xiranite-quickjs-executor/src/dispatch.rs`（seam 交下来的 `&mut dyn NodeHost` 生命周期短于 arms 声明的 `'static`）。两处都写明了为什么成立：引用由借用检查器保证活过整次调用，代码里没有任何地方把它存到调用之外。这条不是新造的洞，是把原来藏在 `engine.rs` 里的那一次擦除搬到边界上并说清。
6. **协议代际改成可观测的**：`PROTOCOL_VERSION` 原本只是被导出、没有任何读者，而它自己的注释声称「`xrh-v1` 与 `xrh-v2` 的差异是运维唯一的线索」——那是假话。现在 realm 装桥时把值写到 `globalThis.__xrh.protocol`（`shims.rs` 里一行 `globals.set`，值来自协议 crate），`quickjs-run` 的诊断行开头打出 `protocol=xrh-v1 …`，realm 的桥测把成员从 6 个记到 7 个并**读回断言等于常量本身**（不是又抄一遍字面量，拼写仍然只有一个家）。反证做过：把那行 `globals.set` 断开，测立刻红在 `FromJs { from: "undefined", to: "string" }`，还原后绿。


7. **`publish = false`**：跨项目复用先走 path/git 依赖。发布到 crates.io 需要单独决定名字、semver 承诺和 `xrh` 全局名（`globalThis.__xrh` 是 Xiranite 的拼写，改名是协议升版）。
8. **单点真源由门禁守住，不再靠自觉**：`audit:quickjs-host-ops` 加了规则 7——`HostOperation` 只许在一个文件里定义且必须是协议 crate 那份、别的 `.rs` 不许手抄 `=> "domain.ident"` 映射、`OPERATIONS_V1` 只许在 `packages/quickjs-shims/src/host.ts` 声明一次。两次对照都做过：纯测里 5 条 planted 夹具各自变红（含一条反向对照：TS 里箭头函数返回 `"fs.stat"` **不许**被判红，否则这尺就是台误报机）；端到端再往 `crates/quickjs-realm/src/` 真种一份第二枚举，门禁 rc=1 并指名那两个路径，删掉后 rc=0（夹具当场删除，realm 目录回到 11 个文件）。
9. **文档收口（含活的工单），并顺手清掉一条已经和代码矛盾的旧断言**。`docs/migration/node-quickjs-workorders.{md,json}` 不是历史日志——它带 `status` 字段、当天还被写过，而里面 **30 处**指针指向我搬走或删过行的文件（`executor/src/shims.rs:103` ×29、`host_calls.rs:138-168`、`lib.rs:33-35`），全部现读现改成新位置与新行号（`quickjs-realm/src/shims.rs:124`、`quickjs-host-protocol/src/operation.rs:78-146`、realm 的 `lib.rs` 引擎事实清单）；改完 JSON 仍解析通过（顶层 `meta`/`nodes`），复查残留为 0：`crates/xiranite-quickjs-executor/src/lib.rs` 的 crate 文档原本还写着「realm 里没有字节通道，v1 完全没有二进制路径、只有没有 base64」——那是搬迁前的形状，与 `HostAnswer::Bytes`/`fs.readBytes` 直接冲突。现在该文档改成三张归属表（协议 crate / realm crate / 本 crate 各持有什么）加一条 run 的真实调用链，引擎事实只留指针；`docs/migration/quickjs-substrate-evaluation.md` 顶部加了权威迁移指针（其证据与过程原文保留）。
新增的引擎事实与协议事实**只写进 crate 的模块文档**（realm 的 `lib.rs` 是引擎事实清单：QuickJS-NG/rquickjs 0.14、bindgen 关、`Context::with` 内泵 job 会 RefCell panic、parked await 打不断、无 `Intl`、teardown 顺序）。`AGENTS.md`、`packages/quickjs-shims/README.md`、`scripts/audit-quickjs-host-ops.ts` 的指针已改指这两个 crate；`docs/migration/*` 与 ADR-0074 里的历史记录**不改写** —— 它们是当时的日志，不是今天的权威。

10. **门禁跟着代码走**：`.github/workflows/ci.yml` 的 `Rust host` job 原本只对 `-p xiranite-quickjs-executor --lib` 跑测，两个新 crate 一步都没有 ⇒ 「集中到一个地方维护」会退化成一句没人跑的文档话。现在加了三步（协议 crate 单测、realm `--all-targets`（含那三条独立嵌入测）、两个 crate 的严格 clippy），并且三条命令都是从本机按 CI 里的**原样**跑绿的（`--locked` 也接受 ⇒ `Cargo.lock` 必须与两个 crate 同批进版本控制，否则 CI 第一步就红在锁不相洽）。clippy 那步不是瞎尺：同一条命令在我修掉 5 处 `needless_borrow` 之前返回 rc=101。执行器**仍不在**严格 clippy 名单里（它此刻正被另一条 lane 改 sidecar/trash/findz，那条 lane 自己也没声称在 Windows 上 clippy 绿过 —— 那条注释要求的是逐 crate 实测，不是顺手加名单）。两个新 crate 里没有一处 `cfg(unix)`/`cfg(windows)`/`cfg(target_os)`（实测零命中），所以三条 matrix 腿编的是同一份代码，不像 `xiranite-core` 那样只有 Windows 腿看得见那条臂。

## 明确不做

- `packages/quickjs-shims` 不搬出仓。它是节点面 `node:` 表面的实现，受 AGENTS.md 的「节点 core 不引任何一面 UI 库 / 终端面不 import core 实现」那套契约约束，且它的构建期 `--alias` 接线属于本仓打包管路。
- `crates/xiranite-quickjs-executor/bundles/` 与「节点集合怎么装配」不跟着搬：那是清单驱动（`docs/xiranite-target-node-manifest.json` + `scripts/embed-node-bundles.ts`），跟可移植的引擎无关。
- 不做形状登记表、不做生成器（见决策 4 与被否决 4）。

## 被否决的替代

- **只抽一个 crate（realm 里带协议）**：TS 侧要镜像的名单就得从执行器读，而执行器带着 `xiranite-core`、`czkawka-core`、`process-wrap`。想复用协议的项目必须把整个宿主拖进来 —— 这正是要消除的东西。
- **把 `CallError` 直接搬进协议 crate**：孤儿规则使 `From<FsCapabilityError>`/`from_host` 无法跨 crate 实现，于是 10 个文件里所有 `?` 要改成 `.map_err(...)`；其中两个文件此刻正被另一条 lane 修改。收益（少一个类型）不抵代价。
- **用泛型 `Executor<S: HostDispatch>` 替掉 `dyn`**：`HostSlot` 靠 `'static` 擦除跨回调，泛型会把类型参数铺到 `Pump`/`Bindings`/每一个 JS 回调签名上，且 dyn 本来就是宿主注入点。
- **在协议 crate 里用宏/生成器把名单同时导出成 TS 常量**：audit 已经直接从编译产物 `print-host-ops` 读 `HostOperation::ALL`，两边都是编译值；再加一层生成物就多一本要维护的账，而它替代的只是「文档里手抄一遍」。

## 验证（2026-10-05，本机 macOS arm64，全部 `-j 1` 串行，`RUSTC_WRAPPER=sccache`）

- `cargo test -p quickjs-host-protocol`：**5 passed / 0 failed**。
- `cargo test -p quickjs-realm`：**25 passed / 0 failed**（含 `shims` 的 6 个桥测、`jobs` 的 8 个泵测、`bundle` 4、`digest` 6、`host_slot` 1）。realm 的单测现在跑在一个 op 级 `HostDispatch` 替身上（`crates/quickjs-realm/src/test_dispatch.rs`），它必须复刻真宿主的信封形状 —— 第一版给 `clock.now` 编了 `{"now":…}` 就把这个测打红了，这正是想要的：替身不许自己发明形状。
- `cargo test -p xiranite-quickjs-executor --all-targets`：**116 passed / 0 failed**，逐 target：lib 79、`quickjs-run` bin 4、`cancel_pause` 6、`embedded_bundles` 4、`executor` 12、`every_generated_node_is_served` 3、`process_grants` 3、`shutdown` 5。op→seam 的映射（`fs.readText` 落 `read_text`、`proc.exec` 走白名单）仍钉在 executor 的 `host_calls.rs` 测里，没有因为搬迁而失去读者。
- `bun run audit:quickjs-host-ops`：**OK —— host answers 30 · `OPERATIONS_V1` declares 29 · shim surfaces call 28 · answered-but-unconsumed 0**，1 条既有 WARN（`OPERATIONS_V2_REQUESTED` 还要求 `proc.poll`，而宿主已经答它）。这条门禁从编译产物读名单，因此它就是「搬迁没缩水」的尺。
- `cargo check --workspace --all-targets -j1`：**rc=0、零 error**（唯一 warning 在 `xiranite-desktop` 的 `webview_assets` 测试里，属桌面那条 lane，与本篇无关）。搬走 6 个模块之后，`xiranite-scripted-nodes`/`xiranite-builtin-host`/`xiranite-api` 这些下游 crate 没有一个因为接缝改名而红，因为对外 API 只有 `JsNode`/`HostOperation`/`RealmRun` 三个名字变了形状。
- **可移植性不是推断**：`crates/quickjs-realm/tests/embed.rs`（5 测绿）只用 `quickjs-realm` + `quickjs-host-protocol` 两样东西跑 bundle —— 自己实现 `HostDispatch`、`EngineLimits::from_budgets` 拿天花板、`EntryPlan::pure` 定入口、`Executor::run` 出结果文档，全程没有 `xiranite_*` 类型。五条测盖的是三条最难自研的通道：**同步文本**（`__xrh.call`，并钉住「裸 call 交给 bundle 的是宿主整份 JSON 文档，把 `{path, content}` 拆成字符串是 shim 层 `ops.ts` 的活」、「宿主拒绝的文本原样进 JS 的 `Error.message`」）、**字节双向**（`callBytes` 回来的必须真是 `Uint8Array`，`sendBytes` 发出去的 payload 必须字节对上——读回 `dead002a` 那四条字节就是上一次发出去的那块缓冲，同时证明只有 `crypto.digest` 那次带 payload）、**异步泵**（两次 `await callAsync` 按发起顺序被泵落定，realm 里没有定时器可依赖）。另外钉住「未声明字节预算 ⇒ 调度前就拒」（ADR-0073）。
- **CI 覆盖跟着搬**：`.github/workflows/ci.yml` 的 `rust-host` job 现在有 4 条 QuickJS 步骤（protocol 单测 / realm `--all-targets` / 两 crate 严格 clippy / 执行器 `--lib`），前三条的命令在本机按原样跑过：protocol 5 绿、realm 25+3 绿、clippy rc=0；`--locked` 全部接受。
- 一条不属于本篇的时序抖动如实记下：`proc_operations::tests::a_spawned_child_reports_its_handle_and_the_other_arms_read_it` 在并发负载下红过一次（子进程已 `exitCode 0` 而转录窗口还没读到 `tick`），单跑两次绿。它是 `proc_operations.rs` 里既有的轮询时序测，本篇没改那个文件。**同一条 `--lib` 跑里现在还有第二个负载敏感测**：`sidecar.rs:737` 那条 400 ms 超时断言「拒绝文案要带子进程自己的 stderr」，在本机并发跑 cargo 时读到 `stderr: nothing on stderr`，单跑两次绿（那条测属 sidecar 那条 lane）。两条都在 CI 已有的 `cargo test --locked -p xiranite-quickjs-executor --lib` 那条步里，所以那条步的抖动风险不归本篇，但记在这儿免得下次被当成搬迁的账。另注：本轮开始前该 crate 里 `findz_operations`/`sidecar` 的 5 条红测由另一条 lane 自己修掉了，不是我的改动。 `bun run audit:node-bundles` 本轮红 4 条（bandia/cleanf/enginev/smartzip「注册了但清单里没有 host bundle」），那 4 条读的是 `crates/xiranite-quickjs-executor/bundles/` 与节点清单，本篇一行没碰；同轮 `bun run audit:quickjs-host-ops` 的自测 18 pass / 0 fail。
- 未验证风险：**Windows 侧没跑**。realm 的 `rquickjs` 预生成绑定此前只在 Windows 干净检出上验过执行器（见 `docs/migration` 的 §20 记录），现在引擎换了 crate 名字与依赖归属，`cargo test -p quickjs-realm` 在 msvc 上还需要一次现测；`bun run audit:quickjs-host-ops` 里那条 `cargo build` 只在本机跑过；`cargo clippy -p quickjs-host-protocol -p quickjs-realm -p xiranite-quickjs-executor --all-targets --no-deps -j1 -- -D warnings` 本机 **rc=0**（它抓出并修掉了 5 处 needless borrow，包括 realm 里两处我自己正则留下的）。
