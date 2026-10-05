# CLI 命名与引导式 UI

Xiranite 节点包暴露独立的命令行工具。当前公共命令命名策略为：

```ts
nodeCliName("repacku") // repacku
nodeCliName("lata")    // lata
```

策略定义在 `@xiranite/cli-runtime` 中：

- `NODE_CLI_PREFIX`：当前前缀，**现为空字符串**——节点命令名与它的独立分发同名（ADR-0069 §Standalone 的 `productName` 就是节点本名），所以不再叠 `x`
- `LEGACY_NODE_CLI_PREFIX`：旧版兼容前缀，现为 `xiranite-`
- `nodeCliName(nodeId)`：格式化公共命令名称
- `normalizeNodeCliName(value)`：把 `xiranite-repacku` 或 `repacku` 解析为 `repacku`；短前缀 `x` 的写法**不再被识别**（它从未作为产品命令发布，按 AGENTS 不留兼容层）
- `isEntryModule(import.meta.url)`：见下「入口守卫」

## 为何存在

大多数 CLI 框架可以自定义显示名称、帮助输出、别名和子命令，但它们无法使 `package.json#bin` 动态化。

`package.json#bin` 是一个静态的 npm 清单字段。它不能引用 `${prefix}${name}` 这样的变量。由于每个节点包都是独立可安装的，每个包仍然需要一个真实的静态 `bin` 入口。

为避免手动编辑 26 个包清单，Xiranite 使用一个小的同步脚本：

```powershell
bun run sync:cli-bins
```

该脚本根据 `nodeCliName(id)` 重写每个 `packages/nodes/<id>/package.json` 的 bin 字段。如果后续前缀变更，更新 `NODE_CLI_PREFIX` 并重新运行脚本即可。


## 更改命令名称

1. 编辑 `packages/cli-runtime/src/index.ts` 中的 `NODE_CLI_PREFIX`。
2. 运行 `bun run sync:cli-bins`（重写 30 个 `package.json#bin`）。
3. 运行 `bun run generate:node-registries`，再 `bun run build:packages`。
4. 让链接与权限重新可用：`bun scripts/ensure-node-cli-bins.ts`（见下），PATH 上的 shim 用 `bun scripts/install-cli-shims.ts`。
5. 尺要跟着走：`bun run migrate:node-cli-surface` 重写基线前先看 diff——它会顺手把别的 lane 退役掉的节点一起「合法化」，只需要改名时应手改 `docs/node-cli-surface-baseline.json` 里的 `program` 字段。

## 入口守卫（为什么不能拿 `process.argv[1]` 正则判断）

`cli.ts` 末尾那段「我是不是主模块」的守卫以前是
`if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1]))`。安装器暴露的命令名是 `node_modules/.bin/<name>`，
**名字没有扩展名**，所以走命令执行时守卫为假：`runProgram()` 没被调用，进程静默 `rc=0`、什么都不打印
（实测：`node packages/nodes/dissolvef/dist/cli.js plan …` 正常，`node node_modules/.bin/dissolvef plan …` 无输出）。
现在统一用 `isEntryModule(import.meta.url)`：调用方交出**自己**的模块 URL（辅助函数自己的 URL 永远是 cli-runtime），
`process.argv[1]` 先 `realpath` 再比，覆盖「软链执行」和「直接跑文件」两条路。

## `.bin` 的可执行位

`tsc` 每次重发 `dist/cli.js` 都是 644，与源文件权限无关；`package.json#bin` 指向不可执行的文件时，命令直接
`permission denied`，而且 `bun x <node>` 会把它当成「本地没有这个 bin」去 registry 找。
`scripts/ensure-node-cli-bins.ts` 负责补权限并校正 `.bin` 链接（`--check` 只报不改）；`bun run build:packages`
在 turbo 成功后自动带一次。`install-cli-shims.ts` 写的是 `bun "<target>"` 形式的 shim，不依赖这个位。

## 节点包规则

- 使用 `nodeCliName("<node-id>")` 作为 CLI `name` 和 `citty` `meta.name`。
- 不要在源文件中硬编码 `xiranite-*`、`x*` 或未来的命令名称。
- 保持 `package.json#bin` 由 `bun run sync:cli-bins` 生成。