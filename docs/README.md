# Xiranite 文档中心

这里按使用目的组织 Xiranite 的文档。仓库首页负责说明项目价值和最短使用路径；本目录保存开发、架构、节点与专项设计细节。

## 从这里开始

| 目标 | 文档 |
| --- | --- |
| 安装依赖并启动 Web / Windows 桌面开发 | [快速上手](getting-started.md) |
| 理解前端、契约、后端、节点与 native 边界 | [架构概览](architecture-overview.md) |
| 在并行开发环境中管理端口、manifest 与进程 | [开发会话](development-sessions.md) |
| 了解代码规模、模块职责和测试约束 | [代码规范](code-quality.md) |
| 构建三平台桌面发布产物并理解它的门禁与已知缺口 | [跨平台桌面发布](cross-platform-release.md) |

## 节点开发

| 主题 | 文档 |
| --- | --- |
| 创建或扩展节点 | [节点编写指南](node-authoring.md) |
| 节点独立应用与桌面入口 | [节点应用打包](node-app-packaging.md) |
| 外部节点 package 与共享契约 | [外部节点包](external-node-packages.md) |
| 节点明文配置与 TOML 边界 | [节点配置策略](node-config-toml-strategy.md) |
| 节点专属 UI 的信息架构 | [节点 UI 重构设计](node-specific-ui-redesign.md) |

## 前端与质量

| 主题 | 文档 |
| --- | --- |
| Vitest Browser Mode、普通 Vitest 与宿主测试分工 | [前端测试规范](frontend-testing.md) |
| 前端日志与诊断边界 | [前端日志](frontend-logging.md) |
| CLI / TUI / GUI 交互模式 | [CLI 交互模式](cli-interaction-modes.md) |
| OpenTUI 视觉一致性 | [TUI 视觉保真](tui-visual-fidelity.md) |
| 性能治理计划 | [性能优化](performance-optimization-plan.md) |

## 主要工作台与节点

- [NeoView 迁移架构](neoview-migration.md)
- [NeoView Card 功能清单](neoview-card-functional-checklist.md)
- [NeoView Reader 性能](neoview-reader-performance.md)
- [FindZ v2 设计](findz-v2-design.md)
- [FindZ v2 基准](findz-v2-benchmarks.md)
- [MarkU 工作流设计](marku-workflow-design.md)
- [Czkawka 12 升级计划](czkawka-12-upgrade-plan.md)
- [XLchemy 大批量验收](xlchemy-large-batch-acceptance.md)

## 架构决策

跨模块、长期有效的关键决策保存在 [`docs/adr/`](adr/)；ADR 记录为什么选择某条边界，而不是替代源码、测试或用户文档。
