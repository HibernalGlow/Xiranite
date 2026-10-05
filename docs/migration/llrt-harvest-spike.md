# LLRT 模块搬运 spike —— 实测判决（2026-10-05）

问题只有一个：**QuickJS realm 里那层 Node/Web API，能不能不自己维护，改成用 AWS LLRT 的实现。**
spike 在仓库外跑，没有改动任何被跟踪文件；本文只记录读到的数与判出来的落点。

## 1. 结论

| 判定 | 内容 | 证据 |
|---|---|---|
| ✅ 可搬（全局臂，零 loader） | `navigator` `exceptions` `events` `console` `util` `url` `buffer` `stream_web` `abort` `async_hooks` 共 11 个 `init(ctx)` 全部装上并**真跑出值** | probe `--suite` 11/11 绿、`INSTALLED 11`；行为探针 `hit:1`/`false->true`/`97,98`/`AbortError:boom` |
| ✅ 可搬（模块臂，只需 15 行宿主 loader） | 9 个 `ModuleDef` 里 **8 个能被真 `import` 并用出语义值**，**不需要采用 LLRT 的 `llrt_modules`** | `all-modules`：`path:0 util:0 events:0 url:0 console:0 buffer:0 stream_web:0 async_hooks:0`；唯一红的是 `string_decoder`（`state=Rejected`，补装 `stream_web` 全局后仍红） |
| ⛔ 不搬 | **`llrt_timers`**：`init` 能装、`typeof setTimeout === "function"`，**一调用就 panic** | `settimeout-call` **REAL_RC=134**，panic 在 `rquickjs-core-0.14.0/src/runtime/opaque.rs:154`；它走 `ctx.spawn_exit_simple`（`llrt_timers/src/lib.rs:276`）= AsyncCtx，我们的 realm 是同步 Runtime |
| ⛔ 不搬 | **`llrt_stream_web` 的读写路径**：类型装了，`reader.read()` 泵 200 轮不落地 | `readablestream-read-one` → `"pending"`，`AFTER_PUMP "undefined"`，rc=0（**假绿形状**） |
| ⛔ 不搬 | **`llrt_modules` 整块**：它按 feature 把 **40 个 crate**（fs/crypto/tls/http/net/dgram/child_process…）全拖进来 | `cargo metadata rc=101`，vendored 从 20 → 40；这就是「完整 runtime」形状，与既定方向相反 |
| ⚠️ 前提已解除 | **不需要 nightly**（见 §5 收回） | 全树 `#![feature(...)]` 零命中；唯一的 `cfg(rust_nightly)` 只在 `llrt_build/src/lib.rs` 的发射端，**零消费分支**；`20/20` crate 都是 `edition = "2021"` |

## 2. 复现

```sh
# 上游 trunk 克隆与解包件（代理先前已下载）
/Users/glow/Base/Code/Freya/_scratch/llrt-audit/llrt-src
# 搬运脚本（闭包驱动：自动求本地 path 依赖闭包，剥 dev/build/bench 段）
python3 /Users/glow/Base/Code/Freya/_scratch/llrt-spike-build.py
cd /Users/glow/Base/Code/Freya/_scratch/llrt-spike
cargo run -q --bin probe -- --suite           # 全局臂求值
cargo run -q --bin probe -- --falsify         # 正控：不可能值必须不被接受
./target/debug/probe eventtarget-dispatch     # 每条行为独立进程（panic 会 abort，必须隔离）
cargo run -q --bin module-arm                 # 模块臂 + 未知模块正控
./target/debug/all-modules <key>              # 9 个 ModuleDef 逐门（key 传错会打印 AVAILABLE 表）
LLRT_SKIP_GLOBALS=1 ./target/debug/all-modules buffer   # 正控：抽掉全局后 buffer 模块必须红
# 门禁与体积
cargo clean -q -p <crate> …; cargo clippy -j 1 --lib -p <搬运主 crate 们> -- -D warnings
cargo build --release -j 1 --bin baseline --bin splan --bin probe   # 1.49 / 3.98 / 5.76 MiB
```
> `all-modules` 的表达式一律走 `m.<name>`；`splan`/`baseline` 是仓库外的独立包，别把它们的成员写回 `llrt-spike-build.py`（脚本重跑会覆盖根 `Cargo.toml` 的 members）。

镜像上游 `libs/` + `modules/` 树形是关键：这样各 crate 自己的 `path = "../../libs/llrt_utils"` 原样可用。
probe 只开 `rquickjs` 的 `array-buffer`（+ 模块臂那次加 `loader`），与 `crates/quickjs-realm/Cargo.toml:16` 一致。

## 2b. 模块臂逐门（9 个 `ModuleDef`，每门一个进程）

| 模块 | rc | 导出数 | 实测细节 |
|---|---|---|---|
| `path` | 0 | 13 | `join('/a','b/../c')` + `normalize('c//d')` ⇒ `/a/c\|c/d` |
| `util` | 0 | 9 | 导出集合是 `TextDecoder,TextDecoderStream,TextEncoder,TextEncoderStream,default,format,inherits,inspect,styleText` ⇒ **不覆盖 `util.types`/`promisify`/`callbackify`/`debuglog`/`parseArgs`/`isDeepEqual`**（本仓 `util.ts` 里 `types` 属已实现项，不能随搬运删掉）；但 **`TextEncoder`/`TextDecoder` 同时是模块命名导出** ⇒ 那两个洞有两条臂可走 |
| `console` | 0 | 2 | 只有 `Console,default`——Node 的 `node:console` 本来也只导 `Console`，我一开始断言 `m.log` 是我写错 |
| `buffer` | 0 | 5 | 前提是先装 `buffer::init` 全局：`LLRT_SKIP_GLOBALS=1` 时 `state=Rejected` + `Buffer is not defined` ⇒ 正控有效，「先全局后模块」是硬顺序 |
| `events` | 0 | 2 | `new m.EventEmitter()` 的 `on/emit` 真跑（`emit:1`） |
| `url` | 0 | 9 | `new m.URL('https://a.b/c?d=1').searchParams.get('d')` ⇒ `1` |
| `stream/web` | 0 | 14 | 导出面在；**读写路径仍不落**（见 §1 的 `readablestream-read-one`） |
| `async_hooks` | 0 | 5 | `createHook`/`executionAsyncId` 都在 |
| `string_decoder` | **1** | 声明 2（`StringDecoder,default`）但 evaluate 抛 Exception | 补装 `stream_web` 全局后仍红。本仓该模块已由 `npm:string_decoder@1.3.0` 覆盖 ⇒ 不影响落点 |

**一条测量有效性教训（我自己造的坑）**：第一版把表达式写成裸名（`join(...)`、`typeof ReadableStream`），结果 `url` 那条**因为全局臂已装而假绿**、其余因 ReferenceError 假红。改成一律 `m.<name>` 之后才量到模块导出本身。
⇒ **测「模块导出」必须走命名空间对象；裸名测的是全局臂。** 这条错了整张表都会反过来。

## 2c. 在**真 realm**里跑通了（不是手写 context）

把 `crates/quickjs-realm` + `crates/quickjs-host-protocol` **原样复制到仓库外**（`_scratch/realm-harvest`），只加一个注入点，然后用一份同时触碰 harvest 全局与 `__xrh` 的 bundle 跑 `Executor::run`：

```
CONTROL_NO_HOOK ok refused without primitives: {"message":"Node \"harvest-probe-bare\" failed: TextEncoder is not defined","success":false}
REALM_HARVEST_OK {"harvest":{"bytes":6,"decoded":"ä","url":"1","nav":"string","eventTargetHits":1,"domException":"TimeoutError","consoleType":"function"},
                  "hostCall":{"nowType":"number","platformKeys":["arch","cwd","env","pathSep","platform","sep"]}}
CONTROL2 ok harvested bytes length is 6
HOST_CALLS ["ClockNow"]
REALM_RETURNED        rc=0  stderr=0 字节
```

- **注入点的真实补丁面积 = 19 行**：`engine.rs` 18 行（`Executor` 加一个字段 + `with_primitives()` builder + 一处调用点传参 + `launch()` 加一个形参 + 在 `shims::install` 之后、`bundle::resolve` 之前调 hook）+ `lib.rs` 1 行（`pub use engine::{… PrimitivesHook}`）。`launch` 只有 `engine.rs:325` **一个**调用点。
- **今天确实缺 TextEncoder**：不带 hook 的同一份 bundle 在真 realm 里返回 `TextEncoder is not defined`——§6 那条推断这次是端到端实测。注意 realm 对「节点自己抛错」是**回失败文档而不是 Err**（`Executor::run` 的文档明写），所以正控必须读文档内容而不是 `Result` 分支；我第一版把它标成 `UNEXPECTEDLY_OK` 就是读错了这一层。
- **协议没被污染**：同一次求值里 `__xrh.call("clock.now")` 仍返回 number、`__xrh.platform` 的 6 个键都在、`HOST_CALLS` 只有 `ClockNow`。
- **关停路径没炸**：带 6 个 harvest crate 的类注册跑完整 run，`REALM_RETURNED` 打出、stderr 0 字节 ⇒ realm 固定的「中断处理器→宿主守卫→context→runtime」顺序在这次装配下成立。⚠️ 这**不等于** §8 那条 `Persistent` promise 的关停断言已解（这次没有 parked promise 跨调用）。

落点方案因此改变：不是「realm 里长出一套模块系统」，而是**在 `shims::install` 之后加一个 19 行的 `with_primitives` 钩子**，把 harvest 的全局装进去——`--alias` 策略一行不动，§9 第 3 问随之降级为可选项。

## 2d. 关停路径：带 harvest 会不会让已知的 abort 风险变坏 —— 不会

同一份复制件 realm 上跑「run 停在宿主调用里、wall-clock 截止先到」这条案（正是不带 `Persistent` 也最容易翻的那条），bare 与 harvest 各一次：

```
PARKED_bare    calls=1 outcome=Some(RealmError { message: "the run of \"parked-bare\" exceeded its 60 ms wall-clock bound" })   rc=0 stderr=0
PARKED_harvest calls=1 outcome=Some(RealmError { message: "the run of \"parked-harvest\" exceeded its 60 ms wall-clock bound" }) rc=0 stderr=0
```

⇒ 两次**结果同形**：都是截止 `RealmError`、都打出 `_RETURNED`、stderr 0 字节、没有 `Assertion failed: (list_empty(&rt->gc_obj_list))`。
也就是说 **6 个 harvest crate 的类注册没有加重 realm 的关停问题**。注意这**不等于**那条断言已解——本用例里没有跨调用存活的 `Persistent`；它只证明「搬 harvest 不会把已知风险推大」。

⚠️ 顺带记一次自己的假读数：第一次跑这对照时 `cargo build` **报错了**（`cannot find value hook`），而两个 case 都打出 rc=0——那是**上一版旧二进制**，`--parked` 参数根本没生效（两次输出与常规案逐字相同就是破绽）。清掉产物、按 mtime 确认新构建之后重跑，才有上面这组数。规则：**跑集成案之前先证「这次跑的是刚编出来的东西」**。

## 3. 代价（实测，不是估计）




- **门禁实测（清缓存后重跑，才算数）**：`cargo clippy -j 1 --lib -p <10 个搬运主 crate> -- -D warnings` ⇒ **rc=0、`checked_units=22`、28.9 s**，上游源码**零改动**过我们仓的 clippy 尺。
  ⚠️ 第一次我拿到的 `CLIPPY_LIB_RC=0` 是**假绿**：`/tmp/clip.txt` 里 `Checking llrt_` **0 行**（缓存命中，什么都没重新 lint）。规则：**门禁必须先数「被检查的单元」**，`rc=0` 加零个 unit 等于没跑。
- **体积（`--release`，三个 bin 同一次构建、删旧产物后实测 mtime 新鲜）**：

  | 装配 | 大小 | 相对引擎独享 |
  |---|---|---|
  | 只有 rquickjs（`std`+`array-buffer`） | 1.49 MiB | — |
  | **两文件方案**：`navigator + path + exceptions + events + text_encoder.rs + text_decoder.rs`（`slite`，含 `llrt_utils` 的 5 个模块切片） | **2.02 MiB** | **+0.54 MiB（+36%）** |
  | **两文件方案 + global `URL`**（同上再加 `llrt_url`） | **2.68 MiB** | **+1.20 MiB（+81%）**，求值 `6/hi/1` |
  | S 变体：同上但挂**整块 `llrt_util`**（含 `*Stream` ⇒ 拖 `llrt_stream_web`） | 3.98 MiB | +2.49 MiB（+168%） |
  | 全 20-crate 闭包（含 timers/stream_web/buffer/url/console） | 5.76 MiB | +4.28 MiB（+288%） |

  ⇒ **只要那两个文件、不碰 `*Stream`，省下约 1.95 MiB**——这就是「别整块搬 `llrt_util`」的定价。两文件方案还额外过了 `cargo clippy -p slite-harvest --lib -- -D warnings`（2.89 s，有 `Checking` 行，非缓存）。

- **依赖闭包按落地集分档**（`cargo tree -e normal -p` 逐包量；**不是** `cargo metadata`——后者报整个 workspace，四个不同集合给出一模一样的数字，是假尺）：
  | 落地集 | 本地单元 | 外部 | **净新增** |
  |---|---|---|---|
  | `slite`（两文件 + `llrt_utils` 切片） | 3 | 37 | **5**：`base64-simd hex-simd outref vsimd convert_case` |
  | 再加 `llrt_path` | 5 | 39 | **5**（同一批） |
  | 再加 `navigator/exceptions/events/url` | 9 | 63 | **5** |
  | 再加 `llrt_console` | 14 | 73 | **8**（多出 `halfbrown simd-json value-trait`） |
  ⇒ `console → logging → numbers → simd-json` 是净新增从 5 涨到 8 的唯一原因；**不搬 console 就能把新增压到 5 个**。`rquickjs-macro` 已不在净新增里（别的 lane 把 `macro` 的依赖写进 lock 了）。
- 参考旧口径（**20-crate 全闭包**，含 console/buffer/timers/stream_web）：外部 95 个包，85 个已在根 `Cargo.lock`，净新增 9。
- **源码量**：20 个 crate 合计 **29,695 行**，但分布极不均——`llrt_stream_web` **14,684 行**（占一半）、`llrt_utils` 3,139、`llrt_buffer` 1,894、`llrt_url` 1,758、`llrt_json` 1,227、`llrt_util` 1,083、`llrt_path` 905、`llrt_navigator` **19**。
- **`llrt_utils` 不必整块**：求值面真正需要的只有 `bytes.rs 752 + object.rs 170 + result.rs 104 = 1,026 行`（`bytes.rs` 另需 `half` 给 f16；tokio 只用到 `sync`，已在 lock）。
- **clippy 面**：4 个 crate 带 crate 级 `#![allow(...)]`（`llrt_abort` `llrt_url` `llrt_events` `llrt_logging`），进仓后 `-- -D warnings` 要么留着要么逐条清。
- **许可**：46 个已发布 crate 全 `Apache-2.0`，`.crate` 内含 `LICENSE`+`NOTICE`；搬运只需保留 NOTICE。模块 crate 内**不含 JS 文件**（bundled JS 全在 `llrt_core`，我们不搬）。

## 4. 版本绑定：发布态与 trunk 态是两份事实

- crates.io：46 个 `llrt*` 每个**只有一个版本**，38 个 pin `rquickjs ^0.11` ⇒ **当依赖仍然装不上**（`llrt_path` 实测 `max_version = 0.8.1-beta`，2026-07-28 上传）。
- trunk：逐 crate pin `rquickjs = "0.14"`（`modules/llrt_fs/Cargo.toml:26`），`Cargo.lock:3129-3132` 的 checksum `a0a22bf7…eb34e` 与本仓 `Cargo.lock:6213-6216` **逐字节相同**。GitHub 上 **v0.9.0-beta 已 release（2026-09-06）但 crates.io 尚未发布**；他们 release→crates 的滞后实测约 5 个月（0.8.1-beta：02-20 release、07-28 上传）。
- `llrt_core` 耦合在源码层是**零**：`rg -l 'llrt_core' -g '*.rs' llrt-src/modules llrt-src/llrt_modules` = 0 个文件，方向是反的（core → modules → 逐模块）。
- **0.11↔0.14 漂移按 crate 分档**（发布态 src vs trunk src）：`llrt_path` **rc=0（逐字节相同）**、`llrt_navigator` **rc=0**、`llrt_string_decoder` 16、`llrt_console` 115、`llrt_events` 171、`llrt_exceptions` 200、`llrt_util` 257、`llrt_os` **2**、`llrt_url` 749、`llrt_buffer` 777、`llrt_crypto` **3,495**。

⇒ **不退引擎版本**（0.14 修了 `Ctx::execute_pending_job` 把「job 抛异常」当成功、`Object::instance_of` 残留 pending exception，`crates/quickjs-realm/src/bundle.rs:73-80` 的排空循环正依赖前者）。搬运形态只有 **vendored trunk 源码**；`llrt_crypto` 那条 3,495 行漂移就是「人家维护」在 vendored 形态下的真实价格。

## 5. 两条收回（我先前说过、现在被自己的读数否掉）

1. ~~「LLRT pin `^0.11` ⇒ 接不上 0.14，要用就得降引擎」~~ —— 只对**发布态**成立；trunk 已在 0.14 且与我们同一 checksum。
2. ~~「`ModuleDef` 在本仓配置里没编进去，`loader` 门控整个 module 子系统」~~ —— `rquickjs-core-0.14.0/src/lib.rs:40-43` 无条件重导出 `Module` 与 `module::ModuleDef`；`#[cfg(feature = "loader")]`（`:48-50`）**只门控 `pub mod loader`**（`ModuleLoader`/`ModuleResolver`/原生登记表）。`bundle.rs:73` 的 `Module::declare(...).and_then(Module::eval)` 就是活证。
3. 另记一次自查：本轮我三次把「工具/管道的产物」当成读数——`rg -r`（替换串）把 `quickjs-wpt-sys` 打成 `quickjs-in`；`rg '\|'`（未转义）造成一列假零；`cmd | head; rc=$?` 取到的是管道尾 rc。三处都已用 `-F`/`REAL_RC=` 直取复测。

## 6. 顺带查出的两处仓内悬空引用（与搬运无关，但同一族）

1. `packages/quickjs-shims/src/util.ts:167-168`、`surface.ts:189` 与已编译 `crates/xiranite-quickjs-executor/bundles/*.js` 都写「`TextEncoder`/`TextDecoder` 是 engine global，由 **`quickjs-wpt-sys`** 提供（按 ADR-0074 决定 1）」。实测：该 crate 在 crates.io 回 `{"detail":"crate quickjs-wpt-sys does not exist"}`；不在本仓 `Cargo.lock`；ADR-0074 全文对 `TextEncoder|engine global` **零命中**；`rquickjs-sys-0.14.0/quickjs/` 整棵树对 `TextEncoder|AbortController|Blob|structuredClone|EventTarget|URLSearchParams` **全部零命中**。
2. `packages/quickjs-shims/src/url.ts:5` 自己承认「QuickJS-NG 不带 WHATWG URL，`URL`/`URLSearchParams` 是宿主引擎提供的 global」——而 realm 只 `globals().set("__xr*")`（`crates/quickjs-realm/src/shims.rs:336-444`），**没有任何地方装 `URL`**；同文件 `:21-28` 的 `pathToFileURL` 里就直接 `new URL(...)`。⇒ 进 realm 的调用会 ReferenceError。目前暴露面窄：真会撞的是 `packages/nodes/clipm/src/core.ts:420`（`new AbortController()`，clipm 为搁置态）；`encodeb`/`lata`/`repacku`/`smartzip` 那几处都在 `platform.ts`（Node 侧，不进 realm）。

## 6b. 这批洞到底是「着火热」还是「埋着的」—— 实测是后者

按「谁真的会执行到」归因（不猜，直接扫宿主加载的 24 份产物 + 节点源码）：

| 缺的全局 | 产物里的引用来自哪 | realm 侧是否真会跑 |
|---|---|---|
| `URL` | **11 份产物共 18 处，其中 9 份的 16 处在打包进来的 zod 校验臂里**（`check.kind === "url"`、`_zod.check` 的 ipv6 三条）；`rawfilter` 的 4 处是我们自己 `url.ts` 的 `pathToFileURL`；`findz` 的 1 处在 `worker-client.ts`（`new URL("./findz-worker.js", import.meta.url)`，Node 侧） | **否**：`packages/nodes` + `packages/config` + `node-definitions` + `host-capabilities` + `src` 里 `.url()` / `.ipv4()` / `.ipv6()` 的非测试命中是 **0** ⇒ zod 那条臂在产物里但没人触发；`pathToFileURL` 的调用方是 worker/CLI（Node 侧） |
| `TextEncoder`/`TextDecoder` | `marku`(1+2)/`repacku`(2)/`logx`(1) 等 | **否**：命中全在 `platform.ts`（`encodeb`/`lata`/`smartzip`），那是 Node/Bun 侧的面，不进 realm |
| `AbortController` | `encodeb`/`logx` 各 4 处 + `clipm/src/core.ts:420` 1 处 | **只有 clipm**，而 clipm 是「搁置不删」状态 |

⇒ **搬运的收益不是救火，是保险**：今天没有保留节点的 realm 路径会撞这些洞（唯一例外是搁置的 clipm）。所以「+1.20 MiB / 5 个净新增依赖」这笔钱**现在花没有回报**，正确排法是等 realm 层进 git 之后再作为「补 `surface.ts`/`util.ts` 假话 + 一次性带上 provider」的动作做。
⇒ 但 §6 那两处假话本身该修：它们把「没有提供者」写成「由 `quickjs-wpt-sys` 提供」，下一个读代码的人会照着不存在的东西接线。这条修不依赖 realm，也不依赖搬运。


**处置状态（本轮之后）**：
- 已改对：`packages/quickjs-shims/src/util.ts:167`（原「engine globals (quickjs-wpt-sys per ADR-0074 decision 1)」）、`packages/quickjs-shims/src/url.ts:5`（原「`URL`/`URLSearchParams` 是宿主引擎提供的 global」）。两处现在写的是实测事实：`rquickjs-sys 0.14` 那份 QuickJS-NG 树里两者都没有，`quickjs-wpt-sys` 不是 crates.io 上存在的 crate，且 §6b 证明这是命名缺口不是现网故障。验证：`tsc -p tsconfig.json --noEmit` rc=0、`vitest run src` **41 passed**、`check:source-size` passed。
- **未改的两处，原因都是归属不是技术**：`surface.ts:189` 的同类说法（该文件此刻在别的 lane 的未提交改动里）；已签入产物 `crates/xiranite-quickjs-executor/bundles/*.js` 里仍带旧文案——重建产物会把 `packages/quickjs-shims` 里 40 个在途文件（含 `package.json` MM、`src/assert.ts` AD）一起编进我的提交，所以留给产物拥有者在下一次构建时自然带走。

## 7. 落点建议（搬运顺序）

**S 方案，约 2.6k 行**，覆盖上面两个洞且**完全不碰 `stream_web`**——**已按文件粒度实测装配过一次**（spike 里的 `slite` 包：`bytes/object/result/primordials/error_messages` + `text_encoder/text_decoder`）：`cargo check` 零错误、`clippy -- -D warnings` 零告警、求值出 `6/hi`、release **+0.54 MiB**。装配只需把 `use llrt_utils::` 改写成 `use crate::`（两处），没动一行业务代码。
**组成**：`llrt_navigator`(19) + `llrt_path`(905，漂移 0) + `llrt_encoding`(300) + `llrt_utils` 的 `bytes/object/result`(1,026) + `llrt_util/src/text_encoder.rs`(109) + `text_decoder.rs`(223)，外加 `llrt_url` 的 global `URL`（若连 `llrt_url` 1,758 一起搬）。
- `TextEncoder`/`TextDecoder` **不在** `llrt_util` 的 stream 侧：只要那两个文件就不拖 `llrt_stream_web`。
- **不要搬** `buffer`/`events`/`string_decoder`/`assert`：这几样本仓已交 npm（`packages/quickjs-shims/package.json:39-44`：`npm:assert@2.1.0`、`npm:buffer@6.0.3`、`npm:events@3.3.0`、`npm:string_decoder@1.3.0`、`readable-stream@4.7.0`、`safe-buffer@5.2.1`），Rust 再搬一份就是第二份实现，而且 `llrt_buffer` 编译期拖 `stream_web` 的 14,684 行。
- 模块臂（`path`）用本仓自己的 15 行 `Loader` + `Module::declare_def`，**前提是把 `--alias` 策略改掉**才会有真 `import` 到达引擎；否则它只在「JS 侧直接 `import 'path'`」时有用。搬进来的同一 API，对应那份 TS shim **必须当场删掉**（`digest.rs` 的「一个 hash 只有一份实现」与 AGENTS.md「节点只有一份实现」同一条），`surface.ts` 的 `implemented/hostOperations` 与 `audit:node-bundles` 同批改。
- 搬 `util` 的 TextEncoder/TextDecoder 时**不能顺手把 `util.ts` 整份删掉**：`llrt_util` 的导出集合里没有 `types`（也没有 `promisify/callbackify/debuglog/parseArgs/isDeepEqual`），这几样是本仓已实现项，删了就是丢功能。⇒ 搬运账要按「成员」记，不按「模块」记。
- `TextEncoder`/`TextDecoder` 有**两条臂**可走：全局（`llrt_util::init` 实测装上）与模块命名导出（`all-modules util` 的 9 个导出里就有它们）。选哪条取决于 §9 第 3 问（要不要改打包策略让真 `import` 到达引擎），不取决于上游。
- **搬 `llrt_path` 有一条必须先改的硬条件**：它在**生产代码**里直接读进程工作目录——`resolve_path_with_separator`（`modules/llrt_path/src/lib.rs:366` `let cwd = std::env::current_dir()?`）与 `relative`（同文件 `:397`、`:405`）。照搬进 realm 就等于「`path.resolve()`/`path.relative()` 的 cwd 由 realm 自己问操作系统」，而本仓口径是**环境事实只由宿主供给**（`__xrh.platform.cwd`，`surface.ts` 里 platform 六键之一），一处两个真相。⇒ 落地时这 3 处必须改成由宿主注入 cwd；另外 4 处 `std::env::current_dir()` 在 `#[cfg(test)]`（该文件 659 行起）里，不用管。
- 授权语义一律不外包：30 条 host operation 里 **22 条（fs 17 + proc 5 + service.invoke）**承载按 operation 解析的根与 `DangerGate`；`llrt_fs`/`llrt_child_process`/`llrt_os` 即便技术上能编，也不进 realm。


## 8. 未测 / 风险

- **release 体积已测**（§3 表）；**编译时长**只在 sccache 半热状态下测过（clippy 22 个 unit 28.9 s），冷缓存全量构建时长没量。
- **两文件方案的体积已测**：不含 URL 是 +0.54 MiB，**含 `llrt_url` 的 global `URL`（§6 第二个洞的修法）是 2.68 MiB ⇒ +1.20 MiB（+81%）**，求值实测 `6/hi/1`。⇒ 两个洞一起补的代价约 **+1.2 MiB**，其中 URL 自己占约 0.66 MiB。
- **Windows：本机交叉验在原理上做不到，替代取证已做**。
  - 直接 `cargo check --target x86_64-pc-windows-msvc` 走不通，**而且原因不在 LLRT**：rustup 侧该 target 的 std 装着（要用工具链 bin 前置才轮得到它，Homebrew 的 cargo/rustc 会报 E0463「can't find crate for core」），但卡在 `rquickjs-sys` 自己的 C 构建上——`cc-rs` 对 msvc 目标发出 `/DWIN32_LEAN_AND_MEAN /std:c11 /experimental:c11atomics` 这类 MSVC 旗标却调用了 `/opt/homebrew/bin/sccache cc`（clang），报 `no such file or directory: '/std:c11'`。⇒ 引擎先编不出来，任何上层 crate 的 Windows 判定在这台 mac 上都拿不到。
  - 替代取证（源码扫描 + 阳性对照）：落地集 19 个文件里 **`cfg(unix)`/`libc::`/`windows_sys`/`std::os::` 全零命中**，平台门控只剩 `llrt_path` 的 **17 处 `cfg(windows)`**（`memchr` 7 处也都在那一支里）。有 unix/windows 分支的 `libs/llrt_utils/src/signals.rs`（实测 cfg(unix)=7、cfg(windows)=2）**不在落地集内**，因为我们只取 `bytes/object/result/primordials/error_messages` 五个模块。
  - 剩下的 Windows 证据只能在 Windows 机上出：把 `_scratch/llrt-spike` 拷过去跑 `cargo check -p slite-harvest -p llrt_path -p llrt_navigator -p llrt_exceptions -p llrt_events -p llrt_url` 即可（不含 `stream_web`/`timers`/`console`）。
- **关停路径已对照测过**（§2d）：带 6 个 harvest crate 的截止-abort 案与 bare 案**结果同形**——同一条 `RealmError`、rc=0、stderr 0 字节、无 `gc_obj_list` 断言 ⇒ harvest **不加重**已知关停风险。⚠️ 仍不等于那条断言已解：这个用例里没有跨调用存活的 `Persistent`，那条路要单独再测。
- `llrt_abort`/`async_hooks` 的 init 成功，但只测了存在，未测 `AbortSignal.timeout` 这类会走定时器的路径。

## 9. 待拍板

1. **搬不搬（§6b 已经把答案往前推了一步）**：S 方案的代价是有数的（7 文件 / 5 个净新增依赖 / +1.20 MiB / realm 19 行钩子 / 关停不劣化），但 §6b 实测这批洞在 realm 里**没有正在跑的消费者** ⇒ 现在搬是花 1.2 MiB 买保险。要么「等 realm 层进 git 后连同 provider 一起落」，要么「只修 §6 的假话、provider 延后」。
2. **§6 那两处假话单独修还是随搬运一起修**：搬了就是顺手改对（提供者真的存在了）；不搬就得把 `util.ts:167`/`surface.ts:189`/`url.ts:5` 的说法改成事实，并给 global `URL` 找另一个落点（npm polyfill 走现成 alias 也行）。
3. **模块臂（`--alias` 改成让真 `import` 到达引擎）现在降级为可选**：§2c 证明全局钩子就能把 harvest 接进来，一行打包策略都不用动。它只在「希望 `node:path` 这类以模块形态而不是全局形态存在」时才有价值。
4. **落地的真实阻塞不是技术，是顺序**：钩子要接在 `crates/quickjs-realm` 上，而实测 `git ls-files --error-unmatch` 对 `crates/quickjs-realm/src/engine.rs`、`crates/quickjs-host-protocol/src/lib.rs`、`crates/xiranite-quickjs-executor/src/realm_run.rs` 全部返回 **tracked=NO** ——整个 realm 层此刻还是工作树里的未提交工作；根 `Cargo.toml`(+2)/`Cargo.lock`(+35/−3) 也在别人 lane 的未提交改动里，新 workspace 成员还要过别的 lane 刚加的 `audit:ci-build-targets`。⇒ **在 realm 层自己落进 git 之前，任何 harvest 提交都得把别人没交付的层一起拖进来**（这正是「提交了引用没提交被引用者」那一类）。落地动作因此排在 realm 之后，不是技术上做不到。

## 10. 「产品侧用上」被什么挡住（本轮把这条从推理变成实测）

钩子只有 19 行、代价只有 +1.2 MiB / 5 个净新增依赖，但**现在落不了**，三条都量过：

1. **要接的层还不存在於任何 git 历史里**：`git status --porcelain crates/quickjs-realm` ⇒ `?? crates/quickjs-realm/`（未跟踪）；再把**全部 39 个 ref** 逐个 `git ls-tree -r --name-only <ref> -- crates/quickjs-realm` 扫一遍，**命中 0**。`crates/quickjs-host-protocol`、`crates/xiranite-quickjs-executor/src/realm_run.rs` 同样不在 HEAD。⇒ 我落这个钩子，就必须把别人这一整层未提交的产物一起提交（AGENTS.md 明令不得混入其他任务的改动；也正是「提交了引用没提交被引用者 ⇒ 分支不自洽而本地全绿」那一类事故）。
2. **JS 侧那条路也堵着**：`packages/quickjs-shims` 有 **40 个文件**在途（`package.json` MM、`src/assert.ts` AD、`src/buffer.ts` MM、`README.md` MM…），`surface.ts`/`bun.lock` 同为脏；要加 npm provider 就得动这些，而我的记忆里还有一条我自己踩过的教训——**别在仓里 `bun add`**（会剪掉别人在途的 vendor 锁条目）。
3. **Windows 那格证据本机拿不到，且优先级已被下调**：`ssh 30902@100.122.176.77:22` 连接超时（路由走 `utun5` 存在，说明是机器或 sshd 没起，不是我没有地址）；`wine` 不存在；`x86_64-pc-windows-gnu` 的 std 没装（下载超时就中止了，没留下挂着的进程）。msvc 目标虽然装着，但卡在 `rquickjs-sys` 的 C 构建上（cc-rs 给 msvc 目标发 `/std:c11` 却调 clang），本机 `mingw-w64 14.0.0_3` 已在，所以理论上换 gnu 目标可试——**但用户 2026-10-05 已把平台口径改成「Mac 优先，Windows 稍微低一点」**，所以这一步不追，只把命令留在这里：`rustup target add x86_64-pc-windows-gnu && cargo check -j 1 --target x86_64-pc-windows-gnu -p slite-harvest -p llrt_path -p llrt_navigator -p llrt_exceptions -p llrt_events -p llrt_url`。

⇒ **解锁条件三选一**：① 那条 realm lane 进 git（或用户一句话授权我把这层一起提）；② 用户点名只修 §6 那两处假话（本轮已修，剩 `surface.ts` 等归属腾清）；③ 用户要 Windows 那格证据时把机器开着/起 sshd。

**交接已发出（2026-10-05 23:16，本地时间）**：条件 ① 归会话「Finderz 节点改造建议」（`9888bf3e-c5c4-4de8-8c24-f7dabb62f206`），它当时正在跑「把 findz 的 Bun worker 换成 realm 侧网关」这一步，消息已按排队策略送达。发给它的三件事：
1. **会咬人的 git 状态**（我现读出来的）：`crates/xiranite-quickjs-executor/src/czkawka_operations.rs` 在 index 里是 `D `、盘上却还在（755 行），而 `src/host_services.rs:56-63` 的 `SERVICES` 那行仍指向 `czkawka_operations::METHODS` ⇒ 只带走删除不带走注册表行，干净检出就编不过；`src/lib.rs:54-68` 的 14 条平铺 `mod` 混着入口与服务实现（建议 `src/services/`，`sidecar.rs` 留原位，等 czkawka 去留定了再一起做）。
2. **我这边的成品与顺序约束**：19 行钩子必须落在 `shims::install` 之后、`bundle.rs:146 new_global_names` 的快照之前——否则 harvest 的 `TextEncoder`/`URL` 会被算成节点 bundle 自己新增的全局，诊断指错人；realm 35 条测试在打补丁副本里与基线逐行一致；`llrt_path` 的 3 处 `std::env::current_dir()` 必须改宿主注入。
3. **`surface.ts:189` 那句假话仍留着**（它在该 lane 在途的 40 个文件里，我没动），请它提交前顺手改成事实。

