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

- **依赖闭包**：20 个 llrt crate + 95 个外部包，其中 **85 个已在根 `Cargo.lock`**，净新增 **9 个**：`base64-simd hex-simd outref vsimd halfbrown value-trait simd-json convert_case rquickjs-macro`。`rquickjs-macro` 是新的，因为我们没开 `macro`。
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

## 7. 落点建议（搬运顺序）

**S 方案，约 2.6k 行**，覆盖上面两个洞且**完全不碰 `stream_web`**——**已按文件粒度实测装配过一次**（spike 里的 `slite` 包：`bytes/object/result/primordials/error_messages` + `text_encoder/text_decoder`）：`cargo check` 零错误、`clippy -- -D warnings` 零告警、求值出 `6/hi`、release **+0.54 MiB**。装配只需把 `use llrt_utils::` 改写成 `use crate::`（两处），没动一行业务代码。
**组成**：`llrt_navigator`(19) + `llrt_path`(905，漂移 0) + `llrt_encoding`(300) + `llrt_utils` 的 `bytes/object/result`(1,026) + `llrt_util/src/text_encoder.rs`(109) + `text_decoder.rs`(223)，外加 `llrt_url` 的 global `URL`（若连 `llrt_url` 1,758 一起搬）。
- `TextEncoder`/`TextDecoder` **不在** `llrt_util` 的 stream 侧：只要那两个文件就不拖 `llrt_stream_web`。
- **不要搬** `buffer`/`events`/`string_decoder`/`assert`：这几样本仓已交 npm（`packages/quickjs-shims/package.json:39-44`：`npm:assert@2.1.0`、`npm:buffer@6.0.3`、`npm:events@3.3.0`、`npm:string_decoder@1.3.0`、`readable-stream@4.7.0`、`safe-buffer@5.2.1`），Rust 再搬一份就是第二份实现，而且 `llrt_buffer` 编译期拖 `stream_web` 的 14,684 行。
- 模块臂（`path`）用本仓自己的 15 行 `Loader` + `Module::declare_def`，**前提是把 `--alias` 策略改掉**才会有真 `import` 到达引擎；否则它只在「JS 侧直接 `import 'path'`」时有用。搬进来的同一 API，对应那份 TS shim **必须当场删掉**（`digest.rs` 的「一个 hash 只有一份实现」与 AGENTS.md「节点只有一份实现」同一条），`surface.ts` 的 `implemented/hostOperations` 与 `audit:node-bundles` 同批改。
- 搬 `util` 的 TextEncoder/TextDecoder 时**不能顺手把 `util.ts` 整份删掉**：`llrt_util` 的导出集合里没有 `types`（也没有 `promisify/callbackify/debuglog/parseArgs/isDeepEqual`），这几样是本仓已实现项，删了就是丢功能。⇒ 搬运账要按「成员」记，不按「模块」记。
- `TextEncoder`/`TextDecoder` 有**两条臂**可走：全局（`llrt_util::init` 实测装上）与模块命名导出（`all-modules util` 的 9 个导出里就有它们）。选哪条取决于 §9 第 3 问（要不要改打包策略让真 `import` 到达引擎），不取决于上游。
- 授权语义一律不外包：30 条 host operation 里 **22 条（fs 17 + proc 5 + service.invoke）**承载按 operation 解析的根与 `DangerGate`；`llrt_fs`/`llrt_child_process`/`llrt_os` 即便技术上能编，也不进 realm。


## 8. 未测 / 风险

- **release 体积已测**（§3 表）；**编译时长**只在 sccache 半热状态下测过（clippy 22 个 unit 28.9 s），冷缓存全量构建时长没量。
- **两文件方案的体积已测**：不含 URL 是 +0.54 MiB，**含 `llrt_url` 的 global `URL`（§6 第二个洞的修法）是 2.68 MiB ⇒ +1.20 MiB（+81%）**，求值实测 `6/hi/1`。⇒ 两个洞一起补的代价约 **+1.2 MiB**，其中 URL 自己占约 0.66 MiB。
- **Windows 交叉编译未验**：本机没有 msvc target。已知风险点是 `libs/llrt_utils/src/signals.rs`（`cfg(unix)`→`libc`、`cfg(windows)`→`windows-sys` Win32_Threading）、`llrt_path`（`cfg(windows)` 才用 `memchr`）、`llrt_buffer/src/blob.rs`。要判「Windows 编得过」得走仓库外单文件交叉编译或上 Windows 机。
- **关停路径**：本轮 11 个 init + `Trace` 注册后 `DROP_CLEAN`、stderr 0 字节、rc=0；但仓里那个 `gc_obj_list` 断言问题是在**带 promise/宿主回调**的求值路径上出现的，本文**不能**据本 spike 宣称已解。
- `llrt_abort`/`async_hooks` 的 init 成功，但只测了存在，未测 `AbortSignal.timeout` 这类会走定时器的路径。

## 9. 待拍板

1. 走 **S 方案 vendored**（约 2.6k 行，覆盖 TextEncoder/Decoder + path + URL），还是**等 LLRT 发 0.9.0-beta 成真依赖**（滞后实测约 5 个月，但那时升级由上游负责）。
2. §6 那两处悬空引用要不要**现在就单独修**（把 `quickjs-wpt-sys` 的说法改成事实、并把 global `URL` 的提供者写明），不等搬运。
3. 模块臂要不要以「改掉 esbuild `--alias`、让真 `import` 到达引擎」为方向——那是打包策略的改动，收益是 `path`/`fs` 这类可以走原生模块，代价是重做 alias/门禁。
