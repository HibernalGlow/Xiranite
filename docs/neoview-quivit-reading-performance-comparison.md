# NeoView 与 QuiviT 阅读性能差异调研

> 结论基于两侧源码逐行比对，**未在本机实测**。文末给出分段计时的验证方案；
> 任何常量调整前应先在真实 CBZ 上取到分段数据。

调研对象：<https://github.com/4163/quivi-t>（Tauri 2 + Vanilla JS 的图像/漫画阅读器）。

## 结论摘要

两边都是 WebView2，所以差异不在渲染引擎，而在三件事：

1. **翻页瞬间"已经热的是什么"**——QuiviT 稳态下 ±7 页全部解码常驻；NeoView 默认只保留 1 页，
   而且预取闸门在每次输入后复位。这是量级差距的主因。
2. **归档字节的搬运路径**——QuiviT 走进程内自定义协议 + 内存字节缓存；NeoView 走回环 HTTP，
   且 CBZ 条目会先落成临时文件再读回。
3. **翻页时主线程要做的额外工作**——QuiviT 复用固定的 2 个 `<img>` 节点；NeoView 每翻一页
   都新建 React 元素、重算几何、重新光栅。

## 一、翻页瞬间的预热窗口（主因）

| | quivi-t | neoview |
|---|---|---|
| 预取半径 | `PRELOAD_HALF = 7`（±7 页） | `browser_predecode_pages` 默认 **1**，上限 4 |
| 并发 | 串行：目标页 `decode()` 完成后才开始预取 | `MAX_CONCURRENT_PREDECODES = 1` |
| 起始时机 | 当前页激活后 `100 + index * 45` ms | 闸门放行后再等 `350` ms |
| 输入期行为 | 持续预取 | 每次 `keydown`/`wheel`/`pointerdown` **闸门复位** |

证据：

- QuiviT `src/js/viewer/viewerRender.js`：`PRELOAD_HALF = 7`、`POOL_SIZE = 2`、
  `TARGET_LOAD_DEBOUNCE_MS = 45`。`_schedulePoolPreloads(neighborSrcs, generation)` 在目标页
  `decode()` 的 `.then()` 里被调用，定时器为 `100 + index * 45`，每个邻居 `new Image()` + `decode()`。
  即每次翻页后约 400 ms 内 ±7 页全部进入 WebView2 的解码缓存。
- NeoView `packages/nodes/neoview/src/application/config/ReaderRuntimeConfigModels.ts:923`
  → `DEFAULT_NEOVIEW_PRELOAD_CONFIG = { browserPredecodeEnabled: true, browserPredecodePages: 1 }`。
- `src/nodes/neoview/features/reader/useReaderImagePreloader.ts:6-10`
  → `MAX_CONFIGURABLE_PREDECODED_IMAGES = 4`、`DEFAULT_PREDECODED_IMAGES = 1`、
  `MAX_PREDECODED_PIXELS = 60_000_000`、`MAX_CONCURRENT_PREDECODES = 1`、
  `PREDECODE_START_DELAY_MS = 350`。
- `src/nodes/neoview/features/reader/useReaderSpeculativePreloadGate.ts:3-4`
  → `INITIAL_QUIET_WINDOW_MS = 1000`、`NAVIGATION_QUIET_WINDOW_MS = 280`；第 89-92 行在
  `pointerdown`/`keydown`/`wheel` 上把 admission 置为 `false`，并在 280 ms 静默后再走
  `requestIdleCallback` + `isInputPending` 检查。
- `src/nodes/neoview/app/ReaderApp.tsx:560` 传 `stableForMs: speculativePreloadAllowed ? 1_000 : 0`；
  `ReaderApp.tsx:932-936` 把 `speculativePreloadAllowed` 串进 `useReaderAdjacentPagePreloader` 的
  `enabled`；而 `PreloadCoordinator.ts:171-174` 在 `stableForMs < 120` 时返回
  `admission: "paused"`，预加载器随即调用 `cancel()`。

**要点：闸门与需求反相关。** 预取最有价值的时候正是快速连翻，而那时它被暂停。
`PreloadCoordinator` 其实已经实现了 `near`/`ahead`/`background` 三档、方向推断、
`speed >= 1.5` 时退化为 `reduced` 的完整预算模型（`PreloadCoordinator.ts:163-179`），
但这套规划在浏览器侧闸门处被整体丢弃了。

另外 `admitPredecodePages`（`useReaderImagePreloader.ts:189-205`）按**页数**截断，
所以即使规划给出 near + ahead + background 四页候选，默认配置下只有第一页真的被预解码。

## 二、归档字节的搬运路径

| | quivi-t | neoview |
|---|---|---|
| 传输 | `quivit://` 自定义协议，Rust 进程内处理 | 回环 HTTP `127.0.0.1` → Bun 本地后端 |
| ZIP/CBZ 字节 | 内存字节缓存，默认 **512 MB** 预算 + 后台预取队列 | `materializeArchiveEntry` 落 `mkdtemp(tmpdir())` 临时文件 |
| 归档工作集 | 2 归档滑动窗口 | 7z 有 `SolidArchiveCache`（内存档默认 32 MB / 单条 8 MB） |

- NeoView `packages/nodes/neoview/src/platform/archives/materialize-entry.ts:1-5` 引入
  `mkdtemp`/`tmpdir`，第 48-49 行建临时目录与文件句柄。CBZ 每页因此多两趟磁盘往返。
- NeoView 静态资源头本身没问题：`ReaderAssetRoute.ts:381` 已是
  `private, max-age=31536000, immutable` + ETag + `accept-ranges`，这段不是瓶颈。
- 回环 HTTP + CORS（`crossOrigin="anonymous"`）相对进程内协议是小头，属次要项。

## 三、翻页时主线程的额外工作

- **DOM 复用**：QuiviT `POOL_SIZE = 2` 的 `<img>` 只创建一次，`_getPoolNode`/`_recyclePoolNode`
  只换 `src`，永不增删。NeoView `PageImage.tsx:177-220` 的 `<img key={identity}>` 每页都是新元素，
  旧元素卸载；每页还带一个 SVG `<filter>` 子树（`ColorizationFilter`）、6 个 `useEffect`、
  2 次 `useSyncExternalStore`。`ReaderFrame` 同时要重算
  `calculateReaderFrameSize`/`calculateReaderScale`/`rotatePresentationSize`/`calculateReaderPageStretchScales`，
  再经 `commitSlotPage` 触发第二轮渲染。
- **缩放方式**：QuiviT 把变换放在容器上（`imgWrapper.style.transform = viewportState.getTransform()`），
  缩放/平移是合成器操作，不改图片布局尺寸。NeoView 用布局缩放——
  `PageImage.tsx:150-163` 设 `width/height = natural × scale`，`ReaderFrame.tsx:198-201`
  设 `width/height = frameSize × scale`。每次 fit 模式或缩放变化都会改变布局尺寸，
  使 Chromium 按新尺寸重新光栅，并令按尺寸键控的降采样解码缓存失效。
- **色彩滤镜**：`ReaderColorFilter.ts:144-156` 的默认值全为中性，所以默认路径
  `projectReaderColorFilterCss`（同文件 265-284 行）返回空串，**不产生开销**。
  但用户一旦开启色彩化/亮度等，`filter: grayscale(100%) url(#…) brightness() saturate()…`
  会在每次绘制时对整张图重新光栅；QuiviT 对应能力走 WebGL2 叠加画布
  （`services/pipelines/glRuntime.js`），只有开启时才有成本。
- **放大镜层**：`ReaderMagnifierLayer.tsx:59-84` 在每次 `pointermove` 上做
  `getComputedStyle` + `DOMMatrixReadOnly` + 两次 `getBoundingClientRect`，即强制样式/布局读取。
  仅在开启放大镜时有开销，但开启后会让鼠标移动明显变沉。
- `neoviewDebug` 不是生产开销：`neoviewDebug.ts:60` 由 `import.meta.env.DEV` 守卫，
  热路径标签另有 `isHotPathLabel` 过滤。

## 四、为什么 NeoView 会变成现在这样

这不是疏忽，是一次**安全收缩**。`docs/neoview-reader-performance.md` 记录了 2026-07 的无响应
事故：旧的预解码调度器用 Promise 尾巴批处理，快速翻页会在运行中的 `Image.decode()` 后面
堆积过期批次；Chromium 无法可靠取消已在运行的解码；edge-match 背景还用进程级引用持有了
已解码的 `HTMLImageElement`（6240×4160 的 RGBA 约 100 MB）。

当时的处置是把投机工作压到最小：并发 1、默认 1 页、新请求 `queue.clear()`、解码图像改按字节
计量并明确归属。这是正确的。但**代价恰好是 QuiviT 唯一在做优化的那一项**。

关键区别在于：QuiviT 没有回避这个问题，而是**给它设了边界**——512 MB 字节预算、
2 归档滑动窗口、`_poolGeneration`/`_activationGeneration` 代数守卫、预取在目标页激活后才启动。
NeoView 现有的守卫其实已经齐了（identity 检查、generation、`releaseRetained` 驱逐、
预取排在可见页解码之后），缺的是**一个按解码字节而不是按页数计的预算**。

## 五、处置顺序与实施状态

| 优先级 | 动作 | 状态 |
|---|---|---|
| P0 | 先做分段计时，拿到真实占比 | 未做（见第六节） |
| P1 | 预解码窗口预算从「页数」换成「解码字节」，默认 1 → 3 页 | **已实施** |
| P1 | 普通邻页预取从输入闸门解耦 | **已实施** |
| P1 | `PREDECODE_START_DELAY_MS` 350 → 200 | **已实施** |
| P1 | 暂停不再清空已预热窗口 | **已实施**（本次新发现，比原判更关键） |
| P2 | ZIP/CBZ 条目走有字节预算的内存缓存，默认阈值以下不落临时文件 | 未做 |
| P2 | 让 `PageImage` 复用 2–3 个 `<img>` 节点 | 未做 |
| P3 | 缩放/平移改为对容器做 transform | 未做 |
| P3 | 色彩滤镜改 GPU 路径 | 未做 |

## 六、本次实施记录（2026-09-16）

原报告的判断里漏了一条**比预取半径更致命**的问题，实施时才发现：

> `useReaderAdjacentPagePreloader` 在 `plan.admission === "paused"` 时调用 `cancel()`，
> 而 `cancel()` 就是 `releaseRetained(new Set())` —— 把整个已预热窗口全部驱逐。
> `enabled` 又包含 `speculativePreloadAllowed`，而闸门正是在 keydown 的捕获阶段关闭的。
> 所以**每一次翻页都会先销毁上一轮预热出来的解码结果**，再等 350 ms 重新解码。
> 闸门和需求反相关只是表象；真正的损失是「预热了又立刻扔掉」。

### 改动清单

| 文件 | 改动 |
|---|---|
| `src/nodes/neoview/features/reader/useReaderImagePreloader.ts` | `MAX_PREDECODED_PIXELS` → `MAX_PREDECODED_BYTES`（60M 像素 × RGBA 4 字节 = 240 MB，预算本身没变，只是单位换成了 §防预防规则 3 要求的字节）；`DEFAULT_PREDECODED_IMAGES` 1 → 3；`PREDECODE_START_DELAY_MS` 350 → 200；warm entry 重新归属当前 generation |
| `src/nodes/neoview/features/reader/useReaderAdjacentPagePreloader.ts` | `paused` 不再无条件 `cancel()` |
| `src/nodes/neoview/features/reader/readerPreloadPolicy.ts`（新） | `readerAdjacentPreloadEnabled`、`readerPreloadPlanRequiresRelease` 两条判定，纯函数、可单测 |
| `src/nodes/neoview/features/reader/useReaderFrameStability.ts`（新） | 如实上报导航静默时长（0 / 200 ms），替代 `speculativePreloadAllowed ? 1000 : 0` |
| `src/nodes/neoview/app/ReaderApp.tsx` | 邻页预取开关改用 `readerAdjacentPreloadEnabled`；`stableForMs` 改用真实静默时长；闸门仅留给超分（999 → 998 行） |
| `packages/nodes/neoview/src/application/config/ReaderRuntimeConfigModels.ts` | `DEFAULT_NEOVIEW_PRELOAD_CONFIG.browserPredecodePages` 1 → 3（范围仍是 1..4） |
| `src/nodes/neoview/app/ReaderAppModules.tsx` | `INITIAL_PRELOAD_CONFIG.browserPredecodePages` 1 → 3 |

**并发仍为 1**，预取仍排在可见页解码之后 —— 这是 2026-07 事故的守卫，本次未动。
因为并发是 1，QuiviT 的 `100 + 45i` 错峰在这里没有意义（串行本身已经错峰），只对齐了起始延迟。

### 为什么延迟是 200 而不是 QuiviT 的 100

QuiviT 的邻居预取挂在**目标页 `decode()` 的 `.then()`** 上，所以它天然排在可见页之后。
NeoView 没有「可见页解码完成」的可观测信号，只能用固定延迟近似。200 ms 同时跨过
`PreloadCoordinator` 的两个阈值（`< 120` 暂停、`>= 150` 保留反向帧），
而 100 ms 会落在暂停区间里。要真正做到 QuiviT 那样，需要补一个
「当前可见页 decode resolved」信号，属于后续改动。

### 回归门禁证据

- 新增：`[neoview.react.predecode-byte-budget]`（4160×6240 ×4 页在 4 页上限下只准入 2 页）、
  `[neoview.preload.paused-retains]`、`[neoview.preload.paused-releases]`、
  `[neoview.preload.gate-decoupled]`、`[neoview.preload.stability]`、
  `[neoview.preload.stability-reset]`、`[neoview.preload.stability-idle]`。
- 保留：`[neoview.preload.disabled]`（关闭时不发相邻元数据、不建背景 `Image`）、
  `[neoview.react.predecode-cross-batch]`（首个 decode 挂起时只允许最新批次解码）。
- 门禁：`bunx tsc --noEmit`、`bun run typecheck:app`、`bun run check:source-size` 通过；
  preload 相关 5 个测试文件、`ReaderApp.test.tsx`、`Component.test.tsx` 在 `--maxWorkers=1` 下串行通过。
- 调整：`[neoview.preload.plan-gui]` 原本断言 `updatePreloadContext` 恰好调用 1 次；
  新行为会在帧静默 200 ms 后如实再上报一次，因此改为断言「翻页路径上不新增同步调用 +
  最后一次上报的是静默时长」。`src/nodes/neoview` 全量跑仍有 9 个文件失败
  （缺 `artifacts/legacy-source/neoview-emm-raw-data-1920x1080.png`、Card 注册表/交互用例），
  与预加载链路无关，属工作区存量问题。

### 本次明确不做（及原因）

- **`materializeArchiveEntry` 落临时文件**：它返回的是 `MaterializedEntryLease { path }`，
  要改成内存字节缓存得先改这个 port 契约和全部消费者（`ArchiveProvider` 周边），
  并且需要按会话清理路径 —— 属于独立立项，不适合和窗口策略混在一个提交里。
- **`PageImage` 复用 `<img>` 节点 / 容器 transform 缩放**：会动到
  `data-reader-page-image` 契约、`ReaderFrame` 几何和命中测试，风险面远大于收益面。
- **色彩滤镜 GPU 化**：只在用户开启该功能时才有收益，不在默认路径上。

## 七、先量后改

NeoView 已经有现成量具，不需要新造：

- `useReaderImagePreloader` 已通过 `ReaderPreloadEventDto` 上报
  `ttfbMs` / `decodeMs` / `retainedBytes` / `activeLeases`（见 `preloadMetrics`），
  并打了 `neoview-reader-prefetch-ready` 性能标记。
- `?log=debug` 可开启 `neoviewDebug` 时间线。

建议的对照实验，用同一个 CBZ 跑，每档取 p50/p95：

1. `browser_predecode_pages` = 1 / 3 / 4。
2. 色彩化关 vs 开。
3. 归档在本地磁盘 vs 已回暖（区分临时文件 I/O 与解码）。

把一次翻页切成四段分别归因，不要笼统地看总时长：

- `keydown` → React commit（DOM churn 与几何重算）
- React commit → HTTP TTFB（回环 + 路由 + 解压 + 临时文件写读）
- TTFB → `img.decode()` resolve（真正的解码）
- decode resolve → 首帧绘制（上屏）

这样才能区分"该调预取窗口"和"该换归档字节路径"。注意上述第三项里已经含了
临时文件的 I/O，混在一起会虚高解码耗时。
