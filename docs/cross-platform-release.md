# 跨平台桌面发布

单一工作流 `.github/workflows/desktop-release.yml` 产出 3 平台 × 2 变体共六个桌面宿主。
本文件记录这份契约、它的门禁为什么长成这样，以及非 Windows 上仍未闭合的能力。

## 触发与发布

- `workflow_dispatch` 只构建并上传 Actions 产物，**不发布**：`publish` 作业的条件是
  `startsWith(github.ref, 'refs/tags/')`，这是有意的——分发跑出来的产物名里带分支名。
- 推 `v*.*.*` 标签才会创建公开 GitHub Release 并上传六个产物。
- 标签上跑的是**该标签那个提交里**的工作流定义。历史上的 `v1.0.0`（2026-07-25，
  `10e82e109`）里还是只有 Windows 的旧版工作流，所以要用它验证现在的矩阵是不可能的；
  已存在的标签也不应移动。要正式发版必须打新标签。
- `concurrency.cancel-in-progress` 会顶掉同 ref 上在跑的作业。被取消作业的日志要等
  作业进入终态后才发布，卡住时看不到部分输出。

## 版本只有一个来源

`package.json#packageManager` 的 `bun@1.3.0` 同时决定：CI 里 `setup-bun` 的工具链版本、
`fetch:bun-runtime` 下载并内嵌的运行时版本，以及 `-X main.nodeAppMinimumBunVersion` /
`-X main.embeddedBunVersion` 两个 stamp。三者不可能漂移，也不需要第三处声明。

## 两个变体

| 变体 | Go tag | 运行时来源 | 版本下限 |
| --- | --- | --- | --- |
| `embedded-bun` | `production` | 可执行文件内嵌的 Bun | stamp 的 `embeddedBunVersion` |
| `system-bun` | `production,no_bun` | 用户 `PATH` 上的 Bun | stamp 的 `nodeAppMinimumBunVersion` |

发布门禁（`go test`，两个变体都跑）：

- `EmbeddedBunRuntime*`、`PackagedBackendBoots`、`SystemBunFallback`：embedded 侧。
  其中启动打包后端并请求 `/health` 那条，是唯一能证明「解压出来的产物真的能用」的检查。
- `SystemBunVariant`：system 侧证明没有内嵌运行时且接受用户装的 Bun。
- `PackagedBackendCarriesNativeNodeModules`：两个变体都跑，走**真实嵌入的 FS**而不是
  `fstest` 假数据。
- 测试二进制按导入路径链接包，所以 `-X main.*` 在测试里无效，必须用 `go.mod` 里的模块
  路径前缀；未 stamp 时 `XIRANITE_REQUIRE_RELEASE_RUNTIME=1` 把 skip 变成硬失败，否则
  门禁会「因为没跑而绿」。

## 产物必须自包含

宿主在运行时把内嵌内容解压到用户缓存目录（`<cache>/Xiranite/runtime/backend-<hash>/`，
原生资产在 `<cache>/Xiranite/native/...`），**上面没有任何 `node_modules`**。因此三类
依赖各走各的路：

- Bun 运行时：`scripts/fetch-bun-runtime.ts` 落到 `build/wails/bun/`，由 Go 内嵌。
- napi 绑定（arcthumb、czkawka、findz）：`build:native-assets` 打成 zip 内嵌，运行时
  解出并用绝对路径 `dlopen`；兄弟动态库目录会前置进 `PATH` / `DYLD_LIBRARY_PATH` /
  `LD_LIBRARY_PATH`（`packages/native-loader/src/index.ts`）。
- 运行时才拼出来的 bare specifier：目前只有 `libsql`，它执行
  `require(\`@libsql/${target}\`)`，Bun 无法把它改写成 `backend-assets/` 那种 sidecar
  形式。`scripts/build-backend-js.ts` 于是把安装器实下的平台包复制到
  `build/wails/node_modules/@libsql/<pkg>/`，`local_backend_embed_production.go` 一并
  内嵌，解压后由 Node 自己的查找规则命中。

三个已经踩实的前提，改动这几处时必须保持：

1. 下载不能依赖 `AbortController`。Bun 1.3.0 上响应体中途停摆时
   `await Bun.write(response)` 既不返回也不 reject，连并排的 `setTimeout` 看门狗都不触发，
   整个事件循环被焊死；改子进程 + `curl --max-time/--speed-limit` 才是有界的。1.4.2 无此
   问题，所以**本机永远复现不出来**，复现要用 pin 的那个二进制。
2. 复制 `node_modules` 内容时必须 `realpath` 源头并 `dereference`。`bun install` 的
   isolated 布局（CI 用的那个）里包目录本身是指向 `.bun` store 的符号链接，`fs.cp` 默认
   原样复制链接，而 `go:embed` 不跟符号链接，会谎报「contains no embeddable files」。
3. Windows 上不能靠 `PATH` 里的 `tar`。步骤跑在 Git Bash 下时它命中的是 MSYS GNU tar，
   会把 `C:\...` 读成远程 `host:path`；要显式用 `System32\tar.exe`（bsdtar）。

## 平台差异与已知缺口

- macOS 产物是 zip 里的 `.app`，用 `ditto` 打包以保留 bundle 元数据；**ad-hoc 签名、未
  公证**，首次启动需要用户在 Gatekeeper 显式放行。
- Linux 产物是裸可执行文件，宿主链接 GTK4 + WebKitGTK 6（Wails v3 未加 gtk3 tag 时的
  pkg-config 目标），需要主机装 `libgtk-4-dev` / `libwebkitgtk-6.0-dev` / `libsoup-3.0`。
- **非 Windows 缺 czkawka**：`native/czkawka-core` 显式开了 `czkawka_core` 的 `libavif`
  特性，其 `dav1d-sys` 需要系统 `dav1d >= 1.3.0`（pkg-config）。runner 没装，于是整个
  czkawka 资产构建失败，重复文件节点在这两个平台报能力不可用；工作流按设计记 warning
  并继续出产物。Windows 不受影响，因为 `dav1d.dll` 已作为兄弟依赖打进资产。
  两条闭合路线尚未定：给 CI 装 dav1d 并把 dylib/so 随资产打包并处理 macOS 的
  `install_name` 改写与重签名；或在非 Windows 关掉 `libavif`，换来整个节点可用但少一个
  编解码器，并与 Windows 能力分叉。

## 验证

```text
gh workflow run desktop-release.yml --ref master    # 六个作业，不发版
bun run build:backend:js                            # 应打印 Bundled native dependency ...
go test -mod=mod -count=1 -tags production,no_bun \
  -run 'PackagedBackendCarriesNativeNodeModules' .  # 需先跑上一条
bun test scripts/lib/backend-native-deps.test.ts    # 含真实 isolated 符号链接形态
```

`scripts/` 不在任何 `tsconfig` 的 include 里，`typecheck:app` 覆盖不到这些脚本；改它们靠
`bunx oxlint` 加实际运行，而不是 typecheck。
