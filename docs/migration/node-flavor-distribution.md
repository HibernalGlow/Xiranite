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
  今天真能被后端注册（见 §5 的 sleept）。文件里三段 `metadata` 说明每个键为什么在那儿。
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

两条出路，这一格不替用户拍：

- 让分析器多走一层：`X.executable` 且 `X` 绑到本文件的 `as const` 记录 ⇒ 收那张表的字面量集、记
  `via: "table"`。落点 `packages/tauri-migrate/src/node-feasibility.ts`（此刻 `MM`，别的 lane 在改）。
  这也是那 17 个跑 `pbpaste`/`wl-paste`/`xclip`/`xsel` 的节点共同的病根。
- 或者按既有终局把剪贴板探测收回宿主的 `clipboard` 服务（见「剪贴板程序白名单差集」那条账），未命名站点随
  那条腿一起消失，而不是给全仓补 51 条程序名。

**这一格踩过的一次自误，记下来**：我先把 `readClipboardText` 的 `for (const command of [["wl-paste"], …])`
拆成三条字面量调用，以为那叫「让调用点可证」。读完分析器的 wrapper pass 才知道那三条臂是**故意**被过滤的
（`node-feasibility.ts` 的注释原点名了这个循环：剪贴板臂不算节点需求，否则一次 `xclip` 探测会让整个 helper
永久不可命名），改动无收益还会让那条注释变成假话 ⇒ 已还原。还原用的是 `git checkout --`，而该文件当时正被
另一条 lane 写（盘上现在就是他们在我 checkout 之后写入的版本），所以那几秒里他们的未提交内容有一次被覆盖的
风险窗口——我没留下任何改动，但**下次动在飞的文件先 `but diff`，不许 `git checkout --`**。

**没跑的那一步**：`cargo build -p xiranite-builtin-host` 的真实编译与 `--verify-host`。当时机器上有两条
cargo 链在跑（`xiranite-node-runtime` 测试、`xiranite-core`/`executor` 的测试与 clippy 链），load 23、内存
free 31%，按 AGENTS.md 的重任务串行规矩排在它们之后，不在这一格抢。命令形状已经定死：

```
bun scripts/build-node-flavor.ts --node sleept --frontend --manifest <副本路径> --verify-host
```

管路本身由 `classq` 那条证过（`--node classq --frontend --skip-build` 实跑：`[1/4]` 出 1 个 id、
`[1b/4]` 出 `classq` 一节点表并指向 `dist-flavors/classq`、`[4/4]` 五份产物全部摘要复位），
编译层则是 §9.5/§9.8 的既有证据。

## 6. 未验清单（不写成分号结尾的成就）

- `.app` 与 `Info.plist` 这一层本批没跑：`--config` overlay 真打包一次要编 `xiranite-desktop`，而
  §12.7 的桌面层 feature 转发还没接上（`553 ⇒ 553`），意味着这一跑会把 czkawka 整条链拖进 flavour 的
  编译量里；同机上此刻还有别的 cargo 在飞。
- `--config` 对 `app.windows` 这类数组到底是替换还是逐元素合并，没有实测，所以 overlay 用「整块重述」
  的写法在两种语义下都对；真跑一次打包时顺手读一眼窗口标题就能定。
- 子集树下的 `bun run typecheck` 与 `audit:build-chunks` 没跑。后者按它的实现（要求 `entry-*.js` 保持
  lazy）应当仍然绿，但那是推理不是证据。

## 7. 明确不做

- 不把 MF2 当分发手段。仓里只有 `@module-federation/runtime`，**零个 remote 生产者**（没有
  `@module-federation/vite`／rolldown 构建插件），内置节点在运行期走的是普通 Vite chunk
  （`src/plugins/dynamicEntries.ts` 先查 bound remote、落回 `staticLoaders`）。MF2 开的是 route B，
  而 route B 的产物今天造不出来，ADR-0069 也已经写明它不许被当成体积优化。
- 不做逐节点 html 入口（A2），不写「给每个节点生成一份 conf」的生成器，也不给 overlay 塞一个选不了
  节点的空开关。
- 不让 flavour 盖 `dist/`。子集产物一律进 `dist-flavors/`（已进 `.gitignore`）。

## 8. 这格留下的一条方法账

测「归还机制」的那个反证跑本身是破坏性的：为了证 `restoreFrontendArtifacts` 有牙，把它内部那行
writeFile 注释掉，结果测试仍然「通过了对断言的失败」，而三份表留在了子集态——因为唯一的归还路径正是
被弄坏的那个函数。修法落在两处：测试自己先在内存里留一份字节副本并在 `finally` 里独立兜底；
任何改还原机制的反证跑，动手前先在仓库外存原始字节（本次是 `../_flavor-safety/`）。
