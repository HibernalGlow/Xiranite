# OpenTUI + SIXEL 动态图库工程经验

本文记录 EngineV TUI 多图动态图库的完整踩坑过程和最终约束。它既是
EngineV 的设计说明，也是以后为其他节点实现终端图片、GIF/APNG 预览时的
工程基线。

## 最终结论

SIXEL 不是 OpenTUI FrameBuffer 中的一种普通组件。它是直接发送给终端的
图形协议，拥有独立于 OpenTUI 字符布局的像素状态。因此：

1. OpenTUI 负责布局、边框、文字、鼠标命中和逻辑滚动。
2. 节点自己的 SIXEL compositor 负责图片解码、缩放、可见性、擦除和重画。
3. schema 只描述值、校验和执行输入，不应该限制高复杂度节点的呈现方式。
4. 共享 runtime 可以提供图片解码和协议工具，但不能假装原生 SIXEL 自动受
   `scrollbox` 裁剪。

EngineV 因此允许拥有独立图库设计，同时继续复用共享主题、顶栏、帮助、任务
队列、配置、表单和三模式分流。

## 最终渲染流程

一次有效滚动按照以下顺序处理：

1. 收到滚轮事件时先检查是否已经位于顶部或底部；越界滚轮直接忽略。
2. 真正发生滚动时暂停 SIXEL 输出，让 OpenTUI 只更新逻辑布局。
3. 连续滚轮事件合并，等待约 50ms 稳定窗口。
4. 按完整卡片行吸附滚动，保证图片槽与文字槽不会在不同滚动相位下重叠。
5. 正常滚动不执行 DECERA；新卡片使用不透明 SIXEL 帧直接覆盖固定图片槽。
   DECERA 只保留给列数布局变化或退出清场，绝不能用于连续滚动。
6. 递增 `drawingGeneration`，使坐标没有变化的图片也必须重新绘制。
7. 请求 OpenTUI 生成新一帧字符界面。
8. OpenTUI 帧完成后，只输出完全位于 viewport 内的 SIXEL 卡片。
9. 将动画焦点移动到当前可见范围内的第一张 GIF/APNG；鼠标移入卡片也可切换
   动画焦点。

这个流程的关键不是“让 SIXEL 进入 OpenTUI”，而是让两个渲染层以明确的先后
顺序协作。

## 协议层经验

### 1. 禁止 SIXEL 带动整个终端滚动

绘制前发送：

```text
CSI ? 80 l
```

这是重置 DECSDM。没有它时，SIXEL 活动位置到达底部可能触发终端整页滚动，
表现为图库没有在容器内滚动，而是整个 TUI 被推动。

### 2. 使用 DECERA 擦除旧 viewport

```text
CSI top ; left ; bottom ; right $ z
```

DECERA 是矩形区域擦除。滚动后的 SIXEL 不能依靠 OpenTUI 输出空格自然清理，
必须显式擦除旧像素区域。坐标采用 1-based、包含边界的终端单元格坐标。

Windows Terminal 的 DECERA 会同时影响矩形内的字符单元格，并不是只清理 SIXEL
像素层。即使坐标严格限制在图片槽，反复滚动和布局相位变化仍可能误伤相邻文字。
因此正常滚动只能依靠不透明 SIXEL 帧覆盖固定图片槽。强制清空 OpenTUI previous
frame 虽然能补字，但会造成持续文字闪烁，也不是正确方案。

### 3. 背景模式不能使用 `1`

`sixel.image2sixel` 的最后一个参数控制未着色像素：

- `0`：终端默认行为；
- `1`：保留当前位置旧像素；
- `2`：写入背景色。

滚动图库必须使用 `2`。曾经使用 `1`，导致每次重画都保留旧像素，最终出现
越来越多的彩色条纹、重影和颜色叠加。

### 4. 隔离颜色寄存器

绘制前启用：

```text
CSI ? 1070 h
```

支持该模式的终端会为每幅 SIXEL 使用私有颜色寄存器，减少多图连续输出时的
调色板相互污染。不支持的终端通常会安全忽略。

### 5. 原始字节不能直接交给 OpenTUI 私有 writer

OpenTUI 的同步 `writeOut` 接口接收字符串。直接传 `Uint8Array` 会触发普通
JavaScript `.toString()`，SIXEL 会被显示成：

```text
52,50,63,64,36,35,...
```

正确做法是先使用 Latin-1 进行 1:1 字节映射：

```ts
Buffer.from(bytes).toString("latin1")
```

回退到真实 `stdout.write` 时仍然写入 `Buffer`。

## OpenTUI 集成经验

### 1. `scrollbox` 不会自动裁剪原生图形

OpenTUI 的 scissor rect、viewport culling 和 FrameBuffer 只管理它自己的字符
渲染。SIXEL 已经是终端像素层状态，不能因为 JSX 嵌套在 `<scrollbox>` 中就自动
获得裁剪。

因此每张图片在输出前必须检查：

- 图片框在终端范围内；
- 图片框完全位于图库 viewport 内；
- 当前没有处于连续滚动暂停期。

部分可见的卡片暂不输出原生图片，避免 SIXEL 穿过边框。

### 2. OpenTUI 的 `FRAME` 事件发生在字符帧输出之后

这个时序适合发送新 SIXEL，但不适合在事件里先执行 DECERA，因为此时文字已经
画完。正确顺序是：事件输入阶段擦除旧图并请求 render，`FRAME` 事件中输出新图。

### 3. 到达滚动边界后不能继续擦除

曾经在底部继续滚轮时仍执行 DECERA，但 `scrollTop` 没有变化。图片组件又因为
坐标相同跳过输出，于是整个图库消失。

必须同时采取两项保护：

- 顶部向上、底部向下的越界滚轮不安排重画；
- 每次真实擦除递增重绘代次，代次参与图片输出签名。

### 4. 通用 schema 与特殊 renderer 应解耦

共享 interaction schema 适合描述：

- 工作路径；
- 筛选条件；
- 后端选择；
- 自动/固定列数；
- dry-run、并发数和执行输入。

它不应该规定 EngineV 必须使用通用三栏 renderer。图片图库可以使用独立组件和
独立合成策略，只需保持相同的数据模型和执行 session。

## 图片尺寸与布局经验

### 1. 必须在编码前缩放或裁剪

不要先编码原图再期待终端自动适配。Sharp 应按最终卡片像素尺寸进行：

- `cover`：图库卡片，保持一致的 16:9 视觉面积；
- `contain`：需要看完整内容的详情预览；
- `ensureAlpha()`：统一 RGBA 输入。

字符单元格必须先换算为终端像素尺寸。终端没有报告像素分辨率时才使用保守的
字符宽高估算。

### 2. 列数必须响应终端宽度

EngineV 使用 `0` 表示自动列数，并允许固定 1–6 列。当前自动断点为：

| 终端宽度 | 列数 |
| --- | --- |
| `< 72` | 1 |
| `72–104` | 2 |
| `105–139` | 3 |
| `140–169` | 4 |
| `>= 170` | 5 |

列数变化前要先清理旧 viewport，之后根据新 tile 尺寸重新解码或复用对应尺寸缓存。

## 动画与性能经验

### 1. 不要让所有 GIF 同时高帧率播放

真实工坊数据中多数预览是 50 帧、40ms 延迟的 GIF。如果 15 张可见图片同时以
25fps 输出，SIXEL 编码和终端传输会立刻成为瓶颈。

当前策略：

- 静态卡片只解第一帧；
- 当前动画焦点最多解 24 帧；
- 帧间隔最小 80ms，约 12.5fps；
- 滚动完成后自动聚焦当前可见区域的第一张 GIF/APNG；
- 鼠标移入卡片时切换动画焦点。

如果未来需要所有卡片同时动画，应该实现“整个 viewport 合成为单张 SIXEL atlas”
的独立 compositor，而不是继续增加独立 SIXEL 流。

### 2. 解码必须懒加载

`viewportCulling` 不代表 React 组件没有挂载。若图片 effect 在挂载时立即读取文件，
容器外的项目仍然会全部解码。

正确做法是在 OpenTUI 布局完成后检查 box 与 viewport 是否相交，只加载可见项和
一行 overscan。当前同时执行的 Sharp 解码任务最多为 3。

### 3. 编码结果必须缓存

相同源、尺寸、fit 和帧数的解码结果使用 Promise cache，避免重复读取。已经量化
完成的 SIXEL payload 使用以 frame 对象为键的 `WeakMap`，滚动重画时直接重发
字节，不再重复量化。

当前图库使用 128 色而不是 256 色，在保持缩略图可读性的同时降低编码时间和输出
体积。

### 4. 连续滚轮要合并

每个滚轮增量都执行“擦除 + 全量重画”会产生明显闪屏，并把终端输出队列打满。
当前使用约 50ms settle window：滚动期间暂停图片输出，稳定后只重画最终可见集。

## 失败方案与症状对照

| 症状 | 错误原因 | 修复 |
| --- | --- | --- |
| 页面出现逗号分隔数字 | `Uint8Array.toString()` | Latin-1 字节映射 |
| 整个终端跟着图片滚动 | DECSDM/SIXEL scrolling | 绘制前 `CSI ? 80 l` |
| 图片越过 scrollbox 边界 | 把 SIXEL 当作 OpenTUI 子组件 | 独立 viewport 可见性检查 |
| 滚动后图片铺满页面 | 旧 SIXEL 没有清理 | 滚动稳定后 DECERA + 可见集重画 |
| 滚动后文字消失 | Windows Terminal 的 DECERA 同时擦除字符单元格 | 从滚动路径移除 DECERA，使用不透明 SIXEL 覆盖固定槽 |
| 滚动时文字持续闪烁 | 为恢复文字而反复清空 OpenTUI previous frame | 不再擦字符，不再强制全帧补画 |
| 彩色条纹越来越多 | backgroundSelect 使用 `1` | 使用不透明背景模式 `2` |
| 到底再滚一次全部消失 | 无效滚动仍擦除，位置缓存跳过重画 | 边界检查 + drawingGeneration |
| 首次加载很慢 | 20 张图片同时解码/量化 | 可见区懒加载 + 并发 3 + payload cache |
| 滚动明显闪白 | 每个 wheel event 立即擦除 | 50ms 防抖，稳定后擦除重画 |
| GIF 看起来不动 | 动画焦点滚出 viewport | 自动选择可见 GIF + hover 聚焦 |
| 动画播放导致终端卡顿 | 多图 25fps 独立 SIXEL 流 | 单焦点动画、最低 80ms 帧间隔 |

## 测试要求

### 自动测试

共享图片 runtime 至少覆盖：

- `auto` 后端优先级：SIXEL → Kitty → Half Block；
- RGBA → Half Block；
- RGBA → 完整 SIXEL DCS；
- backgroundSelect 必须为 `2`；
- `writeOut` 接收字符串且字节可逆；
- DECSDM 和 DECERA 序列；
- 动态 GIF 页数和帧延迟；
- 顶部/底部越界滚轮不安排擦除。

### 实机测试

字符截图无法证明 SIXEL 正确，必须在真实支持 SIXEL 的终端测试：

1. 初次扫描 20 张真实工坊预览；
2. 自动列数及固定 1–6 列；
3. 快速连续向上、向下滚动；
4. 到顶/到底继续滚轮；
5. 鼠标移入 GIF 后观察动画；
6. 多次往返滚动，检查条纹、重影和越界；
7. 调整终端宽度后重新布局；
8. 退出 TUI 后确认没有残留图形或终端模式。

GUI 对照仍使用：

```text
output/playwright/enginev/enginev-reference-review.jpg
```

参考图验证布局和信息层级；真实终端验证协议、动画和滚动。

## 包边界

OpenTUI、Sharp 和 SIXEL 必须留在终端专用子路径。浏览器/桌面组件只能引用纯
interaction、i18n 和 core 类型，不能通过 `@xiranite/cli-runtime` 根入口把原生
终端依赖带入 Vite 浏览器构建图。

## 外部资料

- [xterm Control Sequences — SIXEL Graphics](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
- [Windows Terminal rectangular area operations #14112](https://github.com/microsoft/terminal/issues/14112)
- [How does sixel scrolling work?](https://github.com/hackerb9/vt340test/issues/11)
- [`sixel` package encoding documentation](https://www.npmjs.com/package/sixel)

## 后续可升级方向

如果单焦点动画仍不能满足 GUI 还原目标，下一步不是让更多卡片各自播放，而是实现
EngineV 专属的 viewport atlas compositor：统一推进所有可见动画帧，把图片区域
合成为一次 SIXEL 输出，再与 OpenTUI 字符层同步。这能显著减少 DCS 数量、调色板
切换和终端 I/O，但复杂度高，应作为独立优化阶段实现。
