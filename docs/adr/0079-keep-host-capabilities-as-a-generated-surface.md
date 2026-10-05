# 宿主能力面是一份生成的表面，不是 Node 兼容层

- 状态：Accepted（2026-10-05）
- 取代：`packages/quickjs-shims` 作为「节点面唯一入口」的地位（它继续存在，但收敛成第三方打包依赖的下限，见后果）
- 相关：ADR-0074（一个节点一份实现、QuickJS 作为唯一执行器）、ADR-0078（底座集中在 `quickjs-realm` + `quickjs-host-protocol`）、ADR-0073（`NodeRequirements`）

## 背景和量

用户判断：**「我们不是要 Node 兼容层，只要能扩展 QuickJS 能力，并且尽量少维护自己那堆函数。」**
这句话把此前所有关于 QuickJS 补强的讨论前提换掉了，所以先量再定。量出来的账（现跑
`spikes/shim-consumer-audit.ts`，逐个 import 边回读，而不是看文件写了什么）：

| shim 模块 | 行 | 只有我们第一方在用 | 第三方包在用 |
|---|---|---|---|
| `path.ts` | 348 | 27 | 2 |
| `fs-promises.ts` | 338 | 23 | 1 |
| `child-process.ts` | 258 | 20 | 1 |
| `fs.ts` | 288 | 5 | 2 |
| `os/util/crypto/zlib/url/readline` | 688 | 12 | 4 |
| `host.ts + ops.ts + internal.ts` | 1,345 | — | — |
| `buffer/events/stream/string-decoder/assert` | 264 | 1 | 9+ |

约 **1.57k 行的 Node 形状只服务我们自己 41 个 `platform.ts`**；真正删不掉的第三方下限是 264 行，而那 264 行
本来就是 npm 包的 re-export（`readable-stream@4.7.0`、`assert@2.1.0`、`events@3.3.0`、`string_decoder@1.3.0`、
`buffer@6.0.3`），不是我们的算法。也就是说：缺的不是「再找一个 runtime 帮我们把 Node 实现好」，
**是别再让 41 个文件各自造同一套形状**。

## 决策

1. **能力面是一 op 一方法，从编译产物生成。**`@xiranite/host-capabilities`（`packages/host-capabilities`）
   的每个方法正好回答 `crates/quickjs-host-protocol` 里一个 `HostOperation`；名单由
   `scripts/generate-host-capabilities.ts` 从编译后的 `HostOperation::ALL` 取（复用 `print-host-ops`，理由与
   `audit:quickjs-host-ops` 相同：从源文本刮 `domain.ident` 会量出 31 个，`fs.readRange` 是负测夹具）。
   `CAPABILITY_FOR_OPERATION` 用 `satisfies Record<HostOperationName, …>` 钉双向——crate 里加一个 op 而这里没点名，
   `tsc` 当场红。命名按它在做什么（`createTemp` 不叫 `mkdtemp`、`remove` 不叫 `rm`、`symbolicLink` 不叫 `symlink`）。
2. **不要 Node 形状。**旧表面每个操作配一个同步孪生是为了「像 Node」，那份翻倍就是本 ADR 要消掉的维护费。
   表面只有 Promise 形状，**除** `clock.now()` / `crypto.uuid()` / `os.tempDir()` 三件——它们在宿主有同步臂，
   而 `marku` 的 `now`/`randomId`、`bandia` 的 `tempDir` 在各自 runtime 类型里就是同步的；把它们包成 Promise
   的代价是那些文件为一个一次宿主调用就能答的值继续留 `node:` 导入，与目的相反。
3. **两份传输，且传输永远不许比宿主宽松。**realm 侧一个方法一次 `__xrh`；Node/Bun 侧（CLI/TUI 面）把这 30 个
   答案用真系统调用实现**一次**。这条不是偏好，是三条实测不一致逼出来的：
   - `move`：宿主对**任何** rename 失败都 `copy_then_remove`（`filesystem.rs:361-365`），Node 传输原先只在
     EXDEV 时做 ⇒ 面侧拒、realm 侧成。已对齐并加断言（把目录移到已存在目录上，非 EXDEV，两侧都得成）。
   - `copy`：宿主有 `copy_onto_self` / `copy_into_self` 两条形状拒绝（`filesystem.rs:575-597`），`node:fs` 的
     `cp` 两条都没有 ⇒ 补齐，否则「把树复制进自己子树」在面侧能一路嵌套到路径长度上限。
   - `remove`：`force: true` 会吞掉「路径不存在」，宿主 `delete` 臂先 `symlink_metadata` 再 `stat_failed`
     （`filesystem.rs:370-373`）⇒ 改掉，`dissolvef` 的撤销路径必须看得见这个区别。
4. **realm 侧的解析靠共用一张 alias 表，不靠 `exports` 条件。**bundle 构建带 `--platform=node`（npm 闭包需要），
   条件导出会把 realm 包错解析成 Node 传输。所以 alias 写在 `packages/quickjs-shims/src/surface.ts` 的
   `REALM_PACKAGE_ALIASES` 里，`scripts/build-node-bundles.ts` 与 `spikes/shim-consumer-audit.ts` 都读这张表。
   只写在一个脚本里曾让探针把 `@xiranite/host-capabilities` 顺 `exports` 解析成 Node 传输，再把它自己的
   `node:fs` / `node:crypto` 记成 shim 消费者——数字虚高且方向相反。
5. **路径算术不是能力。**`join/resolve/dirname/basename/extname/relative` 不是宿主操作，它们单独一次改完
   （25 个第一方消费者），不混进逐节点迁移。`join` 的宿主规则（`join_paths`、不折叠 `..`）保持唯一实现。
6. **门禁跟着表面走，否则它会静默反向。**可行性分析器按「import 说明符 + 调用形状」分级：迁移后既没有
   `node:fs` 也没有 `node:child_process`，于是 ① `@xiranite/host-capabilities` 落进 `isUnresolved` ⇒ 判
   `no-host-free-answer`（词表里最重一档），**24 个节点**被误判；② `proc.exec` 的接收者是解构局部名 ⇒
   `external-process` 一起丢。修完 file-io 14→27、external-process 4→8、进程授权 1→3，只剩 `findz` 带那一档
   （正确，Go sidecar）。同一件事在 `scripts/derive-scripted-policy.ts` 的 `WRITE_CALL_SHAPE` 上也要补，
   不然写证据归零。而这三条在修之前，**这个包自己的测试一直是全绿的**——因为它们跑夹具不跑活树。
7. **产物必须被加载并启动过才算数。**`spikes/realm-node-scan/scan.ts` 拿每个迁移节点自己的合并 bundle、
   它自己的导出名、`quickjs-run` 起真 operation 跑一遍：18/23 给出业务级答案。它抓到 `sleept` 在 realm 里
   **连求值都过不去**（`readCpuSample` 读 `cpu.times.user`，宿主 `os.cpus` 那臂给的是拼出来的
   `cpu0…cpuN` 且没有 `times`）——拿迁移前签入的那份 bundle 做对照，同一个错，行号只差我那份传输的代码量。
   所以这不是迁移造成的，是这个节点在 realm 里从未成功求值过，而既有门禁一次都没发现。
8. **授权仍然只有清单一个真源。**逐节点迁移只把调用改路由到 `proc.exec` / `proc.start`，**没有**、也不允许
   在代码里加程序名；`processes` 的证据仍由分析器从调用位字面量产出（`crashu`/`migratef`/`smartzip` 等正在补做）。
   实测一条结构性拦路石：这些节点 exec 的是**定位到的绝对路径**（`where`/`which` 的输出、`C:\Program Files\7-Zip\7z.exe`），
   而宿主按形状拒绝路径型程序名（`proc_operations.rs:127`），所以名字授权也救不了它们——那是另一条 lane 的题。

## 明确不做

- 不做 Node 兼容层的任何继续投入：成员清单、`MODULE_SURFACES` 的拒绝表、errno 翻译表都不再加条目。
- 不为「像现代 API」给同步答案包 Promise；反过来也不给 30 个方法各配一个同步孪生。
- 不把 `packages/quickjs-shims` 搬出仓或整体删掉（ADR-0078 同条）：它是第三方打包依赖的下限，删到哪一步由
  消费者计数决定。
- 不在 `service.invoke` 的 Node 传输里伪造答案：宿主服务住在宿主进程，面侧要它走 `/operations`，这里按名字抛错。
- 不替宿主编数据：`os.cpus` 现在那臂拼 `cpu0…cpuN` + `speed: 0` 是该纠的（要么答真 times，要么宁缺不造）。

## 被否决的替代（全部现查，含 2026-10-05 的数字）

- **`saghul/txiki.js` 当 runtime 借进来**：3,234★、C、v26.6.0（2026-06-22）在维护，但全库 `node:` 命中 3 处
  （2 处是它文档站脚本、1 处是 vendored sqlite 注释），运行期**没有 `node:` 层**——它的 fs 不是模块，是
  `tjs.readFile` 那个原生命名空间；`mod_fs.c` 单编不出来（48 个 `uv_fs_*` 全要 `tjs_get_loop`、依赖 `private.h`、
  promise 走 `TJS_InitPromise`），静态库零 `install(` 规则、`TJS_GetLoop` 在 `private.h`；权限面 grep
  `permission|allow|sandbox|grant` 只命中许可证头。**能替我们减的行数 = 0**；而 `deps/quickjs` 正是
  quickjs-ng v0.16.0、我们 `rquickjs-sys` 是 0.16.2 ⇒ 同引擎族，借设计不借实现（值得借的：import-map 语义
  `null`=封死 + 最长前缀 + `tjs:internal/` 那道门，`src/js/core/path.js` 当 win32 分支的 diff oracle，
  `vm.c` 的 realm teardown 次序）。
- **`llrt_modules` / `rquickjs-extra`**：前者全 `0.8.1-beta`（255 下载）+ `llrt_crypto` 拉 openssl/ring 和十几条
  RustCrypto 预发布；后者 org 归属是真的（Sytten 发布）但只有 console/timers/url/sqlite/os，**没有
  fs/path/child_process/crypto**，且 os/timers 在 realm 内直接答机器事实（撞 ADR-0074 §2）。降级本身很便宜
  （我们用的每个 rquickjs API 在 0.11 里逐字存在，`array-buffer` 从 0.10 起每版都有），但降到 0.11 换回来的
  只有 console 和 timers ⇒ **0 行**。
- **`deno_node`（0.197.0、527,904 下载、2026-09-16）**：唯一成熟的「Rust 里的 Node 兼容」，但它是 V8/deno_core，
  换它等于换引擎（我们整个宿主现在 4.5 MB）。那是另一次架构决策。
- **`Icemic/quickjs-rusty` 换掉 rquickjs**：`build.rs` 无条件 `do_bindgen()` 且 `builder.compiler("clang")`
  （我们禁 LLVM 保 MSVC），ArrayBuffer 只有 `JS_IsArrayBuffer` 没有构造 ⇒ 字节规则无路；1,890 近期下载。
- **`sebastianwessel/quickjs`**：证明「QuickJS + 宿主能力 + Node-like 表面」这套做得出来（68 个能力只花 247 行
  胶水，`expose(ctx, scope, obj)` 走对象图递归 marshal，没有 op 名单表）——但它要求宿主是一个 Node 进程、
  沙箱靠 memfs 虚拟卷 + 整对象禁用桩，没有授权根概念。抄形状，不作依赖。
- **`rsenn/qjs-net`**：保留节点里 `network` 需求 **0 个**、`core.ts` 里 fetch/net 命中 0；29★、无 CI、无 release、
  `BUGS` 自载 UAF/泄漏。判无关。
- **粘贴稿里的 `vjsx`**：`github.com/guweigang/vjsx` 是 **V 语言**的 QuickJS 绑定（3★），不在 npm、不在 crates.io；
  「它有 fs/path/os/child_process/fetch/sqlite 的 Node profile」在仓库里查无依据。

## 后果

- 迁移计数由 `scripts/audit-platform-capabilities.ts` 把账（AST 与 `audit-node-ui-independence.ts` 共用
  `extractImportEdges`），基线 `docs/platform-capabilities-baseline.json` 是**天花板不是快照**。当前：
  retained 28、`platform.ts` 直连机器内建 **8 文件 / 13 条**、能力面 **23/28**。
- 剩下那 8 文件卡在四类真缺口上，每类都要求「一个答案一份实现」，所以按 ADR-0074 §2 该往宿主加 op 而不是
  往表面加假实现：① 创建时间（`timeu` 写 journal、`enginev`/`bandia` 读 `createdMs`）；② create-if-absent
  写臂（`bitv` 的 `flag:"wx"` 编号循环）；③ realm 无定时器（`recycleu` 的 sleep）与无 env 写（`kisaki`
  `:293-296`）；④ `os.cpus` 的 per-cpu `times`（`sleept`，见决策 7）。
- 删除动作归 `packages/quickjs-shims` 那条 lane（它此刻正在这棵树里删 `deep-equality.ts` 等）；本 ADR 只负责
  给出「谁还在消费」这张账，两边合起来才算这条规则成立。

## 验证（2026-10-05，macOS arm64，Rust 侧全部 `-j 1` 串行、`RUSTC_WRAPPER=sccache`）

- `packages/host-capabilities`：`tsc -p` rc=0；`vitest` 14/14（含阳性对照：方法名齐而实现为空的传输必须被
  `assertCoverage` 拒掉；`remove`/`copy`/`move` 三条宿主同形断言）。
- `bun scripts/generate-host-capabilities.ts --check`：新鲜 rc=0；往生成物追加一行 ⇒ rc=1；红过的那次还是真的
  不一致（我改了模板里的命令行没重跑）。
- `packages/tauri-migrate`：25/25，其中新增一组含**整段自建的对照组**并断言扰动确实落地（第一版用 `replace()`
  造对照，锚点没中 ⇒ 门假绿，被它自己抓出来）。
- realm 侧：`spikes/capabilities-realm-probe/run.ts` 20/20（同一份 `sha256("abc")` 在宿主与 Node 两侧同值；
  `copy(force:false)` 第二次回 `the destination already exists`；非 ASCII 路径整条回环；越出授权根的
  `/etc/hosts` 答 null 不是读到真文件）。`spikes/realm-node-scan/scan.ts` 18/23 跑起来 + 1 条真红（`sleept`，
  已做迁移前后对照）+ 3 条 `no-bundle`（他 lane 的 `getTrashCapabilities` 缺导出）+ 1 条无 runtime 导出。
- 逐节点：19 个迁移文件各自 `bun run --cwd packages/nodes/<id> test` 与 `bunx tsc -p … --noEmit` 全 rc=0（我复跑，
  不信代理自报）；`audit:quickjs-host-ops` OK（宿主 30、answered-but-unconsumed 0）。
- 未验证：Windows。这些传输与门在本机成立，`sleept`/`bandia` 那类路径型程序授权问题要到 Windows 上按
  ADR-0078 §验证 的口径复跑才算数。
