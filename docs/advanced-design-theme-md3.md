# 高级主题（设计语言）与 Material 3 第一份配方

状态：实现中（2026-10-05 立项）。落点：React GUI（`src/`），不进节点包、不进 Rust 宿主。

## 1. 这是什么：与颜色主题平级的第二个维度

| 维度 | 现有「颜色主题」 | 新增「高级主题 / 设计语言」 |
| --- | --- | --- |
| 词表 | `AppTheme`（17 预设）+ `themes.json` 自定义 | `AppDesignThemeId = "native" \| "md3"` |
| 管的东西 | 一套 CSS 变量的取值 | 整套设计语言：颜色角色 + 形状 + 层级 + 排版 + 动效 + 状态层 + **逐组件几何 metric** |
| 类型 | `src/types/workspace.ts` | `src/lib/design-theme/contract.ts` |
| 落盘 | `src/lib/appearance.ts`（class + inline 变量） | `src/lib/design-theme/apply.ts`（inline 变量 + 根属性） |

**注意重名**：`src/lib/appearance.ts:59` 已有一个 `ThemeDesignRecipe`，那是「颜色主题自带的 store 级外观旋钮」（fontPreset / 背景 / 颗粒 / chrome 位置…），与本维度的 `DesignThemeConfig` 无关。两个词并存是历史事实，改名不属于本任务范围，引用时按类型名区分。

用户 2026-10-05 的两条裁定，写在这里当作决策记录：

1. **MD3 默认接管颜色**（「他不接管很难做吧」）——所以 `dimensions.color` 默认 `on`。维度开关是逃生阀：想让几何换掉但颜色跟着原主题走，把 color 关掉即可。
2. 其余按推荐默认：装 `@material/material-color-utilities`；外观走 CSS 层不重写组件；第一批只做 Tier-1 表面；持久化进 host TOML；只落 MD3 一个，但注册表是数据驱动的。

## 2. 事实源（没有一个数字来自记忆）

| 用途 | 来源 | 取证 |
| --- | --- | --- |
| 非颜色 token + 77 套组件 metric | `@material/web@2.5.0` 里 Google 自己生成的字典 `tokens/versions/v0_192/_md-*.scss`，文件头写明 `Design system display name: Google Material 3 / Design system version: v0.192 / Platform: Web`，Apache-2.0 | 解析成 `md3/tokens.generated.ts`，`bun run audit:md3-tokens` 查漂移 |
| 层级阴影配方 | 同包 `labs/gb/styles/elevation/md-elevation-tokens.scss`（v0_192 的 `md-sys-elevation` 只有 dp 数字 0/1/3/6/8/12，CSS 可用的两层 box-shadow 在这份生成物里） | 直接解析，不改写 |
| 间距阶梯 | 同包 `labs/gb/styles/space/md-space-tokens.scss`（`--md-sys-space-unit: 8px` + 0…900） | 同上 |
| 动态取色 | `@material/material-color-utilities@0.4.0`（Apache-2.0）的 `DynamicScheme` / `Variant` / `MaterialDynamicColors` | 实测：`Variant` 9 个枚举、构造参数含 `contrastLevel(-1…1)`、角色表含 `surfaceContainer{Lowest,Low,High,Highest}`/`surfaceBright`/`surfaceDim`/`outlineVariant`/`scrim` |
| 体积 | 同上，esbuild bundle+minify 实测 | 只要 scheme 角色 **88.4 KB raw / 20.3 KB gz**；加上图片取色链（quantize+score+temperature）**102.9 KB / 24.4 KB gz** |

一条被机器值纠正的常见错误：**状态层不透明度**。规范表里是 hover `0.08`、focus `0.12`、pressed `0.12`、dragged `0.16`；网上大量教程把 focus 写成 10%，照抄就会错。因此本功能的数值一律从生成物读，不从文档读。

`@material/web` 只作为 **devDependency**（`2.5.0`，codegen 的输入；`bun install --frozen-lockfile` 实测 package.json↔lock 一致），运行时代码不 import 它，Lit 也不进产物；真正的运行时依赖只有 MCU。生成器读的是 `node_modules/@material/web/tokens/versions/v0_192/`，所以这份声明缺了 `audit:md3-tokens` 在干净检出上必红——这一条是被「提交了引用没提交被引用者」的旧坑逼出来的，不是多余的保险。

**组件 token 不发全表**：字典里有 3160 条 `--md-comp-*`，全发就是往 `:root` 上挂三千多个 inline 变量。引擎只发 CSS 层真引用到的那部分，且门禁双向查：引用而未发＝红，发了而无人引用＝红。

## 3. Token 管道

```
seed（手动 / 当前主题 --primary / 系统强调色 AccentColor）
   → MCU DynamicScheme(variant, contrastLevel, isDark)
   → M3 颜色角色（light 与 dark 同一 seed 各算一份，不是取反）
   → --md-sys-color-*
                                    Google 生成字典 → --md-sys-shape-* / --md-sys-elevation-* / --md-sys-typescale-* / --md-sys-motion-* / --md-sys-state-* / --md-sys-space-* / --md-comp-<set>-<token>
                                        ↓
                            桥接：BRIDGED_COLOR_VARS（shadcn + --ws-* + --chart-* + --sidebar-*，36 条）
                                        ↓
                     :root inline 变量 + data-app-design / data-design-<dim>
                                        ↓
              src/styles/design/md3-components.css → [data-slot] 组件
```

三条实现约束，都写在代码注释里：

- **顺序是语义**。颜色主题与高级主题都往 `documentElement.style` 写同名变量，后写赢。两件事在同一个组件 `WorkspaceAppearance` 里按 effect 声明顺序串联（不是两个兄弟组件靠挂载顺序赌），并由它提供 `restoreAppearance` 回调：高级主题撤走自己那批变量后，自定义主题的 inline 值必须原地重写回来（inline 被覆盖就没有旧值可回）。
- **优先级：组件皮肤 > 高级主题**。用户 2026-10-05 明确定这条。落地方式不是玩层叠花招，而是**让位**：`scripts/md3-yield-to-skins.ts` 从 `src/index.css` 现读每个皮肤族（tabs / switch / slider / scrollbar / choice-control / field-title）声明过的 `(data-slot, 属性)` 组合（含 `background`→`background-color` 这类简写展开），把 MD3 层里撞上这些组合的声明整条摘掉。结果：MD3 不再给 tabs / segmented / slider / 滚动条 / 字段标题 / switch 上色或改形，**switch 的尺寸与圆角保留**（皮肤没声明 width/height，那不算冲突）。事后 `src/styles/design/skinPriority.test.ts` 做**结构**判据（不靠数值巧合）：MD3 层里任何声明了皮肤拥有 `(slot,属性)` 的规则即红，伪元素状态层除外，并带一条「植入冲突必须被抓到」的证伪夹具。
- **一次性改写必须用解析器**。我先用正则按逗号切选择器，把 `:has([a],[b])` 切碎，产出坏 CSS，直到 Tailwind 插件报 `Missing opening (` 才发现——退回提交版后改用 postcss AST 重做。归属表在两处解析（脚本与门禁），所以门禁里也测了「逗号在括号内不切」。
- **一处未解的 harness 疑点**（记录以免下次重复调查）：在 Vitest 浏览器页里 `src/index.css` 的 `:root[data-tabs-style="boxed"] [data-slot="tabs-trigger"]` 规则**确实在 CSSOM 中**（扫到 21 条皮肤规则），但对该元素 `matches()` 为 false、`querySelector` 也取不到它；把 `data-app-design` 整个摘掉也不影响（说明皮肤规则在此页不生效，而不是被 MD3 盖住）。因此那两个运行时判据写成「开/关 MD3 值必须一致 + 同测内正控」，而不是「等于皮肤值」。真机里皮肤是否照常工作**未在浏览器测试里证明**，要下结论得在产品页里量。
- **回读路径**。`data-design-rev` / `data-design-applied-vars` / `data-md3-seed` / `data-md3-seed-source` / `data-md3-seed-fallback` 是 DOM 上可对质的证据；设置页里的 SOURCE/VARS/SEED 三行是读这些属性渲染的，不是读 store。「代码跑过了」与「画面上真的换了」由此分开。
- **取色不许静默回落**。`domColor.ts` 用 1×1 canvas 把任意 CSS 颜色（`oklch()`、`color-mix()`、系统色关键字）读成 `#rrggbb`，并且先打哨兵色：写完后像素没变 = 本机根本解析不出这个颜色 → 返回 `null`。系统强调色读不到时界面明说「当前平台不可用」，同时把实际用的 seed 与 fallback 标记显示出来。
- **层级与 `!important` 的反直觉**。本层的表不进任何 `@layer`（普通声明下「无层」优先于任何层，才能盖过 Tailwind 工具类）；但**加 `!important` 之后层的顺序会反转**，无层的 `!important` 反而**弱于** Tailwind `!` 前缀工具类（那些落在 `@layer utilities` 里）——这条是浏览器探针实测出来的（`!w-8` 顶住了 32px），不是背规范。所以凡是要压过组件自带 `!` 工具类的地方（switch 的轨道尺寸、selection 的 toggle 变体、折叠态 sidebar 按钮），必须写在文件末尾的 `@layer utilities { … }` 块里；而 `src/index.css` 里那些皮肤块（`:root[data-tabs-style=…]` 等）**不是要靠更高特异性去压的目标**——见上一条「组件皮肤 > 高级主题」，MD3 层在那些 `(槽, 属性)` 上根本不该有声明。
- **一份 CSS 装不下就拆**。组件几何层拆成 `md3-components.css`（852 行）+ `md3-components-selection.css`（737 行），由前者 `@import` 后者；`@import` 出现在第一份文件的首条规则之前才合法，仓库的 1000 行上限也不允许再往单文件里堆。


## 4. 变量命名沿用 Google 的名字

`--md-sys-shape-corner-medium`、`--md-comp-filled-button-container-height`、`--md-sys-typescale-label-large-size`…… 保留上游拼写，是为了让「这个值来自规范哪一条」可以全文搜索，也便于 `audit:md3-tokens` 与 token 消费门禁做差集。CSS 层**不允许**给这些变量写 fallback 值：变量缺失必须表现为看得见的坏掉，而不是悄悄落在一个近似值上。

一处有意的偏离：**字体族不跟随 M3**。规范写 Roboto Flex，本仓不分发该字体，因此 `--md-ref-typeface-brand` 绑到既有的 `--font-app-sans`（字体仍由用户的 font preset 决定），字号/行高/字重/字距照规范走。

## 5. 范围

**做**：Tier-1 表面（外壳 chrome、设置页、基础控件、节点卡内部）；7 个维度各自的开关；9 个 scheme variant；4 档对比度；形状缩放。

**这轮明确不做**（不是「以后再说」的含糊话，是留在这份清单上的欠账）：

- **ripple 等需要动组件行为的交互**。本轮全部是外观层；ripple 要改事件与 DOM 结构，单独评估，界面上也就没有那个开关。
- **图片/壁纸取色**。MCU 的 `sourceColorFromImage(HTMLImageElement)` 可用，但要接 canvas 解码与文件选择，列为第二批；`Md3SeedSource` 里因此**不含** `"image"` 值——类型里不许出现没人实现的枚举。
- **Tier-2 专有件**（chart / kanban / file-tree / timeline / dockview / grid-pattern 这类自带绘制的组件）。
- **每节点独立 GUI**。MD3 通过统一 GUI 自动覆盖所有节点面；独立分发是构建期属性，见 ADR-0069 §Standalone，两条 route 都已记录且不许写生成器、不许塞回空开关。
- 系统强调色的**跨平台支持矩阵**没有权威结论：本仓只在运行时实测（见上），不为某个 webview 版本背书。

## 6. 验证

```bash
bun run gen:md3-tokens              # 重新生成 token 表
bun run audit:md3-tokens            # 漂移门禁（生成物 vs 安装包内字典）
bun run audit:design-theme-tokens    # 引擎 emit 的变量 vs CSS 层引用的变量差集
bun test scripts/gen-md3-tokens.test.ts
bun run test:browser -- src/styles/design/md3-components.browser.test.tsx
bunx tsc -p tsconfig.app.json --noEmit   # 根 tsconfig 是 files:[]+references，那条 CI 命令不跟引用，量不出东西
bun run check:source-size
```

按本仓纪律，以上重任务**严格串行**，前一进程退出后再起下一个。

## 7. 这轮被尺抓到的东西（留档，因为它们都会复发）

1. **`@material/web` 只被手工拷进 `node_modules`、没进 package.json**——生成器读的是安装目录，干净检出上 `audit:md3-tokens` 必红，而本地全绿。锁条目在仓库外的 worktree 生成后搬回，并核过「新锁的 packages 段是旧锁的超集」（removed keys = 0），不是靠肉眼看 diff 行数。
2. **CSS 层自创了 token 短名**：`--md-sys-state-hover-opacity`（上游是 `…-hover-state-layer-opacity`）与零填充的 `--md-sys-space-050`（上游是 `…-space-50`）。共 111 处引用按上游真名改掉，测试夹具同步——夹具里当时两种拼写都给了，正好把这种「两边都供着，谁也发现不了」的假绿暴露出来。
3. **层叠注释写反了**：part 1 写着「无层 `!important` 仍然赢」，与实测相反（见 §3）。注释也是一种会腐烂的产物，它错的时候比代码错更难被发现。
4. **两个数值档位的归一化不一致**：`shapeScale` 吸附到合法档，`contrastLevel` 却是「不认识就回默认」。是自己写的对照测试把它撞出来的，现统一为吸附；字符串枚举（variant）没有「最近」可言，仍回默认。
5. **组件 token 不该发全表**：字典 3160 条，CSS 层真引用的是 29 个集/133 条。全发＝往 `:root` 挂三千多个 inline 变量。双向门禁因此不是洁癖。
6. **i18n 的两个形状坑**：`dims` 必须是 `{color:{label,description}}`，不是 `colorDescription` 平铺；`contrastLevel` 不能直接当 key——`contrasts.0.5` 会被 i18next 当成两级嵌套路径，所以走 `reduced/standard/medium/high` 这层 slug。
7. **间距档位的来源不是稳定字典**：`md-sys-space` 组在 v0_192 里不存在，只有 `labs/gb/styles/space/` 那份 CSS 形态的表。`space.test.ts` 不比较「看起来对」，而是逐条与上游声明**整串相等**，并带一条只应报出 400 档的证伪夹具。

