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
5. **路径算术不是能力，但它是宿主形状的。**`join/resolve/dirname/basename/extname/relative/isAbsolute/parse`
   不回答任何宿主 op，所以它们**不进** `CAPABILITY_FOR_OPERATION`（那张表是 op↔方法的一一对账，塞进去就毁了）；
   它们作为 `HostCapabilities.path` 同形提供：realm 侧是 `src/path-realm.ts` 里那份复刻 `join_paths`
   （折叠 `\`→`/`、不折叠 `..`）的实现，面侧就是 `node:path`。实现已从 `packages/quickjs-shims/src/path.ts`
   搬进能力包（shim 那份从 348 行缩成 19 行的 alias 目标），因为「一份 join 不能住两个地方」。
   搬动时踩到一条非显然的坑并在代码里写了因由：bundle 构建的 `--alias:@xiranite/host-capabilities=…/realm.ts`
   会被 esbuild 当成**前缀**应用，所以 shim 里若写包说明符 `@xiranite/host-capabilities/path-realm` 会被改写成
   `…/realm.ts/path-realm` 而「not a directory」——25 个用 path 的节点会集体构建失败（实测），故该处用相对路径。
   realm 侧另加了三条断言：join 确实不折叠 `..`；**宿主对带未折叠 `..` 的路径照答 file**（实测事实，不是推断）；
   `basename(x, suffix)`/`extname`/`sep` 与 Node 同形。
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
  `extractImportEdges`），基线 `docs/platform-capabilities-baseline.json` 是**天花板不是快照**。**本文不记当下读数**——
  它一小时就会过期；读数一律现跑 `bun scripts/audit-platform-capabilities.ts`（2026-10-05 22:2x 的读数是
  retained 28、直连 6 文件/8 条、能力面 26/28、`node:path` 0/0；还直连机器的就是
  bandia/bitv/enginev/sleept/smartzip/timeu 这六个）。
- **「换过去」按文件读会读窄**，所以尺加了第三列：`machine builtins reached THROUGH a package`。现跑是
  **11 个节点 / 18 条 package×builtin 边**——这些节点的 `platform.ts` 自己不引机器内建，但它们引
  `@xiranite/config`、`@xiranite/logging`、`@xiranite/file-operations`、`@xiranite/czkawka-native`，
  那四个共享包自己做机器访问。⇒ 「26/28 已在能力面上」这句只说文件层，剩下真正没搬完的是**四个共享包**，
  不是 12 个节点。按包拆开才是能干活的形式，基线因此带 `hiddenByPackage`（每包只许降）：
  **`config` 2、`czkawka-native` 1、`file-operations` 2、`logging` 2 —— 这 7 个数就是这次迁移剩下的全部范围**；
  某一包归零，它压着的那条 `shims/*` 别名才有得删；基线里没有的包名出现即红（那是新的未声明机器依赖，不是进展）。
  三个容易读错的点都钉了对照（`scripts/audit-platform-capabilities.test.ts`，6 pass）：
  ① 走 `@xiranite/host-capabilities` 不算边——bundle 里它的 `node.ts` 被 `REALM_PACKAGE_ALIASES` 换成 `realm.ts`，
  实测 26 份产物里 `node:module`/`node:assert`/`node:worker_threads` 字面量**零命中**；
  ② 只从 entry 图里走，`logging/src/cli.ts` 那种入口不 import 的文件不计（否则数的是包的全部文件而不是需求）；
  ③ `exports` 指向 `dist/*.js`，测量要跟到它的源码 `src/*.ts`——**方向与「dist 不算消费者」相反，而且要分清是
  谁的 dist**：节点自己的 dist 翻译回 `src` 后与已有的源码行按路径去重自然合并；共享包的 dist 在图里是唯一可见
  形态，一律不算消费者就会把 `logging`/`file-operations` 的活需求读成零（这把尺先前正是这样把
  `crypto.ts`/`readline.ts` 误判成「条件性可删」的，见下一条）。
- 剩下的直连文件卡在四类真缺口上，每类都要求「一个答案一份实现」，所以按 ADR-0074 §2 该往宿主加 op 而不是
  往表面加假实现：① 创建时间（`timeu` 写 journal、`enginev`/`bandia` 读 `createdMs`）；② create-if-absent
  写臂（`bitv` 的 `flag:"wx"` 编号循环）；③ realm 无定时器（`recycleu` 的 sleep、`sleept` 的采样节拍）与无
  env 写（`kisaki` `:293-296`）；④ `os.cpus` 的 per-cpu `times`（`sleept`，见决策 7）。每个留置点都在自己
  文件里写了因由，`rg -n 'from "node:' packages/nodes/*/src/platform.ts` 能把它们全捞出来。
- 共享包那一刀的**剩余三条边不是机械替换**（`@xiranite/file-operations/src/platform.ts`，现读行号），按 ADR-0074 §2 该往宿主加 op：
  ① `cp` 带 `preserveTimestamps: true`（`:114-119`）——表面的 `fs.copy` 只有 `recursive`/`force`，时间戳不是可选装饰：
  同一个文件的 `mtimeMs`/`ctimeMs` 正是这里撤销守卫比对的字段（`snapshot()` `:179-188`），悄悄丢就等于把守卫降级；
  ② `mkdir(dest, { recursive: false })`（`:161`）——`fs.ensureDir` 在宿主是 `create_dir_all`（`filesystem.rs:ensure_dir`），
  用它答会把「父目录不存在要失败」变成父目录一起建出来，是另一种答案；
  ③ 撤销守卫还读 `dev`/`ino`（`:186-187`，比对在 `sameGuard` `:191-193`），而 `fs.stat` 的应答里没有设备号与 inode，
  跨设备同号会被判成同一个东西。⇒ 这三条要和四类节点缺口一起排进宿主 op 设计，不在表面塞假实现。
- 另外两条共享包边逐条读到底，也都**不是机械替换**（合起来就是「机械的活儿已做完」的根据）：
  - `@xiranite/config`：根模块**必须不碰字节**——`packages/config/src/boundary.test.ts` 头部写的是设计而非偶然，
    理由是实测的：bundle 只要拖进 npm 的锁实现（`graceful-fs` 往不可写的 `fs` 对象上赋属性）就在 realm
    **装载期**死（`linku` 上量到，`docs/migration/quickjs-substrate-evaluation.md` §15.8）。
    所以 `src/paths.ts:2-3` 的 `node:os`/`node:path` 不许改成「依赖表面的 Node 臂」；而 `src/node.ts` 的
    `replaceAtomic()` 是**同目录临时文件 + fsync + rename**（还在长度上设了 `MAX_TEXT_BYTES` 闸门），
    文件头明写 `crates/xiranite-core/src/config_store.rs` 是这句话的另一半、由 `transport.test.ts` 钉住两组常量。
    换成表面的 `fs.writeText`（mkdir+writeFile）不是「少一个特性」，是把一份**两侧对齐的锁-替换协议**改成不原子
    ⇒ 缺的是「带 overwrite 控制并 fsync 的原子替换」这一臂，而且要连 Rust 那半边一起定。
  - `@xiranite/logging/src/node.ts`：缺一个 `zlib.gunzip`（`:7 createGunzip`，读旧日志要解压；
    `MODULE_SURFACES` 今天明确拒绝 gzip 族——realm 无 WebAssembly 且纯 JS 编码器不可用）。同文件的
    `readdir`/`stat`/`mkdir` 与按范围嗅探（`:178 {start:0,end:1}`）**表面已经能答**
    （`fs.list`/`fs.stat`/`fs.ensureDir`/`fs.readBytes({offset,length})`）⇒ 这条边只卡在那一个 op 上，
    它到位 `shims/zlib.ts`（155 行）就失去最后一个消费者。
  - `@xiranite/czkawka-native/src/index.ts:2,97` 是 `createRequire(import.meta.url)` 载 NAPI `.node` addon：
    realm 没有 addon 装载，这条边按设计归宿主（`HOST_SERVED_PACKAGES` 就是这个用途），只有 `:1 existsSync`
    可换，换了也不动产物。
- 所以剩下的账是确定的：**节点侧 8 条直连 + 共享包 4 条边，全部要宿主先加 op**（创建时间、create-if-absent 写、
  单层 mkdir、`cp` 的 `preserveTimestamps`、`fs.stat` 的 `dev`/`ino`、带 overwrite 的原子写、`zlib.gunzip`、
  realm 定时器与 env 写、per-cpu `times`）。这些落在 Rust 侧。
- **`sleept` 在 realm 里的那条真红修掉了，原因不是 op 缺口**：`platform.ts` 有一句模块作用域的
  `let lastCpuSample = readCpuSample()`——**求值期**就调机器。面侧拿到 Node 的数组没事，bundle 里 `node:os` 是
  shim、答的是宿主的 `{ count, models }`（没有 `times`），于是 `.reduce` 里 `cpu.times.user` 直接抛，
  bundle **装载即失败**，看起来像「realm 缺 per-cpu times 这个 op」，其实是装载顺序问题。
  三处改动：① 基线采样搬进 `createNodeSleeptRuntime()`（节点的机器访问只在 createRuntime 里发生，不许在导入时）；
  ② `readCpuSample()` 形状不符答 `null`，`getCpuPercent()` 的类型因此是 `number | null`；
  ③ `core.ts` 的 `status` / `get_stats` / `cpu` 监视三个消费点对 `null` **拒绝**（`success:false` + 原因），
  不编 0——这一条不是洁癖：CPU 监视器等的是「机器空闲」，一个假的 0 会真的把机器睡下去。
  实测：realm 扫描 20/26 + 1 崩溃 ⇒ **21/26、0 崩溃**（`bun spikes/realm-node-scan/scan.ts` rc=0）；
  `sleept` 包 39 测 + `tsc -p` rc=0；新增一条 `core.test.ts` 用例钉住「答不出就拒绝、且不许触发上电动作」。
- 中途我自己踩了一次纯惰性的版本：把基线改成「第一次调用时取」，结果单次 `status` 就没有可比的上一帧 ⇒
  `cli.test.ts` 的 `status --json` 用 `exitCode 1` 把它抓回来了。**节点合同的「一次调用要给一个答案」是活的约束**，
  改采样时机时得以 CLI 用例为准，不是以我觉得干净为准。
- **宿主今晚已经有了对这个问题的答案，但它在服务表里、不在 op 里**：`e15f8f63` 把 `os_operations` 注册进
  `service.invoke` 的表（`host_services.rs` 里 `name: "os"`、`methods: os_operations::METHODS`），带
  `cpu.usage`，答的是 `{ busyPercent, perCore, windowMs }`——形状是「答问题」而不是给原始 jiffies，
  理由写在 `xiranite_core::cpu`：sysinfo 0.39 的 `Cpu` 没有累计时间，且它有 `MINIMUM_CPU_UPDATE_INTERVAL = 200ms`，
  没到窗口就**跳过刷新**（第一版因此连续两次答逐位相同的数字，只有 `window_ms` 在动）。
  ⇒ 这条改写了上面那条拒绝的**期限**而不是它的正确性：`sleept` 在 realm 里现在**仍然**答不出 CPU，
  因为授权那一列还没有数据源——清单里**声明 `services` 的节点是 0 个**（现读
  `docs/xiranite-target-node-manifest.json`），`derive-scripted-policy.ts` 无条件 `services: []`，
  而 `realm_run.rs` 读的就是 `descriptor.requirements.services`。
  下一个动作因此不在本 ADR 的表面上，而在清单/策略那一层：给 `sleept` 声明 `services: ["os"]`，
  然后把 `readCpuSample()` 的 realm 分支换成 `service.invoke("os", "cpu.usage", …)`，
  按 `{busyPercent, windowMs}` 而不是自己差两个 `times` 帧来算。**授权一列到位之前，`core.ts` 那句
  `success:false` 的拒绝是对的行为**，不许改成「先答 0 占位」。
- leg 2 钉成可判的事实（不靠记忆）：现读 `packages/host-capabilities/src/operations.generated.ts` 是 **30 个 op**，
  `CAPABILITY_FOR_OPERATION` 有 **30 条映射、未映射 0** ⇒ 「每个宿主答得上的 op 都有一根方法」这句是量出来的。
- **服务授权那一列现在有数据源了**：可行性分析器新增 `services`（`ServiceGrantEvidence[]`），权威是构建用的
  `HOST_SERVED_PACKAGES`，不是包名猜测——节点自己的 `service.invoke("<name>"` 字面量算 `direct`，
  `const SERVICE = "<name>"` + `opServiceInvoke*(SERVICE, …)` 的 shim 服务模块算 `aliased <说明符> -> shims/<文件>`。
  现跑 `bun packages/tauri-migrate/src/cli.ts feasibility --force` 的表是：
  **kisaki→czkawka、linku→config、clipm→config、findz→findz，其余 26 个保留节点为 0**（30 条记录里 4 条非空）。
  两次口头猜测被这条尺否掉：① 「引 `@xiranite/config` 的五个节点都该拿 config」是错的——表里登记的说明符是
  `@xiranite/config/node`，裸包名走的是内建 fs 那条别名，dissolvef/marku/migratef/trename 因此**不该**有授权；
  ② `xiranite-builtin-host/src/kisaki.rs:47` 硬写 `.with_services(&["czkawka"])`，清单里却一条 `services` 都没有
  ⇒ 声明与授予不一致，现在它至少是**可指认的一行数据**。
  下一步仍然差两件事，都不在表面：清单里给这 4 个节点写 `services`，以及 `derive-scripted-policy.ts`
  不再无条件 `services: []`（那个文件此刻被另一条 lane 在途改写）。这两件到位之后，`sleept` 的 realm 分支才
  可以改成 `service.invoke("os", "cpu.usage", …)`，上面那条 `success:false` 的拒绝才退场。
- **但「走服务」这条路本身两侧都不通，这条要先记下来免得下一次又当成捷径**：`service.invoke` 在 Node 传输里
  是按名字抛错的（`packages/host-capabilities/src/node.ts`，`coverage.test.ts` 钉着），宿主服务只住在宿主进程 ⇒
  CLI/TUI 面要拿它只能走 `/operations` 的 operation 客户端，不是能力面；realm 那侧就算服务已注册，也得先有清单授权。
  所以 `cpu.usage` 作为**服务方法**存在，并没有关掉缺口 ④：把它接进 `sleept` 会让面侧从「能答」变成「抛错」，
  realm 侧还得等授权列。真正两侧同形的位置只有一个——**`os` 上一个 `cpuUsage` op**（与 `os.tmpdir`/`os.homedir`/
  `os.cpus` 并列，同步或异步按宿主那一臂定），答的仍是 `{busyPercent, windowMs}` 那份「答问题」的形状。
  这一句是设计结论不是待办：要改的是 `crates/quickjs-host-protocol` 的词表 + `os_operations` 的臂，两边都在另一条
  lane 手里；本 ADR 这边已经把 `sleept` 的形状准备好（`getCpuPercent(): number | null`，null=答不出即拒绝）。
- **前半件已经落了**：`--apply-host-requirements` 现在把 `services` 与配对的 `service: <name> <via> at <file>:<line>`
  证据行一起写进清单（`audit:target-node-manifest` 有一把新校验：没有证据行的服务名直接红，名字还得是注册表的键），
  现读三行：`findz→findz (core.ts:2)`、`kisaki→czkawka (platform.ts:2)`、`linku→config (platform.ts:9)`；
  `clipm` 也证明到 config，但它是 disabled，写路径按设计不给它记。`--apply-feasibility` 之外这条路径第一次有了
  「声明=测量」的闭环，`kisaki.rs:47` 那句硬写 `.with_services(&["czkawka"])` 从此有了一行清单依据可对。
- **落这一件时挖掉一个真会吃数据的洞**：`applyHostRequirements` 是整份替换 `node.evidence`，只把  `program: ` 开头的人工行挑出来保留 ⇒ 第一次跑这个 flag 就**删掉了 6 行 `maxLiveBytes:` 出处**，
  然后 gate 反过来报「ceiling 没有出处」，rc=1。清单里人工写的行（`user decision 2026-…`、`git ls-remote …`、
  `commit ae6b34d3 …`）同理都会被吃。写路径现在按「这一条是不是我生成的」判断（自己的前缀，或
  `<路径>:<行> <tier> ` 形状），不认识的一律留下；复跑后 `maxLiveBytes` 6 行零丢失、
  `hostRequirements` 与 `programs` 逐节点零漂移、evidence 226→238（新增的是服务与刷新过行号的 tier 行）。
  一条通用口径：**任何"重新生成一份带人工注记的清单"的写路径，都必须先定义哪些行是自己产的。**
- 删除动作本来归 `packages/quickjs-shims` 那条 lane，本 ADR 只给「谁还在消费」这张账；2026-10-05 22:4x 账上
  第一条**真的零消费者**的落地了（`assert.ts` 34 + `worker-threads.ts` 59 + `module.ts` 53 + 随之失效的
  `node-assert.d.ts` 31 ⇒ 177 行）。一次动的不只是一份文件表：`surface.ts` 的三张表都记着它们
  （`SHIMMED_BUILTINS`、`BARE_BUILTINS`、`MODULE_SURFACES` 各三条），`package.json` 三条 `exports` 子路径也是。
  判「删干净」的证据是构建的失败集合没变：删前后都只有 `bandia/cleanf/enginev/smartzip` 四条 FAIL，且
  **`Could not resolve` 零命中**——也就是说打包进来的 npm 从来没找过 `node:assert`/`node:worker_threads`/`node:module`，
  别名面可以整条撤。
- **一处故意留的债**：`node-assert`（`npm:assert@^2.1.0`）这条依赖现在没有 importer，但没有连 `bun.lock` 一起动。
  改锁会把另一条 lane 在途的锁条目一起改写，而 CI 的 `--frozen-lockfile` 恰好是那条线上周红过的地方；
  等那棵树安静时一条 `bun install` 就能收。
- **顺带发现：两个门的对照从来没跑过任何人**。`scripts/audit-node-bundles.test.ts` 与
  `scripts/audit-platform-capabilities.test.ts` 都是 `bun:test` 写的，而 `vitest.scripts.config.ts` 的 `include`
  只点名两个别的文件、17 条 `test:*` 里没有它们、CI 也没点名——它们只在我手工 `bun test <路径>` 时才活。
  补了三条入口：`test:node-bundles`、`test:platform-capabilities`、`audit:platform-capabilities`
  （那张尺此前连一个脚本名都没有）。现跑 `bun run test:node-bundles` 11 pass、`bun run test:platform-capabilities`
  4 pass（含「天花板为 0 时第一条 `node:path` 就得红」那条读**真基线文件**的对照）。
- **上一条被自己推翻了，这里是修正后的读数**：把 dist 边翻译回源码之后（`build:*` 顺 `exports` 解析到的是
  编译产物，所以 `packages/logging/dist/node.js` 这条边其实就是 `src/node.ts` 今天的 `import "node:readline"`），
  账上**没有任何一行是可删的**，而且先前的「只剩旧产物引用」那两行根本是**活需求**：
  `crypto.ts` 165 行被 `@xiranite/file-operations` 的 `src/FileOperationService.ts`（`node:crypto`）压着，
  `readline.ts` 35 行被 `@xiranite/logging` 的 `src/node.ts`（`node:readline`）压着，`path.ts` 的第一方活引用
  也从 0 变成 **5**（`config`/`logging`/`file-operations` 这些共享包按说明符引 `node:path`，走的是别名不是文件）。
  ⇒ 删这两个别名当时就会变成 realm 里的运行期拒绝。**尺把 dist 一律当陈旧产物是错的**：对节点自己的 dist 成立
  （源码另有其行、按路径去重自然合并），对共享包的 dist 不成立，因为那正是 bundle 里唯一可见的形态。
  现在 `classify()` 把 `*/dist/x.js` 翻译回 `*/src/x.ts` 并在源码存在时计为活引用，只有没有源码兄弟的产物才算陈旧。
- 于是「换掉一个删一个」的真实依赖关系写死了：**下一批删除要等 `@xiranite/config`、`@xiranite/logging`、
  `@xiranite/file-operations`、`@xiranite/czkawka-native` 这四个共享包把机器访问搬到表面**（就是上面第三列那
  11 节点 / 18 边的来源）。搬一个包，`shims/fs.ts` / `zlib.ts` / `crypto.ts` / `readline.ts` 这类才会真正失去
  最后一个消费者；节点侧已经没有可搬的了。
- 那一步的**第一条命令已经跑过了，而且先前那句「被 bun.lock 挡住」是我写错的**：`@xiranite/host-capabilities`
  作为 workspace 包在锁里早就有条目（节点们依赖它），再加一条 `workspace:*` 边**不需要新的锁条目**——
  `bun install --frozen-lockfile` rc=0、「no changes」、`bun.lock` 一字未动。⇒ 剩下三个包（`config`/`logging`/
  `czkawka-native`）没有锁这层等待，直接搬即可。
- **第一刀落地的证据**（`@xiranite/file-operations` 2 ⇒ 1，第三列 18 ⇒ 13 边）：`FileOperationService.ts` 的
  `randomUUID` 改走 `hostCapabilities.crypto.uuid()`，包内 `tsc` 与该包 13 测全绿；全量重建后
  **产物里 `node:crypto` 字面量归零**、FAIL 集合仍是他那四条（没新增）、realm 扫描仍 20/26 跑起来
  （`kisaki` 是这个包的用户，照旧给出业务答案）。尺的对照也被这次改动本身修了一次：那条对照先前硬写了
  `file-operations: 2`，包一搬完它就红——同一个数不该有两处权威，已改成从基线里解构。
- **`crypto.ts` 撤回「零引用边」**：`build-node-bundles.ts` 用 esbuild `--inject` 编 `shims/src/index.ts`，
  那是一次**独立编译**，它自己的 import 不进节点的 metafile 图。prelude 引的是 `buffer.ts` / `crypto.ts` /
  `process.ts` / `host.ts`——realm 的 `globalThis.crypto` 就是 `createCryptoGlobal()` 造的。所以账面上
  `crypto.ts` 曾是「完全没有引用边」，其实它被 prelude 结构性地消费着。账现在把 prelude 的边补上（分类进「包内」），
  `crypto.ts` 读 `包内=1 ⇒ 跟着引用者一起走`。**教训**：一把只走「产物图」的尺，会漏掉一切不进图的装载方式；
  判「可删」之前要问还有哪些装载路径。反过来这也证明上一步删的 `assert`/`worker-threads`/`module` 是对的：
  它们不在 prelude 的 import 里，且构建与 realm 都没新增失败。
  - `ops.ts` 433 / `internal.ts` 332 / `constants.ts` 144 **不是**独立可删：它们的引用者在 shim 包内
    （`fs.ts`、`fs-promises.ts`、`child-process.ts`、`crypto.ts`、`host.ts`），要跟着那批一起走。
    把「活源码列表里没有外部包」读成「零消费者」是这次差点写进去的错。
  - `fs-promises.ts` 338 只剩 4 条活引用，全部来自被协议缺口卡住的 `bitv`/`timeu`；`fs.ts`/`child-process.ts`/
    `util.ts`/`zlib.ts`/`events.ts`/`crypto.ts`/`readline.ts` 的活引用为 0，剩下的都是 npm 与旧 dist。
  - `path.ts` 的**节点侧**直连已归零：换完那 23 个 `platform.ts`（基线的 `pathFiles` 就是 23）之后
    `audit:platform-capabilities` 读 `node:path 0 files / 0 imports`，实现也早已住在
    `packages/host-capabilities/src/path-realm.ts`，shim 那份只剩 19 行 re-export。**但共享包仍按说明符引
    `node:path`**（`config`/`logging`/`file-operations`），走别名不走文件，所以消费者账上它是 `活引用=5`
    （把 dist 翻译回源码之后的读数），删不掉。
  - **一条把话说小的实测**：`node_modules/vfile/lib/minpath.js` 是
    `export {default as minpath} from 'node:path'`，即**整体再导出命名空间**，不是几个成员。所以把 23 个节点
    换成 `hostCapabilities.path` 并不能按成员把 `node:path` 的别名面削小——只要 vfile 这类依赖还在 bundle 里，
    完整命名空间就得留着。路径这一刀的收益因此是「节点不再直接依赖 Node 形状」与尺上的一条归零（基线已按
    0/0 钉住，重新引入一条 `node:path` 就是红，见 `scripts/audit-platform-capabilities.test.ts` 的第三条对照），
    **不是**删掉一个文件；`path.ts` 真正的删除杠杆是换掉带 vfile/rotating-file-stream 的那批依赖
    （`packages/logging` 的滚动文件是第一个候选，那是另一个决定）。这条是先派活、后量出来把预期改小的——
    记在这儿，免得下一个人按「23 个文件换完就能删 path.ts」去算。
  - 测量规矩：**`*/dist/**` 的引用者不算消费者**。esbuild 顺 package exports 会解析到 gitignored 的旧产物
    （`packages/nodes/crashu/dist/platform.js` 里仍然是迁移前的 `node:fs` 导入），所以「谁还在消费」这张账
    必须区分 `src` 与 `dist`，否则门会报幻影消费者、把还能删的东西判成不能删。

## 验证（2026-10-05，macOS arm64，Rust 侧全部 `-j 1` 串行、`RUSTC_WRAPPER=sccache`）

- `packages/host-capabilities`：`tsc -p` rc=0；`vitest` 14/14（含阳性对照：方法名齐而实现为空的传输必须被
  `assertCoverage` 拒掉；`remove`/`copy`/`move` 三条宿主同形断言）。
- `bun scripts/generate-host-capabilities.ts --check`：新鲜 rc=0；往生成物追加一行 ⇒ rc=1；红过的那次还是真的
  不一致（我改了模板里的命令行没重跑）。
- `packages/tauri-migrate`：25/25，其中新增一组含**整段自建的对照组**并断言扰动确实落地（第一版用 `replace()`
  造对照，锚点没中 ⇒ 门假绿，被它自己抓出来）。
- realm 侧：`spikes/capabilities-realm-probe/run.ts` 20/20（同一份 `sha256("abc")` 在宿主与 Node 两侧同值；
  `copy(force:false)` 第二次回 `the destination already exists`；非 ASCII 路径整条回环；越出授权根的
  `/etc/hosts` 答 null 不是读到真文件）。`spikes/realm-node-scan/scan.ts` **20/26 跑起来** + 1 条真红（`sleept`，
  已做迁移前后对照）+ 4 条 `no-bundle`（他 lane 的 `getTrashCapabilities` 缺导出：bandia/cleanf/enginev/smartzip）
  + 1 条无 runtime 导出（`linedup`）。跑起来的 20 个 id 现在全量打印（原来只印前 8 行，问「我这个节点过了没」
  答不出来）。
- 逐节点：19 个迁移文件各自 `bun run --cwd packages/nodes/<id> test` 与 `bunx tsc -p … --noEmit` 全 rc=0（我复跑，
  不信代理自报）；`audit:quickjs-host-ops` OK（宿主 30、answered-but-unconsumed 0）。
- 2026-10-05 22:0x 收完 `node:path` 那一刀之后重跑（23 个 `platform.ts` 串行 `tsc -p` + 包内 `test`，23/23 全
  rc=0；`node:path` 直连 23 文件/23 条 ⇒ **0/0**，基线已钉在 0）。
- **换完才发现的两个分析器盲点**（都不是节点的问题，是尺的问题；两条都是「迁移把证据形状换了，规则还看着旧形状」）：
  - `recursive-enumeration`：`walk()` 从 `readdir` 换成表面的 `fs.list` 之后不再算「列出目录」，7 个节点的枚举授权
    静默消失（bitv/cleanf/encodeb/kisaki/linku/repacku/smartzip）。这条最坏，因为它削掉的正是「宿主许不许你走树」。
  - 整链接收者：`hostCapabilities.fs.stat(...)`、`hostCapabilities.proc.exec("7z.exe", …)` 这种不展开的写法，旧规则
    只认 `fs`/`proc` 两个短名，25 个活调用点整条不可见（kisaki/mvz/repacku 因此丢了 `external-process`）。
  两条修完重跑：8 个节点的分级回到与清单一致，28/28 保留节点在清单与产物之间零漂移（只剩 `clipm`/`lata` 两个搁置
  节点在产物里有、清单里没有）。对照写在 `packages/tauri-migrate/src/node-feasibility.test.ts`（现 17 测全绿，整包 28），
  含「单次 `fs.list` 不构成递归」这条反向对照。
- `bun scripts/build-node-bundles.ts` 有个真实在野的门洞：**四个节点的 platform bundle 报 FAIL，脚本仍 rc=0**，
  末行还印「30 core bundles ok」——它只统计 core 一列。已改成任一列失败即 rc=1 并点名（实测现在 rc=1、
  「4 nodes with a failed bundle」），`manifest.json` 多一条 `counts.bundlesFailed`。
- 2026-10-05 23:2x 一次串行全量复跑（`bun scripts/…` 逐条，前一进程退出才起下一条）：
  `generate-host-capabilities --check`、`audit:quickjs-host-ops`、`audit:platform-capabilities`（含其 6 测）、
  `audit:target-node-manifest`（含其 23 测）、`cli.ts feasibility --force`、`packages/tauri-migrate` 全套、
  `packages/host-capabilities` 全套、`spikes/realm-node-scan/scan.ts`、`spikes/shim-consumer-audit.ts`、
  `packages/nodes/sleept` 全套 ⇒ **全部 rc=0**；唯一 rc=1 的是 `build-node-bundles`，失败集合仍是他 lane 的
  `bandia cleanf enginev smartzip` 四条（`getTrashCapabilities`）。realm 侧读数 **21/26 跑起来、0 崩溃**
  （`sleept` 今晚从 CRASH 变成能答），其余 5 条是上面 4 个 `no-bundle` 加 `linedup` 无 runtime 导出。
- **那 4 条 FAIL 的确切因果链（esbuild 只说出了一半，值得写下来）**：报错是
  `No matching export in "packages/quickjs-shims/src/czkawka-service.ts" for import "getTrashCapabilities"`，
  但**导入方不在那里** —— 是 `packages/file-operations/src/platform.ts:4` 从 `@xiranite/czkawka-native` 拿这个名字，
  而 `@xiranite/czkawka-native` 在 `HOST_SERVED_PACKAGES` 里，bundle 构建会把它整包换成
  `shims/czkawka-service.ts`。换进去的那份现在不再转出这个符号 ⇒ 凡是把 `@xiranite/file-operations/platform`
  拉进图的节点（bandia/cleanf/enginev/smartzip）整体失败，而 `czkawka-native/src/index.ts:155` 自己还在导出它，
  所以 Node/面侧一切正常 —— **典型的「只在被替换的那条边上才成立」的断链**。
  修法两种，都归回收站那条 lane：让 shim 的服务模块转出 `getTrashCapabilities`，或者让 `file-operations` 不从这个
  会被换掉的说明符上取名字。本 ADR 这侧不动它们（那三个文件都在他人的在途改写里）。
- 未验证：Windows。这些传输与门在本机成立，`sleept`/`bandia` 那类路径型程序授权问题要到 Windows 上按
  ADR-0078 §验证 的口径复跑才算数。
