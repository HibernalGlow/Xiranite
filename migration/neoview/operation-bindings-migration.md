# NeoView 操作绑定迁移方案

## 目标与范围

原 NeoView 的操作绑定同时覆盖动作目录、键盘/鼠标/滚轮/触控、上下文路由、输入录制、径向菜单和旧配置导入。Xiranite 当前已经具备共享 DTO、规范 TOML 持久化、冲突检测和五类设备运行时，但编辑器与输入隔离仍不完整。

本轮优先完成可独立验收的操作绑定基础设施，不把尚未迁移的阅读器、文件、视频或 upscale 业务功能伪装成可执行动作。只有拥有实际 dispatch 实现的稳定动作 ID 才能出现在动作选择器中；业务功能迁移后再按本文件的动作目录规则增量注册。

事实源：

- 原项目：`D:/1VSCODE/Projects/ImageAll/NeeWaifu/neoview/neoview-tauri`
- 固定修订：`a4c4e07401e0e0c3e4d77edba096f6fd5b3e0c45`
- 兼容矩阵：`migration/neoview/input-bindings-compatibility.json`
- 共享契约：`packages/nodes/neoview/src/domain/input/ReaderInputBindings.ts`
- 配置解析：`packages/nodes/neoview/src/application/config/ReaderInputBindingsConfig.ts`
- GUI 编辑器：`src/nodes/neoview/features/settings/cards/InputBindingsSettingsCard.tsx`
- 浏览器路由：`src/nodes/neoview/features/input/ReaderInputRouter.tsx`

## 动作目录规则

动作 ID 使用稳定的 `域.动作` 形式，持久化数据只保存动作 ID，不保存回调或可执行内容。动作元数据统一声明标签和分类，GUI、CLI、TUI 应读取同一目录。

阶段分类：

1. `navigation`：页面和书籍导航。
2. `view`：缩放、适应、旋转和布局。
3. `session`：打开、关闭、重新加载与设置。
4. `slideshow`：播放、暂停、停止、跳过和配置。
5. `media`：播放、定位、静音、音量和速度。
6. `file`：页面与文件操作。
7. `shell`：卡片、侧栏和工具栏显隐。

当前只注册已经在 `ReaderApp` 中实现的动作。后续动作必须同时满足：稳定 ID、共享元数据、dispatch 实现、不可用状态处理、单元测试和至少一种用户入口，才可加入可选目录。

## 本轮实施阶段

### 阶段 A：完整编辑已有 DTO

- 键盘：物理 `code`、Ctrl、Alt、Shift、Meta。
- 鼠标：按钮 0–7、单击/双击。
- 滚轮：上/下与四种修饰键。
- 触控：左/右/上/下滑与 1–3 指。
- 手柄：标准按钮 0–31。
- 输入摘要使用统一规范键，冲突检测继续忽略禁用项并阻止同上下文歧义。

### 阶段 B：交互式录制

- 键盘录制捕获一次非纯修饰键输入，保留物理 code 和修饰键。
- 录制支持明确开始、取消和完成，不得向 Reader 动作路由泄漏。
- 鼠标、触控和手柄保持显式有界编辑；后续增加对应可视化录制器时复用相同 DTO，不另建持久化格式。

### 阶段 C：路由安全

- 编辑器、模态框和普通交互控件不执行 Reader/global 动作。
- 鼠标和手势只在 Reader 画布/非交互区域解析，不与按钮、链接、菜单和可编辑控件竞争。
- IME、键盘重复和不可见页面的手柄事件继续被抑制。
- 只有实际匹配并执行的输入才阻止浏览器默认行为。

### 阶段 D：后续兼容迁移

以下能力仍按兼容矩阵保持 `pending`，不计入本轮完成：九宫格区域点击、鼠标轨迹、径向菜单、语音、旧动作级转换，以及尚无业务 dispatch 的原项目动作。它们必须复用本轮动作目录、上下文和持久化模型。

## 验收标准

- 五类设备的所有既有 DTO 字段均能在设置卡中编辑。
- 可通过录制按钮捕获键盘组合键，并可取消录制。
- 0–7 鼠标键、滚轮修饰键和 1–3 指触控可以保存并通过严格后端解析。
- 搜索、上下文筛选、启停、删除、恢复默认、冲突阻止、保存成功和失败反馈保持可用。
- Reader 画布上的绑定可执行；输入框、选择框、按钮、链接、对话框和面板控件不会误执行 Reader/global 绑定。
- 现有默认绑定及已有 TOML 数据向后兼容。
- 域测试、配置解析测试、React 设置卡测试和输入路由测试通过；项目类型检查通过。

## 后续动作接入清单

按优先级增量迁移：

1. 第一/最后一页、方向独立翻页、上一/下一本、重新加载。
2. 全景、方向、适应锁定、自动旋转、悬停滚动和放大镜。
3. Folder/Page 的复制、剪切、粘贴、删除、撤销和批量操作。
4. 幻灯片完整控制与视频控制。
5. 卡片/窗口/侧栏显隐、九宫格、轨迹手势和径向菜单。

每项完成时同步更新 `migration/neoview/input-bindings-compatibility.json` 和功能/卡片兼容矩阵，不能仅增加动作名称。
