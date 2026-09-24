# Snapshot LSP

Snapshot 类 DOM DSL 的通用 TypeScript 语言服务。核心不依赖编辑器，可用于 VS Code 扩展、Monaco 等 LSP 客户端；提供 Node stdio 与浏览器 Worker 两种服务入口。

## 功能

- 覆盖 Snapshot `parser` 默认注册的 38 个标签及其属性。
- 标签、属性、枚举值、闭合标签补全与悬停说明。
- 未知标签/属性、重复属性、必填属性、基本取值、根节点、父子关系和子节点数量诊断。
- 编辑中的不完整标签可继续补全；可通过 `SnapshotLanguageService` 扩展标签目录。

目录在构建时固化于 `src/catalog.generated.json`，运行时无需 Java/Kotlin 或 Snapshot 仓库。语言服务只做静态检查；图片解码、布局渲染以及复杂属性间约束仍由 Snapshot 解析器负责。

## 开发

要求 Node.js 22+。

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
node dist/node.js --stdio
```

更新 Snapshot 源码后，从本仓库执行 `pnpm run sync:catalog`。默认读取同级 `../snapshot`；也可执行 `node scripts/sync-catalog.mjs <snapshot 仓库路径>`。更新后运行测试，核对新属性的类型与取值规则。

## 集成

### VS Code 等桌面客户端

服务端命令为 `snapshot-lsp --stdio`，或者运行包内 `dist/node.js --stdio`。客户端将 `.snapshot` 文件关联到语言 ID `snapshot`，以标准 LSP 的 stdio 传输启动服务即可。已实现 `textDocumentSync`、`completion`、`hover` 和 `publishDiagnostics`。

### Monaco / 浏览器 Worker

用打包器构建 Worker 入口：

```ts
import { startBrowserWorkerServer } from 'snapshot-lsp/browser';

startBrowserWorkerServer(self);
```

宿主使用支持 Web Worker 传输的 LSP 客户端（如 `monaco-languageclient`）连接该 Worker，并为语言 ID `snapshot` 注册 `.snapshot` 文档。若宿主已有自定义消息传输，可使用 `startBrowserServer(reader, writer)`。

### 直接使用语言核心

```ts
import { SnapshotLanguageService } from 'snapshot-lsp';

const service = new SnapshotLanguageService();
const diagnostics = service.diagnostics('<Snapshot><Text>Hello</Text></Snapshot>');
const completions = service.completions('<Snapshot><Co', { line: 0, character: 13 });
```

扩展标签时向构造函数传入 `{ Custom: { mode: 'none', description: '...', attributes: { title: { kind: 'string' } } } }`。目录只描述静态语法，宿主仍需在 Snapshot 的 `WidgetParserManager` 中注册对应解析器。

## 与 Snapshot 的关系

语法依据同级 `snapshot/parser` 的 `WidgetParserManager`、各 `WidgetParser` 与 `docs/usage/README.md`。标签和属性区分大小写。Snapshot 对部分未识别属性会静默忽略；本服务将其作为警告提示，帮助发现拼写错误。Snapshot 在 EOF 会自动闭合部分未结束的标签，本服务也允许编辑中的不完整结构。
