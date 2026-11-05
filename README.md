# Snapshot LSP

Snapshot 类 DOM DSL 的通用 TypeScript 语言服务。核心不依赖编辑器，可用于 VS Code 扩展、Monaco 等 LSP 客户端；提供 Node stdio 与浏览器 Worker 两种服务入口。

## 功能

- 覆盖 Snapshot `parser` 默认注册的 39 个标签及其属性，包括支持 SVG 路径裁剪的 `<ClipPath>`。
- 标签、属性、枚举值、闭合标签补全与悬停说明。
- 未知标签/属性、重复属性、必填属性、基本取值、根节点、父子关系和子节点数量诊断。
- 颜色属性支持 Snapshot parser 的 CSS 颜色语法：`#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA`、命名颜色、`transparent` 及 `rgb()`/`rgba()`/`hsl()`/`hsla()`。
- 编辑中的不完整标签可继续补全；可通过 `SnapshotLanguageService` 扩展标签目录。

补全支持在名称中间替换标签和属性名，修改已有属性名时保留原赋值；闭合标签候选取当前位置仍打开的父节点，并补齐缺少的 `>`。空标签名和紧邻后续标签的不完整标签也可继续补全，注释、CDATA 和属性值内不会误插入标签或属性名。

枚举补全包含方向、对齐、图片重复、装饰位置、平铺、混合、文本宽高、基线、字体和画笔模式等类型，并覆盖前景、渐变、strut 等属性别名。内置枚举忽略首尾空白和大小写，支持连字符代替下划线，例如 `space-between`；补全可以匹配别名并插入规范名称。枚举补全与诊断共享值域；`BoxAlignment` 还支持坐标，例如 `-.5 +0.25` 或 `(-.5,+0.25)`。

目录和 CSS 命名颜色分别固化于 `src/catalog.generated.json`、`src/css-color-names.generated.json`，枚举值域集中维护于 `src/value-types.json`，复合格式及填写示例维护于 `src/attribute-formats.json`，运行时无需 Java/Kotlin 或 Snapshot 仓库。目录保留 `copyWith` 属性别名的类型、语法及枚举规范化规则，因此前景、渐变、strut 等属性也使用对应校验和提示。语言服务只做静态检查；图片解码、布局渲染以及其他组件约束仍由 Snapshot 解析器负责。

完整标签的必填属性只有名称而没有值时会提示缺值；编辑中的未完成标签保持容错。`Raw` 内可以继续嵌套 `WidgetSpan`，与 Snapshot 的行内文本解析规则一致。

无引号属性值可以包含 URL 或路径中的 `/`。与 Snapshot tokenizer 一致，自闭合标记需与无引号值用空白分隔，例如 `<Image url=https://example.com/a.png />`；`text=a/b/>` 中末尾的 `/` 仍属于属性值。使用引号时可以直接写 `text="a/b"/>`。

`<ClipPath>` 提供 `path` 必填提示、`viewBox` 格式检查和 `fit`、`fillRule`、`clipBehavior` 枚举补全。SVG 路径命令的完整语法与坐标有效性由 Snapshot parser 在解析时检查。

### 属性语法（2026-11-05 Parser 契约）

以下语法需要使用包含对应变更的 Snapshot parser；LSP 支持不代表宿主渲染服务已经升级。完整样例见 [sample/attribute-syntax.snapshot](sample/attribute-syntax.snapshot)。属性名和标签名仍区分大小写，没有新增 CSS 属性或标签。

| 属性类型                                   | 支持的填写方式与约束                                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `padding` / `margin`                       | 空白分隔 1～4 值，按 CSS 上、右、下、左展开，例如 `8 16`、`1 2 3`。旧 `(垂直,水平)` / `(左,上,右,下)` 保留；不接受裸逗号列表。                                                                                        |
| `BoxAlignment` / `Transform.origin`        | `x y`、`x,y`、`(x,y)`、`(x y)`，恰好两个有限坐标。BoxAlignment 仍支持对齐关键字，origin 只接受坐标。                                                                                                                  |
| 枚举和关键字                               | 内置枚举忽略首尾空白、大小写，连字符可替代下划线；`Snapshot.type` 接受 `PNG` 等别名，仍仅有 png/jpg/webp。`ClipPath.fit` 仍仅 FILL/CONTAIN，`fillRule` 仍仅 NON_ZERO/EVEN_ODD。                                       |
| `fontFamily` / `strutFontFamily`           | 英文逗号分隔，逐项 trim，保留内部空白、大小写、连字符；空项报错。不引入 CSS 引号解码或转义。                                                                                                                          |
| 圆角及单角、前景、裁剪圆角                 | 单半径 `12`、椭圆 `12 / 6` 或旧 `(12,6)` / `(12 6)`。不接受裸 `12 6`、`12,6` 或 CSS 多角半径。                                                                                                                        |
| `Transform.matrix` / `Container.transform` | 16 个列优先数，空白或逗号分隔、可加括号；或 `translate(12,8) rotate(30deg) scale(1.2)`、`none`。旋转必须带 deg/rad，函数名忽略大小写。                                                                                |
| 边框及单边、前景边框                       | `2 red` 默认 SOLID；`2 solid red` 和 `none` 均可。支持 CSS 颜色函数；不支持任意参数顺序、dashed 或 px。                                                                                                               |
| 渐变色标 / 文本装饰列表                    | 空白或逗号分隔，同一列表不混用。色标要求与颜色数量相同、在 0..1 内且升序；装饰支持别名且规范化后不可重复，NONE 独立使用。颜色列表仍按括号外逗号分隔。                                                                 |
| 盒阴影 / 文本阴影                          | 前两个数固定为偏移；随后数字依次作为 blurRadius/spreadRadius（盒）或 blurSigma（文本），颜色与盒阴影模式可穿插且不可重复。数值须有限，模糊量非负，扩散可负。支持 none、多阴影、盒阴影独立 elevation-2；不支持 inset。 |
| 布尔值                                     | 缺失保留默认值/继承；裸属性为 true。显式 true/false 忽略首尾空白和大小写，空串、空白、yes、1、0 等报错；补全默认插入 `="true"`，并提供 true/false 候选。                                                              |

复合数值支持正负号、小数及科学计数法（如 `.5`、`2.`、`1e-2`），按 Parser 的浮点范围拒绝 NaN、Infinity 和溢出；不扩展单值数值属性的既有约束，也不增加 px/% 支持。文本阴影的 blurSigma 保留双精度范围。

**兼容性注意：** 旧四值边距元组 `(1,2,3,4)` 等价新 `2 3 4 1`，迁移时不能直接删除括号和逗号。变换按书写顺序右乘，作用到点时右侧先发生：`translate(10,0) scale(2)` 将 `(1,0)` 映射为 `(12,0)`，交换顺序则为 `(22,0)`，LSP 会检查每步合成是否溢出。`boxShadow="0 2 red 4"` 中 4 现在是 blurRadius；重复颜色/模式报错。无效布尔文本现在是错误，不再默认为 false；需要关闭的属性应显式写 false。

复合属性补全提供新简写的完整值示例；文本装饰补全按当前列表项替换并排除重复项，保留其余项。属性补全和 hover 说明旧元组顺序、矩阵顺序、角度单位与裸布尔含义。正文、URL、字体名和 OpenType 标签不会套用枚举规范化；fontFeatures 只有 NONE 支持大小写别名，完整 OpenType 标签语法仍由 Parser 检查。

## 开发

要求 Node.js 22+。

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm test
pnpm run build
node dist/node.js --stdio
```

更新 Snapshot 源码后，从本仓库执行 `pnpm run sync:catalog`。默认读取同级 `../snapshot`；也可执行 `node scripts/sync-catalog.mjs <snapshot 仓库路径>`。生成器解析属性定义及其 `copyWith` 引用，将命名值域记录在 `valueType`、复合格式记录在 `syntax` 中，并保留显式枚举规范化及受限候选；遇到无法解析的别名引用会报错。更新后运行测试，核对新属性的类型与取值规则；新增枚举类型时同步更新 `src/value-types.json`，新增复合语法时同步维护格式说明和静态校验器。

## 集成

### VS Code 等桌面客户端

服务端命令为 `snapshot-lsp --stdio`，或者运行包内 `dist/node.js --stdio`。客户端将 `.snapshot` 文件关联到语言 ID `snapshot`，以标准 LSP 的 stdio 传输启动服务即可。已实现 `textDocumentSync`、`completion`、`hover` 和 `publishDiagnostics`。

服务端根据初始化参数中的 `textDocument.completion.completionItem.snippetSupport` 决定属性模板格式：仅显式声明 `true` 时返回 snippet；未声明或为 `false` 时返回普通文本，例如 `width=""`。浏览器 Worker 使用相同的能力协商。

### Monaco / 浏览器 Worker

用打包器构建 Worker 入口：

```ts
import { startBrowserWorkerServer } from '@muedsa/snapshot-lsp/browser';

startBrowserWorkerServer(self);
```

宿主使用支持 Web Worker 传输的 LSP 客户端（如 `monaco-languageclient`）连接该 Worker，并为语言 ID `snapshot` 注册 `.snapshot` 文档。若宿主已有自定义消息传输，可使用 `startBrowserServer(reader, writer)`。

### 直接使用语言核心

```ts
import { SnapshotLanguageService } from '@muedsa/snapshot-lsp';

const service = new SnapshotLanguageService();
const diagnostics = service.diagnostics('<Snapshot><Text>Hello</Text></Snapshot>');
const completions = service.completions('<Snapshot><Co', { line: 0, character: 13 });

// 不解析 snippet 的宿主可显式选择普通文本。
const attributes = service.completions('<Snapshot><Container wi', { line: 0, character: 23 }, undefined, {
  snippetSupport: false,
});
```

`completions(text, position, uri?, options?)` 的 `options` 类型为导出的 `CompletionOptions`。直接调用核心时，`snippetSupport` 默认 `true`，保持已有集成的行为；通过 LSP 连接时由服务端按客户端能力设置。

宿主接受补全时需同时应用 `textEdit` 和可选的 `additionalTextEdits`。多行属性值的补全会使用单行主编辑和不重叠的额外编辑替换整个值，保留引号及周围文档内容。

扩展标签时向构造函数传入 `{ Custom: { mode: 'none', description: '...', attributes: { title: { kind: 'string' } } } }`。目录只描述静态语法，宿主仍需在 Snapshot 的 `WidgetParserManager` 中注册对应解析器。

自定义属性可通过 `valueType` 复用内置值域，例如 `{ kind: 'string', valueType: 'PaintMode' }`；类型名由导出的 `ValueType` 约束，也可用 `values` 显式指定候选。目录查询仅访问自身条目，`constructor`、`toString` 等名称只有显式注册后才被识别。

自定义候选默认区分大小写；仅设置 `values` 或 `valueType` 不会开启枚举别名。可显式设置 `enumAliases: true` 复用内置枚举的规范化，例如 `{ kind: 'string', valueType: 'PaintMode', enumAliases: true }`。使用 `syntax: 'EdgeInsets'` 等可复用复合值校验与填写提示，名称由导出的 `AttributeSyntax` 约束。复合格式中的关键字只表示格式的一部分，不将边框样式或阴影模式当作整个属性的合法值集合。

## 发布到 GitHub Packages

将 `package.json` 的版本更新为新版本，创建并推送同版本标签（例如 `v0.1.0`）。[发布工作流](.github/workflows/publish.yml)会安装锁定依赖、运行测试，再使用仓库的 `GITHUB_TOKEN` 发布 `@muedsa/snapshot-lsp`。标签版本与包版本不一致时，工作流会停止。已发布的版本不能重复发布。

安装 GitHub Packages 中的包时，使用 `@muedsa:registry=https://npm.pkg.github.com` 配置 registry，并按 GitHub Packages 的要求提供读取权限的令牌。

## 与 Snapshot 的关系

语法依据同级 `snapshot/parser` 的 `WidgetParserManager`、各 `WidgetParser` 与 `docs/usage/README.md`。标签和属性区分大小写。Snapshot 对部分未识别属性会静默忽略；本服务将其作为警告提示，帮助发现拼写错误。Snapshot 在 EOF 会自动闭合部分未结束的标签，本服务也允许编辑中的不完整结构。
