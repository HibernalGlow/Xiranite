# 民事诉讼主管动画对比

同一份法考资料分别保留了 HyperFrames、Remotion、Motion Canvas 和 ManimCE 实现。当前主版本选择 HyperFrames，并把原表格重构为关键概念驱动的动态图解。

## 选择结论

| 目标 | 结论 |
| --- | --- |
| 中文知识动画的综合效果 | HyperFrames 最合适：HTML 源码可审阅，关系路径、承接和逐帧控制稳定 |
| 最少场景代码 | Motion Canvas 略短，但 Windows 渲染桥接与自动化代码抵消了优势 |
| 数学公式和几何推演 | ManimCE 最合适，但不擅长本例这种信息设计 |
| 当前机器上最容易一次完成 | HyperFrames，检查、接缝门禁、快照和 MP4 可由同一工具链验证 |

没有动画工具能保证“零纠错”。本例优先减少纠错来源：使用结构化分镜、统一 60fps 时间轴、固定视觉语汇和关键帧验收。

## HyperFrames 主版本

- 规格：1920x1080、60fps、43.33 秒，整体按 0.6 倍速放慢。
- 形式：关键词卡片、法院边界、司法确认盖章、仲裁屏障、劳动仲裁关卡、最终关系图。
- 动势：以向右推进为主，使用 cut-the-curve 接缝和共享路径承接；关系通过路径、门槛、印章和状态变化表达，不复刻原表格。
- 源码：`hyperframes/index.html`、`styles.css`、`DESIGN.md`、`ledger.json`。
- 成片：`../../output/legal-jurisdiction-animation/hyperframes.mp4`。

## Remotion 对照版本

- 规格：1920x1080、60fps、26 秒。
- 形式：案件入门、范围包围、三路关系、司法确认盖章、仲裁屏障、劳动仲裁关卡、最终关系图。
- 文案：只保留“主管、平等主体、财产关系、人身关系、司法确认、或裁或审、仲裁前置”等关键词。
- 动势：普通动作统一向右推进，跨场景只使用平移承接和共享元素承接，不使用交叉淡化或无意义漂浮。

`motion-ledger.json` 记录跨场景动势和承接物。它采用 `motion-doctrine` 的 vector ledger 思路，但由 Remotion 逐帧时间轴实现，不调用 HyperFrames 专用的 seam 脚本。

## 依赖取舍

`lucide-react` 用于法院、协议、仲裁、劳动争议和执行状态图标。它提供稳定 React API，采用 ISC 许可证，声明 `sideEffects: false`、可按图标 tree-shake，且没有运行时依赖。替换成本仅限图标组件 import；相比手写 SVG，它减少了视觉不一致和维护成本。

## 运行

```powershell
bun run typecheck
bun run studio:remotion
bun run still:remotion
bun run render:remotion
```

输出位于 `../../output/legal-jurisdiction-animation/`。
