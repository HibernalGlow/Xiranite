# 终端面 → `/operations` 迁移配方（三位一体的第三条腿）

现读依据：参考实现只有一个 —— `packages/nodes/dissolvef/src/cli.ts`。本文件只写「照它抄什么」，不写计划、不写进度；
进度一律由 `bun scripts/audit-face-execution-path.ts` 现算，产物是 `artifacts/face-execution-ledger.json`
与 `docs/migration/face-execution-ledger.md`。

## 0. 判据（先看这把尺）

```bash
bun scripts/audit-face-execution-path.ts --self-check   # 尺本身带阳性对照，看不见违规就非零退出
```

一个节点从 `in-process` 变成 `migrated`，要求同一行里三个数同时成立：`coreValueImports = 0`、
`directRunCalls = 0`、`protocolEvidence` 非空。分类走 AST（`@ast-grep/napi`），
所以 `packages/nodes/nameu/src/cli.ts` 那种压成单行的导入也跑得掉——别改回正则。

## 1. 只留类型导入

`cli.ts` / `Tui.tsx` 对 `./core.js` 只允许 `import type { … }`。
值导入 = 把第二份执行宿主放进 face 进程，ADR-0074 §5 明确否决，也没有「先留着以后删」的余地。

## 2. 拿到宿主

共享入口全在 `packages/cli-runtime/src/backend.ts`，face 侧不得自己拼 URL 或读 token 文件：

| 用途 | 名字 | 出处 |
| --- | --- | --- |
| 摘 `--backend/--token/--channel-file` | `extractHostAttachArgs` | `backend.ts:110` |
| 解析出 `{ baseUrl, token }` | `resolveHostAttachment` | `backend.ts:134` |
| 只探测可达性 | `assertHostReachable` | `backend.ts:163` |
| 起一个宿主或附到已有的 | `attachOrStartHost` / `sharedHostHandle` / `stopSharedHost` | `backend.ts:206,439,446` |
| 造客户端 | `createOperationsClient`（dissolvef 用它包了 `hostOperationsClient`） | `dissolvef/src/cli.ts:221-225` |

环境变量名也只认这一份：`XIRANITE_BACKEND_URL` / `XIRANITE_BACKEND_TOKEN` / `XIRANITE_CHANNEL_FILE` /
`XIRANITE_HOST_BIN`（`backend.ts:47-51`），默认 TTL 3600 s、启动超时 15 s（`:56-58`）。

## 3. 跑与控

一次性的动作：`client.runOperation<T>(NODE_ID, input, onEvent)`（`dissolvef/src/cli.ts:243-244`）。
需要取消/暂停/恢复的画面必须先 `startOperation` 拿到记录，再 `awaitOperation`，控件地址是这次真的
启动出来的 operationId（`dissolvef/src/cli.ts:263-277`）。事件回调吃 `OperationEvent`，别自己解析 SSE。

## 4. 失败形状（这段是本配方唯一的硬约束）

抄 `dissolvef/src/cli.ts:232-238` 的注释和实现：

- 附不上宿主 / 传输失败 → 打这一面的错误行 + `process.exitCode = 1`，**返回 undefined，绝不回落到本地跑 core**。
  回落就是被 ADR-0074 §5 删掉的那条兼容路。
- 异常在这里 catch，不要往外抛：citty 的 `runMain` 遇到抛错会 `process.exit(1)` 并丢掉 buffered stdout，
  于是 `--json` 不再是一份干净文档，而 1（失败）与 2（用法）两个退出码也会塌成一个。
- 「跑了但没成」是 `success: false` 的结果，不是 throw。

## 5. 测试

按 `packages/nodes/dissolvef/src/cli.test.ts` 的形状：在 127.0.0.1 上起一个**真 HTTP** 的脚本化假宿主
（`POST /nodes/<id>/operations`、`GET /node-operations/<op>/stream`、`.../cancel|pause|resume`），
不要 `vi.mock` 客户端模块——mock 掉客户端就测不到 URL、token 头与流式事件这三件真正会错的事。

## 6. 不许顺手改的东西

`help.ts` 是节点自撰字典（同时喂终端 `--help` 与应用内帮助卡），迁移不动它；`interaction.ts` 的
schema 字段与危险确认语义不动；`platform.ts` 的 runtime 工厂如果变成零消费者，报出来，不要在本配方里
顺手删（它的宿主对端由另一条 lane 的注册表决定）。

## 7. 设计口径（别再推导第三遍）

「三位一体」共享的是**语义**，不是 App。一份 TS core + 一份 Rust 宿主 arms（23 个 `xrh` 操作，
`crates/quickjs-host-protocol/src/operation.rs`；六条服务臂 `os`/`power`/`trash`/`config`/`czkawka`/`findz`，
`crates/xiranite-quickjs-executor/src/host_services.rs`），三种投递形状共用它：

- 桌面 —— host crate 被 Tauri 窗口进程链接；
- **独立发行 —— 同一个 Rust 单元编成无窗口二进制（`crates/xiranite-loopback-host`，debug 产物 `xiranite-dev-host`）与壳同梱，由壳 spawn-or-attach**（`backend.ts:229`，二进制由 `XIRANITE_HOST_BIN` 指定）；
- GUI 永不 spawn Node。

所以「面必须走协议」**不等于**「独立发行不带引擎」——发行必须带那一整个单元，否则 `service.invoke` 没人回答。
被否决的只有一种形状：在面进程里用 TS 复刻被调方（napi 嵌 QuickJS、自建 service provider），那才会让 §2 的
环境规则（collation / clock / random / 字节预算 / 授权根）出现两份需要维持等价的实现。
完整口径见 `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md` §5.1 与
`AGENTS.md` 里「发行形状只有一个实现，三种投递」那条。

## 8. 为什么不把宿主 arms 编成 napi 插件（`.node`）

这个决定问过就该停在原地。结论：**体积上没便宜，工程上多四笔代价。**

现读尺寸（本机 arm64，`cargo build --release` 带 `[profile.release]` 的 `lto="fat"` + `strip`，见根
`Cargo.toml`）：**这两个宿主数是 03:4x 那次构建量的，之后注册表又加了节点**——量级不会变，但要引用就重测。

| 形状 | 实测 |
| --- | --- |
| 整个无窗口宿主 `target/release/xiranite-dev-host`（引擎 + 23 操作 + 6 服务臂 + registry + axum） | **6.9 MiB** |
| 桌面宿主 `target/release/xiranite-desktop` | 17.3 MiB |
| 引擎静态库 `target/release/build/rquickjs-sys-*/out/libquickjs.a` | 1.45 MiB |
| 本仓现成 napi 产物，且只装**一个**能力 | `native/artifacts/darwin-arm64/xiranite-czkawka…node` **20 MiB**（win32-x64 那份 36 MiB）、`xiranite-slimg…` 13 MiB、`xiranite-neoxide…` 2.5 MiB |

`.node` 命名规则是 `${name}.${platform}-${arch}.node`（`packages/czkawka-native/src/native-asset.ts`），
所以 addon 化意味着每平台 × 每 Node ABI 一份预编译，还要带回退分支。

四条代价：

1. **语义份数。** run 状态机（queued / cancel / pause / resume / checkpoint / 事件流）现在实现在 axum 路由 +
   `xiranite-node-runtime` 那一侧。addon 要么自己再实现一遍，要么把 axum 塞进 addon——后者正是
   ADR-0074 `:5-8` 明确 reject 的 **napi-embedded**，理由是 §2 那组环境规则不能有两个实现。
2. **崩溃半径。** addon 崩 = 面进程崩 = 用户终端消失；宿主崩 = 面答一行 channel 拒绝，壳还活着。
3. **两条装载路径。** 桌面本来就要那个 Rust 单元；面再走 `.node` 等于同一份 arms 两种链接方式，长期防漂移。
4. **取证变难。** 现在可以手起宿主、读它 stdout 的 `XIRANITE_CHANNEL` 行（§9）；addon 只能往 Node 里挂调试器。

一条**未实测**、别当数据引用：跨 loopback HTTP 的一次 POST 相对一次 CPU-bound 的 run 是否可忽略——这是推断。
真想要「直接调一下核心」的便利，现成件是 `xiranite-dev-host`（无窗口宿主，`crates/xiranite-loopback-host/src/bin/dev_host.rs`）
和执行器自带的取证二进制 `quickjs-run`（`crates/xiranite-quickjs-executor/Cargo.toml:71-73`），不必为此把整个宿主 napi 化。

## 9. 「节点注册进去了」只能现读，mtime 不算证据

实测踩过：`crates/xiranite-scripted-nodes/src/registration.rs` 03:32 改，`target/debug/xiranite-dev-host`
的 mtime 是 03:34（看着比改动新），但那份二进制里 `rg -a -F runSleept` 命中 **0**；重编（27 s，`-j 1` +
sccache）之后它才自报 `nodes [classq, dissolvef, kisaki, linedup, logx, nameu, samea, sleept, timeu]`。
可用的判据只有两种：起宿主读 `xiranite-dev-host: nodes [...]` 那行，或对二进制按符号名做 `rg -a -F`。
