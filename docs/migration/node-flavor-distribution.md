# Route A flavour：一个节点怎么变成一个可分发的 App

状态：2026-10-06 本批。这格补的是 **前端半边**，后端半边（注册表子集 + 宿主自报节点集合）已经由
`docs/migration/host-service-feature-gate.md` §9.5–§9.8 闭合，本文不重述它的证据，只接它的结论。
口径来源：ADR-0069 §Standalone（route A / A1 / A2）、ADR-0074 §5（Face 与 Runtime）、AGENTS.md
「独立交付是构建期属性，需要的是构建目标而不是源码树」。

## 1. 一句话：flavour 是两个生成物加一份身份，不是一个 dist

`tauri build --config <overlay>` 能改的是身份与产物形状（`productName`、`identifier`、
`build.frontendDist`、`bundle.*`、`app.windows`），改不动「这个 App 里有哪些节点」。那句话在 §9.5
之后有了具体的两半：

| 半边 | 生成物 | 谁写它 | 谁吃它 |
|---|---|---|---|
| 后端 | `crates/xiranite-scripted-nodes/src/registration.rs` | `scripts/embed-node-bundles.ts --print-registration --node` | 宿主 `built_in_registry()`，产品级证据是 `xiranite-dev-host` 自己打印的 `staging_summary` 行 |
| 前端 | 四份签入表，其中决定画面的是 `src/components/modules/packageModules.generated.ts` | `scripts/generate-node-registries.ts` 读 `XIRANITE_BUILD_ONLY_NODES` | `MODULE_REGISTRY` → 节点轨、模块库、仪表盘 |

只裁后端会产出一个「改名的全量 App」：Webview 从不问宿主有哪些节点，`MODULE_REGISTRY` 是
`[...PACKAGE_MODULES, 4 个壳模块]` 的静态展开，所以节点轨仍列 28 条，点开没有后端的那 27 条才在
operation 调用上失败。裁前端因此是**正确性**动作，不是省体积的动作——省多少见 §3。

## 2. 这批加的东西

- `scripts/lib/node-flavor-frontend.ts` — 四份表的快照 / 归还（按字节，摘要断言）、子集 env、
  从生成表里读「Webview 实际有几个节点」的对称比对，以及一个诊断入口。归还刻意不用
  `git checkout HEAD --`：这些表跟 `registration.rs` 一样是签入产物，别人可能正持有未提交内容。
- `scripts/build-node-flavor.ts --frontend` — 把前端半边接成同一条命令的一步（`[1b/4]`）：设
  `XIRANITE_BUILD_ONLY_NODES` + `XIRANITE_BUILD_OUT_DIR`、重生成、断言「要几个就是几个」，
  四份表连同 `registration.rs` 一起在 `finally` 里归还。env 留在 `process.env` 上是必需的而非偷懒：
  `tauri build` 会跑 `beforeBuildCommand`，那条链的第一环正是同一个生成器——不给它同一份 env，
  它会在 flavour 跑到一半时把全量表写回去。
- `vite.config.ts` 的 `build.outDir` 读 `XIRANITE_BUILD_OUT_DIR`（默认仍是 `dist`）。子集 bundle 落到
  `dist-flavors/<ids>`，与全量 `dist/` 并排而不是盖掉它；flavour overlay 的 `frontendDist` 指过去。
- `crates/xiranite-desktop/tauri.conf.classq.json` — 第一份 flavour 身份 overlay，用 `classq` 是因为它
  今天真能被后端注册（见 §5 的 sleept）。八处键的分工：`productName` 与 `identifier` 出包名与签名身份；
  `build.frontendDist` 指 `../../dist-flavors/classq`（**crate 相对**，写 `../dist` 会指到 `crates/dist`）；
  `bundle.active` 必须显式 `true`（基础配置是 `false`，关了它只打二进制、不报错也不出 `.app`）；
  `app.windows` 整块重述，因为 `--config` 是合并语义、数组到底是替换还是逐元素合并没实测过，而 macOS 那条
  `titleBarStyle: Overlay` + `trafficLightPosition{x:16,y:26}` 几何不能丢；`label` 保持 `"main"`——
  `capabilities/` 与 `src/backend/windowDragRegion.ts` 按这个 label 认主窗口。
  - ⚠️ **overlay 里塞不进解释**：`metadata` 这类自由键被配置 schema 直接拒
    （实测 `Error "tauri.conf.json" error: Additional properties are not allowed ('metadata' was unexpected)`，
    第一次真跑 `tauri build --config` 就撞上了）。所以这些理由只能住在本文，不能住在 JSON。
    顺带一条推论：仓里那份 `tauri.conf.selfcheck.json` 也带 `metadata` 键 ⇒ **它从来没真通过
    `tauri build --config` 跑过**，别把「它是诊断 flavor」当成「它可构建」。
- `--manifest <path>`（`build-node-flavor.ts` 转发给 `embed-node-bundles.ts` 已有的那个只读口）——让
  「策略还没命名完的节点」也能被拉到 flavour 的形状面前。它和 embed 侧那条守卫一样，只在
  `--print-registration` 这条读路径上成立，写路径仍拒；`--features engines:auto` 的 service 推导跟着读同一份
  覆盖后的文件，不留两个权威。
- 尺：`scripts/node-flavor-frontend.test.ts`（`bunx vitest run --config vitest.scripts.config.ts scripts/node-flavor-frontend.test.ts`，
  8 pass），已进 `vitest.scripts.config.ts` 的显式清单。

诊断入口（不需要 cargo、也不需要后端放行）：

```
bun scripts/lib/node-flavor-frontend.ts --node <id> [--build] [--out-dir <dir>]
bun scripts/build-node-flavor.ts --node <id> --frontend [--features engines:auto] [--config <overlay>] [--verify-host] [--dry-run]
```

## 3. 实测：裁掉 27 个节点界面只值 24.5%

同一台 mac arm64、同一份 `vite build`、同一个目录树遍历函数（按文件字节相加，不是 `du` 的块数）。

| 产物 | 文件数 | 字节 | 用时 |
|---|---|---|---|
| `dist/`（全量 28 节点） | 361 | 11.57 MB | 既有产物（本次未重建） |
| `dist-flavors/sleept` | 189 | 8.73 MB | 21.10 s |
| `dist-flavors/classq` | 190 | 8.80 MB | 18.12 s |

差 172 个文件、2.83 MB（−24.5%），`entry-*.js` 从 29 块变 1 块。事前从全量 `dist/` 反推的账是
「28 个 entry chunk 合计 2.05 MB = assets 的 21%」，事后实测比它小一点，因为全量构建里一部分节点代码
被并进了共享 chunk，裁表只裁掉入口闭包而不裁共享部分。地板是壳：单块最大的是
`FlowCanvasView` 2.15 MB，而它一行节点代码都不含。sleept 自己那片 entry 是 52.5 KB，全量里最贵的两块
是 kisaki 372 KB / findz 226 KB——正好是 §12 引擎档的那两个节点，前端的账和 Rust 的账在那儿不重叠。

结论写死在这里：**要「少一点下载」的人该裁的是壳，不是节点表**；裁节点表的理由是 §1 那句「不许有 27 个
打不开的入口」。

**判别串只能是 `entry-*` 的哈希名，不能是节点 id 字符串**（我自己先踩了一次）：拿
`["'](classq|findz|slept|…)["']` 去数两份产物，全量与 flavour 都命中 **26** 个别的节点 id，
差别为零；而 `entry-*` 唯一名是 29 → 1、资产数 353 → 182。原因是壳里硬编码着节点 id 的字符串集合
（`src/lib/hazardMode.ts` 那一组 19 个 id 是超集式的，裁表不裁它，也不该裁——它裁了不报错，只会静默少覆盖）。
所以「这个包里到底有几个节点界面」这句话，只能用 chunk 名回答。二进制侧同理：资源是压缩内嵌的，
明文 `rg -a` 查中文串或路径串会假阴性，能查的只有 chunk 名。

## 4. 两条分发出去才会撞上的事实

1. **数据根不跟 `identifier` 走。** `crates/xiranite-core/src/config_paths.rs` 的平台数据目录是
   `…/Xiranite` 这个硬编码字面量（`XIRANITE_DATA_DIR` → 平台根 + `Xiranite`），Tauri 的
   `app_data_dir()` 才吃 `identifier`。所以按现在的代码，Sleept.app 与 Xiranite.app 共用同一份
   `xiranite.toml`、同一个 DB、同一份保存的工作区。overlay 改 `identifier` 改不掉这一点。
   最小落点是宿主侧把 flavor 的数据根显式设成 `…/Xiranite/<flavor>`（由桌面壳在启动 `stage_from_environment()`
   之前按 `identifier` 派生），而不是往 `config_paths.rs` 里塞第二张名字表。
2. **工作区恢复是裁前端唯一的报错路径。** 保存的工作区按 moduleId 引用组件，
   `WorkspaceWindowRestorer` 会照单恢复；表被裁掉之后那条引用找不到 loader，
   才会走到 `ModuleRenderer` 的 "Module failed to load"。今天它不红，只因为没人裁过表。
   flavour 首启必须带一份干净工作区（或者按 flavour 分数据目录，即上一条），否则这是用户看到的第一个界面。

顺带一条小的：`crates/xiranite-desktop/src/tray.rs` 的主托盘 tooltip 是硬编码 `"Xiranite"`。

## 5. sleept 实测：两半都跑到了，只差一条没命名的程序名

**前端半边（真跑）**：`bun scripts/lib/node-flavor-frontend.ts --node sleept --build`
⇒ 表收成 1 个 loader，`vite build` 落 `dist-flavors/sleept`，189 个文件 / 8.73 MB / 21.10 s，
跑完四份签入表按字节归还并验摘要（体积账见 §3）。

**后端半边（表真生成出来了，走只读诊断口）**：`build-node-flavor.ts --manifest <path>` 把节点策略指到一份
仓库外的清单副本（与签入那份逐字相同，只去掉 sleept 的 `pendingProcessGrants` 一条），
`--node sleept --frontend --manifest … --dry-run` 的 `[1/4]` 当场过了，生成的表是：

```
SCRIPTED_NODE_IDS: &[&str] = &["sleept"];
JsNodeSpec::platform(NodeDescriptor::new("sleept", "0.1.0", 1)
  .with_processes(&[10 条 ProcessGrant：netstat / open / osascript / pmset / powershell.exe /
                    rundll32.exe / shutdown / systemctl / xscreensaver-command / xset，各带 confirm_before_run])
  .budget(16777216, 1).run_deadline_ms(86400000),
  include_str!("…/bundles/sleept.js"), "runSleept", "createNodeSleeptRuntime")
UNREGISTERED_BUNDLES: 24 条 "left out of this build by --node; the bundle is still embedded"
```

descriptor、预算、期限、bundle、注册对（`register_node!` 两支）全都齐了 —— sleept 作为 flavour 的形状是
完整的。签入那份清单没动，所以真构建仍然按下面这条规则拒它，诊断口不改事实。

**剩下的那一格**：分析器读不出电源命令表的字面量。`packages/nodes/sleept/src/platform.ts` 里
`runOrThrow(command.executable, command.args)`（`command = resolvePowerCommand(platform, mode)`，值来自三份
`as const` 表）是唯一的未命名站点；`programNameOfNode` 只认字符串字面量与同文件 `const` 字符串，成员访问一律
`unresolved`，而 `resolvedPrograms()` 的规则是 pending 非空即整体拒 ⇒ **一条未命名挡住十条已命名**。

出路只有一条，我上一版写的第二条已收回：

- **电源动作不再由节点 spawn。** 宿主侧已经能答（提交 `1eb3705d`，`crates/xiranite-core/src/power_session.rs`
  接 `display-sleep`/`screensaver`，执行器 `power_operations.rs` 一个入口两套词表），剩下的是节点侧那一刀：
  `platform.ts` 的 `executePowerAction` 改问 `power.request`、CPU/网速改问 `os` 服务，`external-process`
  这一级随之从分析产物里掉出去、`pendingProcessGrants` 归零、清单那十条程序名由 `--apply-host-requirements`
  自己算。完整机械清单与归属在 `docs/migration/sleept-host-lift-handoff.md`（另一条 lane 写的，
  含 `cli.ts` 四处直连与「必须同一笔」的理由：面侧传输按设计拒 `service.invoke`）。
- ~~让分析器多走一层认 `as const` 表的字面量~~ **撤回**：那条 lane 已判定这条 pending 是真的
  （那个 executable 确实是运行时算出来的），而「改名、加 switch 让分析器看见字面量」在他们台账里被明确写成
  **给门禁而不是给权限找理由**。我先前把它列为一条出路，是把我自己想做的那刀（改代码形状）当成了合法选项。

**这一格踩过的一次自误，记账版本**：我先把 `readClipboardText` 的 `for (const command of [["wl-paste"], …])`
拆成三条字面量调用，以为那叫「让调用点可证」。读完分析器的 wrapper pass 才知道那三条臂是**故意**被过滤的
（`node-feasibility.ts` 的剪贴板规则：剪贴板臂不算节点需求，否则一次 `xclip` 探测会让整个 helper 永久不可
命名），改动无收益还会让那条注释变成假话 ⇒ 决定还原。还原用了 `git checkout -- <该文件>` ——
**而那一次确实造成了损失**：`checkout --` 取的是索引里的旧 blob，把那条 lane 已提交到分支的
「`sleep` 走 `clock.sleep`」整份写回成 `setTimeout` 与模块作用域 `readCpuSample()` 的旧版（后者正是
`45762af1` 修掉的求值期读机器崩溃）。是他们发现的：把那份内容跑 `vitest` 得 `1 failed | 9 passed`，
再从分支 blob checkout 回来才复绿（台账 `sleept-host-lift-handoff.md` 的 02:34 一节）。盘上现在是对的
（285 行、`clock.sleep` 两处、与分支 blob 一致）。口径两条：**在飞文件一律先 `but diff` 判归属，默认
「按开跑读到的原始字节写回 + 断言摘要」，`git checkout --` 在这种树上不是无损操作**；
以及**别只看状态码形状**（同一时段 `power_session.rs` 在 `git diff HEAD` 里显示 −373，磁盘却与提交 blob
逐字节相同 —— `D`/`??` 索引簿记的盲区）。

**跑通了的那一步（2026-10-06 02:37，同一条命令真编真启）**：

```
bun scripts/build-node-flavor.ts --node sleept --frontend \
    --manifest <策略副本> --verify-host
[2/4] cargo build -p xiranite-builtin-host -j 1 … Finished `dev` profile in 18.09s
      （子集不是「跑了旧代码」：先 Compiling xiranite-scripted-nodes 才 Compiling xiranite-builtin-host）
[2b]  audit line confirms: nodes [dissolvef, kisaki, sleept]
[4/4] restored, digest verified: 61f54bcdc038 / frontend tables restored, digests verified: 4 file(s)
```

`dissolvef`/`kisaki` 是宿主一直手写链接的那两个（`scripts/lib/node-flavor-assert.ts` 的
`HAND_LINKED_NODE_IDS`），所以这三条就是「sleept + 那两个」——比对是双向的，多服务一个也算红。
跑完五份签入产物（`registration.rs` 与四份前端表）逐字节复位，另用仓库外的字节副本独立核过一遍 SAME。
构建前后取放 `.build-lock`，同一条命令内完成。

**仍然没跑的那一步**：`tauri build` 的打包层（`.app` / `Info.plist`），以及没有 `--config` 时那一步的打印。
它挡在 §12.7 第一条上——桌面层的 feature 转发还没接（`xiranite-desktop` 那条图 553 ⇒ 553），所以真打包一次
会把 czkawka 整条链拖进这个 flavour 的编译量里，此刻机上还有两条 cargo 链在跑。overlay 照
`tauri.conf.classq.json` 抄一份改四处即可。

## 6. 未验清单（不写成分号结尾的成就）

- `.app` 这一层**本批没重跑，但不是一个洞**：盘上已有四条 flavour 产物
  （`target/debug/bundle/macos/` 下 `Xiranite {Classq,Dissolvef,Findz,Basecheck}.app`，
  `plutil -p …/Info.plist` 里 `CFBundleIdentifier`/`CFBundleName` 逐个被覆盖成
  `app.xiranite.classq` 等），本批那份 `tauri.conf.classq.json` 用的身份与其中之一逐字相同，
  所以签名身份这条路是被那条 run 证过的（台账在 §9.6/§9.8 那条 lane）。
  没验的是「签入 overlay 文件 + `--frontend` 的子集 dist」这一组合的第一次跑：它挡在 §12.7 第一条上
  ——桌面层的 feature 转发还没接（`xiranite-desktop` 那张图 553 ⇒ 553），真打包一次会把 czkawka 整条链
  拖进这个 flavour 的编译量里。`bundle.active` 必须在 overlay 里显式开（基础配置是 `false`，
  关了它只打二进制、不报错）。
- `--config` 对 `app.windows` 这类数组到底是替换还是逐元素合并，没有实测，所以 overlay 用「整块重述」
  的写法在两种语义下都对；真跑一次打包时顺手读一眼窗口标题就能定。
- 子集树下的 `bun run typecheck` **跑了，结论是「不引入新错」**：同一把尺 `bunx tsgo -p tsconfig.app.json --noEmit`，
  全量树 101 条既存债（rc=1），sleept 子集树 97 条，按错误消息集（去掉行列号后 `comm`）算差集 ⇒
  **子集侧新增 0 条**，消失的 3 条正是生成物自己的 `TS2352`（enginev/findz 两条 entry 断言 + 一条 help 断言）。
  数条数会被这种「裁掉的文件顺带带走自己的错」骗，所以差集才算归属证据。
  跑完四份表按字节复原并核摘要。
- `audit:build-chunks` 没在子集产物上跑。按它的实现（要求 `entry-*.js` 保持 lazy）应当仍绿，但那是推理不是证据。

## 7. 明确不做

- 不把 MF2 当分发手段。仓里只有 `@module-federation/runtime`，**零个 remote 生产者**（没有
  `@module-federation/vite`／rolldown 构建插件），内置节点在运行期走的是普通 Vite chunk
  （`src/plugins/dynamicEntries.ts` 先查 bound remote、落回 `staticLoaders`）。MF2 开的是 route B，
  而 route B 的产物今天造不出来，ADR-0069 也已经写明它不许被当成体积优化。
- 不做逐节点 html 入口（A2），不写「给每个节点生成一份 conf」的生成器，也不给 overlay 塞一个选不了
  节点的空开关。
- 不让 flavour 盖 `dist/`。子集产物一律进 `dist-flavors/`（已进 `.gitignore`）。

## 8. 2026-10-06 追加：dissolvef 已进表，双拼写撞出的是一次真实的启动失败

> **本节代码改动的入库状态（写下来防止下一个人误判）**：改动在工作树，**未入库**。
> 这是一批互相依赖的改动，单独提交任何一半都会在干净检出里造成回归：只提我删手写那半边，
> 而 `crates/xiranite-scripted-nodes/src/registration.rs`（别人在途的重生成，`+32 −17` 相对分支 tip）
> 与根 `Cargo.toml` 的成员行（别人加了 `quickjs-realm`/`quickjs-host-protocol`）、
> `docs/xiranite-target-node-manifest.json`（别人在改 findz 那几行）不同时进去，
> 那个检出里 dissolvef 就谁都不服务了。快照与判据在
> `/Users/glow/_snapshots/xiranite-dissolvef-table-migration/`（`tree/` + `tip-shas.txt` + `digests.txt`，
> 被删的 `src/dissolvef.rs` 另存了一份）。等那三个文件腾开，这一批应当整笔提交。

上一版 §5 写「`--node dissolvef` 需要策略副本才能出表」，那是我把签入的 `registration.rs` 当成静态事实读的结果。
现读它已含 `dissolvef`（同一批重生成还带进了 `sleept`），于是宿主一侧变成**同一个 id 注册两次**：
`built_in_registry()` 把 `DISSOLVEF_DESCRIPTOR` 与生成表并排喂给 `NodeRegistry::from_registrations`，
后者按 `DuplicateId` 拒 ⇒ `xiranite-dev-host: two built-in nodes register id "dissolvef"`、exit 78。
**这不是 flavour 专属问题，是产品宿主在此刻的工作树上根本起不来**；`--verify-host` 第一次撞出它，
而它同时说明我那条尺的期望值（`HAND_LINKED_NODE_IDS` 抄了一份手写清单）在替这次冲突打掩护。

做完的那一刀（等价性先证后删）：

| 动作 | 落点 |
|---|---|
| 上限进清单 | `docs/xiranite-target-node-manifest.json` dissolvef 行 `maxLiveBytes: 16777216`，证据行同时指向 `crates/nodes/dissolvef/manifest.toml memory_max_pages 256 × 64 KiB` 与正要退场的手写 `.budget(16_777_216, 1)` |
| 手写那份退场 | 删 `crates/xiranite-builtin-host/src/dissolvef.rs`；`lib.rs` 去掉 `mod`/`pub use`/两处 chain 元素；`build.rs` 的 `NODE_BUNDLES` 只剩 `["kisaki"]`，注释写明「在这里的节点就是表还拼不出来的节点」 |
| 原生那份退场 | 删 `crates/nodes/dissolvef/`（Cargo.toml + manifest.toml + src + `tests/native_parity.rs`），根 `Cargo.toml` 成员同步摘掉；实测全仓再无 `dissolvef::` 引用 ⇒ 编译面安全 |
| 尺 | `crates/xiranite-builtin-host/tests/operations.rs` 与 `crates/xiranite-loopback-host/tests/staged_nodes_come_from_the_generated_table.rs` 的手写名单改成 `["kisaki"]`；新增一条**跨语言对照**：`scripts/node-flavor-assert.test.ts` 读 `build.rs` 的数组字面量与 `HAND_LINKED_NODE_IDS` 求差集 |

删之前的等价性不是推理：把生成行与手写行按字段拉平比过 ——
descriptor `("dissolvef","0.1.0",1)`、roots `[workspace ReadWrite]`、`walk_tree(true)`、`budget` 两侧同值
（唯一「差」是 Rust 的 `16_777_216` 下划线分隔，数值一致）、services 与 programs 两侧都为空、
入口名 `runDissolvef`/`createNodeDissolvefRuntime` 一致。

验证（本机 macOS，`-j 1` + sccache，负载 17–23）：`cargo test -p xiranite-builtin-host` 4/4
（含 `a_nested_dissolve_moves_the_file_and_an_unganted_path_is_refused` 与
`collect_archives_runs_the_bundled_node_over_the_http_routes` —— dissolvef 真在表这条路上跑）；
`cargo test -p xiranite-loopback-host` 11+4+6+3 全绿；`cargo clippy -p xiranite-builtin-host
--all-targets --no-deps -j 1 -- -D warnings` rc=0 且零 warning；
`bun scripts/build-node-flavor.ts --node classq --verify-host` **rc=0**、
宿主自报 `nodes [classq, kisaki]`（改这一刀之前它报 `[classq, dissolvef, kisaki]` 并把 `--node dissolvef`
撞死在 78）；`--node dissolvef --verify-host` rc=0、`nodes [dissolvef, kisaki]`；
`bun run audit:node-registry` 的那条 FAIL 从「dissolvef 与 linedup 两条 BOTH」变成只剩 **linedup** 一条
（`crates/nodes/linedup` 与脚本表同时服务，pre-existing，不在这格处理）。
减法跑：把 `build.rs` 的数组改回含 `dissolvef` ⇒ 恰好新加那条跨语言对照红
（`the hand-linked list matches what build.rs actually stages`），还原后 7 pass、探针零残留。

**kisaki 不动，是因为它需要两个决定而不是一个编辑。** 把手写那份的等价物填进清单
（`maxLiveBytes = 33554432`，出处就是它自己 `.budget(33_554_432, 1)`，其注释还写着「这个数没在大目录上量过」），
表**仍然拒**，理由是：

> `platform node whose grants name nothing yet — os-native: @xiranite/czkawka-native, @xiranite/file-operations;
> external-process: proc.exec(program) unresolved: runOrThrow is called at
> packages/nodes/kisaki/src/platform.ts:224 with platform === "darwin" ? "open" : "xdg-open"
> | manifest call sites awaiting a name: program at packages/nodes/kisaki/src/platform.ts:228`

两条决定跟着来：

1. **进表会放宽权限。** 清单已登记 `programs = [explorer.exe, rundll32.exe]`，而手写描述符
   `src/kisaki.rs` 刻意**不声明任何进程**，理由写在它自己的文档注释里：`openKisakiPath` 与视频优化那几条腿
   还没接到宿主服务上，「在这里加白名单等于白白放宽策略」。表按清单发，于是它会把那两个程序发出去。
   要么把这两条从清单里撤掉以匹配今天真正执行的策略，要么承认这些动作可达并把 `open`/`xdg-open`
   一起补齐（现在只登记了 Windows 侧，mac/Linux 侧反而没登记，这本身就不自洽）。
2. **`os-native` 那条证据指向的是包名而不是服务名**（`@xiranite/czkawka-native`、`@xiranite/file-operations`），
   而 deriver 已经能给 kisaki 产出 `services: ["czkawka"]`（`artifacts/node-scripted-requirements.json`），
   手写那份也是 `.with_services(&["czkawka"])` —— 两边一致，卡在 `needs-named-grants` 这个状态把
   整行拦下来。这一条属于分析器/deriver 的词表接线，不是这格能顺手改的。

所以现在的状态是：**dissolvef 已经是表驱动的单份实现，flavour 起得来；kisaki 仍手写链接，
是唯一一处「手写 + 表」以外的第二拼写**，`HAND_LINKED_NODE_IDS = ["kisaki"]` 与新增的对照尺把它钉在明处。
在它退场之前，任何「只带一个节点」的包实际上都还会带着 kisaki（含它拖着的 czkawka 引擎，见 §12 那本账）。

### 8.1 用户 2026-10-06 拍的口径与那一刀之后的实测

**决定**：`programs` 撤（进表零放宽）；这批代码**不拆开提交**，等占着的三个文件腾开整笔进去。
执行与后果：

- `docs/xiranite-target-node-manifest.json` 的 kisaki 行 `programs` 清空，证据行写明这两条**从未生效过**
  （唯一在服务 kisaki 的描述符是 `src/kisaki.rs`，它刻意不声明进程），因此撤回动作对运行行为是零变化；
  等 reveal 接到宿主臂或调用点可被分析器命名时再放回。相对 03:37 快照，这次只动了 `dissolvef`、`kisaki` 两行。
- 撤名字**不解除** kisaki 的表拒绝，理由照旧两条，都写进了它的 `UNREGISTERED_BUNDLES` 文案：
  `proc.exec(program)` 那条三元站点（`platform === "darwin" ? "open" : "xdg-open"`），以及
  `os-native` 证据点名的是包（`@xiranite/czkawka-native`、`@xiranite/file-operations`）而不是服务名，
  deriver 却已经能产出 `services: ["czkawka"]` —— 换句话说还差「reveal 搬进宿主」或「分析器能把这两条说圆」。

**一次真实的中途覆盖，值得记成方法账**：我在 03:25 写进 dissolvef 行的 `maxLiveBytes`，
在 03:32:54 被另一条 lane 写这份清单时**整份抹掉**（我的证据行一起没了），而她随后按没有上限的清单
重生成 `registration.rs` ⇒ 于是「手写那半边我已删、表那半边被冲掉」合成一个真实的坏状态：
`cargo test -p xiranite-builtin-host` 两条 dissolvef 测红，红因是
`node "dissolvef" is not linked into this host`。这不是删除动作的错，是**共享签入产物被 last-writer-wins
覆盖**的后果，而且它无声：清单和表各绿，合起来没人服务这个节点。
03:39 用行内作用域的写法把上限重新落进去（只动那一行），再用只读生产口
`embed-node-bundles.ts --print-registration > registration.rs` 刷新表（不碰 `bundles/`；
`bundles/index.json` mtime 停在 03:32:54、`dissolvef.js` 停在 03:03:09，可证没被顺手重打）。

复跑后的全绿：`cargo test -p xiranite-builtin-host` 4/4（rc=0）、
`cargo test -p xiranite-loopback-host` 11+4+6+3 = 24 全过（rc=0）、
`bun run audit:node-bundles` rc=0 且没有 staleness 臂、`bun run audit:target-node-manifest` OK（51 records /
28 retained）、`bun test scripts/node-flavor-assert.test.ts` 7 pass、
`bun test scripts/build-node-flavor.test.ts` 12 pass、
`--node dissolvef --verify-host` rc=0 且宿主自报 `nodes [dissolvef, kisaki]`，跑完 `restored, digest verified`。

一条应当被接住的后续（这格没做）：**清单与表之间的这类「各绿合起来坏」缺一道尺**。
`audit:node-bundles` 只比「表 vs 它自己现算的结果」，所以表一旦被按旧清单重生成，它就一致；
真正该断言的是「凡 `disposition: retain-rewrite` 且分析器已给结论的节点，若它落在
`UNREGISTERED_BUNDLES`，签名产物里必须能看到那条理由」——现在这条只在人肉读拒绝文案时才成立。

## 9. 这格留下的一条方法账

测「归还机制」的那个反证跑本身是破坏性的：为了证 `restoreFrontendArtifacts` 有牙，把它内部那行
writeFile 注释掉，结果测试仍然「通过了对断言的失败」，而三份表留在了子集态——因为唯一的归还路径正是
被弄坏的那个函数。修法落在两处：测试自己先在内存里留一份字节副本并在 `finally` 里独立兜底；
任何改还原机制的反证跑，动手前先在仓库外存原始字节（本次是 `../_flavor-safety/`）。
