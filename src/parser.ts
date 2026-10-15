import type { Diagnostic } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { TagSpec } from './catalog.js';
import { isCssColor } from './css-color.js';
import { own } from './lookup.js';

export interface AttributeNode {
  name: string;
  start: number;
  end: number;
  /** 整个属性的结束偏移，包含赋值和闭合引号，不包含尾随空白。end 仍为名称结束偏移。 */
  syntaxEnd?: number;
  value?: string;
  valueStart?: number;
  valueEnd?: number;
}
export interface ElementNode {
  name: string;
  start: number;
  nameEnd: number;
  openEnd: number;
  end: number;
  selfClosing: boolean;
  incomplete: boolean;
  closed: boolean;
  attributes: AttributeNode[];
  parent?: ElementNode;
  children: ElementNode[];
}
export interface TagToken {
  start: number;
  nameStart: number;
  nameEnd: number;
  end: number;
  name: string;
  closing: boolean;
  incomplete: boolean;
  /** 扫描到标签起始位置时仍打开的父节点，包含空名称标签的上下文。 */
  parent?: ElementNode;
  element?: ElementNode;
}
export interface IgnoredRange {
  start: number;
  end: number;
  incomplete: boolean;
}
export interface ParseResult {
  elements: ElementNode[];
  roots: ElementNode[];
  tags: TagToken[];
  ignoredRanges: IgnoredRange[];
  diagnostics: Diagnostic[];
}
type Issue = { start: number; end: number; message: string; severity?: 1 | 2; code: string };
const viewBoxNumber = '[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?';
const viewBoxSpace = '[ \\t\\r\\n]';
const viewBoxSeparator = `(?:${viewBoxSpace}+|${viewBoxSpace}*,${viewBoxSpace}*)`;
const viewBoxPattern = new RegExp(
  `^${viewBoxSpace}*(${viewBoxNumber})${viewBoxSeparator}(${viewBoxNumber})${viewBoxSeparator}(${viewBoxNumber})${viewBoxSeparator}(${viewBoxNumber})${viewBoxSpace}*$`,
);

function validViewBox(value: string): boolean {
  const match = viewBoxPattern.exec(value);
  if (!match) return false;
  const numbers = match.slice(1).map((text) => Math.fround(Number(text)));
  return numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0;
}

function parseAttributes(
  source: string,
  from: number,
  to: number,
): { attributes: AttributeNode[]; selfClosing: boolean } {
  const attrs: AttributeNode[] = [];
  let i = from;
  let selfClosing = false;
  while (i < to) {
    while (i < to && /\s/.test(source[i])) i++;
    if (i >= to) break;
    if (source[i] === '/') {
      selfClosing = source[to] === '>' && /^\/\s*$/.test(source.slice(i, to));
      break;
    }
    const start = i;
    while (i < to && !/[\s=/>]/.test(source[i])) i++;
    if (i === start) {
      i++;
      continue;
    }
    const name = source.slice(start, i);
    const end = i;
    while (i < to && /\s/.test(source[i])) i++;
    if (source[i] !== '=') {
      attrs.push({ name, start, end, syntaxEnd: end });
      continue;
    }
    i++;
    while (i < to && /\s/.test(source[i])) i++;
    const quote = source[i] === '"' || source[i] === "'" ? source[i++] : undefined;
    const valueStart = i;
    if (quote) {
      while (i < to && source[i] !== quote) i++;
    } else {
      // Snapshot 的无引号值允许 /；只有值外的 / 才表示自闭合。
      while (i < to && !/[\s>]/.test(source[i])) i++;
    }
    const valueEnd = i;
    if (quote && source[i] === quote) i++;
    attrs.push({ name, start, end, syntaxEnd: i, value: source.slice(valueStart, valueEnd), valueStart, valueEnd });
  }
  return { attributes: attrs, selfClosing };
}

/** 容错扫描器：保留未完成标签，供编辑期间补全使用。 */
export function parseDocument(document: TextDocument, catalog: Record<string, TagSpec>): ParseResult {
  const source = document.getText();
  const elements: ElementNode[] = [],
    roots: ElementNode[] = [],
    tags: TagToken[] = [],
    ignoredRanges: IgnoredRange[] = [],
    issues: Issue[] = [],
    stack: ElementNode[] = [];
  const namePattern = /[A-Za-z][A-Za-z0-9:_-]*/y;
  const issue = (start: number, end: number, code: string, message: string, severity: 1 | 2 = 1) =>
    issues.push({ start, end: Math.max(start + 1, end), code, message, severity });
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const textEnd = lt < 0 ? source.length : lt;
    if (textEnd > i && source.slice(i, textEnd).trim() && !['Text', 'Raw'].includes(stack.at(-1)?.name ?? '')) {
      issue(i, textEnd, 'unexpected-text', '此标签内不支持直接文本');
    }
    if (lt < 0) break;
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      if (end < 0) issue(lt, source.length, 'unclosed-comment', '注释缺少 -->');
      ignoredRanges.push({ start: lt, end: end < 0 ? source.length : end + 3, incomplete: end < 0 });
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      if (end < 0) issue(lt, source.length, 'unclosed-cdata', 'CDATA 缺少 ]]>');
      ignoredRanges.push({ start: lt, end: end < 0 ? source.length : end + 3, incomplete: end < 0 });
      if (!['Text', 'Raw'].includes(stack.at(-1)?.name ?? ''))
        issue(lt, end < 0 ? source.length : end + 3, 'unexpected-text', '此标签内不支持 CDATA 文本');
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt + 2);
      issue(lt, end < 0 ? source.length : end + 1, 'unsupported-markup', 'Snapshot 不支持此标记');
      ignoredRanges.push({ start: lt, end: end < 0 ? source.length : end + 1, incomplete: end < 0 });
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    let cursor = lt + 1;
    const closing = source[cursor] === '/';
    if (closing) cursor++;
    namePattern.lastIndex = cursor;
    const match = namePattern.exec(source);
    if (!match && cursor < source.length && !/[\s<>/]/.test(source[cursor])) {
      i = lt + 1;
      continue;
    }
    const name = match?.[0] ?? '',
      nameStart = cursor;
    cursor += name.length;
    let end = cursor,
      quote: string | undefined;
    while (end < source.length) {
      const ch = source[end];
      if (quote) {
        if (ch === quote) quote = undefined;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>' || ch === '<') break;
      end++;
    }
    const incomplete = source[end] !== '>';
    const tagEnd = incomplete ? end : end + 1;
    const token: TagToken = {
      start: lt,
      nameStart,
      nameEnd: cursor,
      end: tagEnd,
      name,
      closing,
      incomplete,
      parent: stack.at(-1),
    };
    tags.push(token);
    // 空名称只保留补全 token，不参与 AST、父子关系和诊断。
    if (!name) {
      i = tagEnd;
      continue;
    }
    if (closing) {
      const found = stack.findLastIndex((node) => node.name === name);
      if (found >= 0) {
        for (const node of stack.splice(found)) {
          node.end = tagEnd;
          node.closed = !incomplete;
        }
      } else issue(nameStart, cursor, 'unmatched-close', `未找到与 </${name}> 匹配的开始标签`, 2);
    } else {
      const { attributes, selfClosing } = parseAttributes(source, cursor, end);
      const parent = stack.at(-1);
      const node: ElementNode = {
        name,
        start: lt,
        nameEnd: cursor,
        openEnd: tagEnd,
        end: tagEnd,
        selfClosing,
        incomplete,
        closed: selfClosing,
        attributes,
        parent,
        children: [],
      };
      token.element = node;
      elements.push(node);
      if (parent) parent.children.push(node);
      else roots.push(node);
      const spec = own(catalog, name);
      if (!spec) issue(nameStart, cursor, 'unknown-tag', `未知标签 <${name}>`);
      if (!parent && name !== 'Snapshot') issue(nameStart, cursor, 'root-tag', '根标签必须为 Snapshot');
      if (parent) {
        if (name === 'Snapshot') issue(nameStart, cursor, 'root-tag', 'Snapshot 只能作为根标签');
        const parentSpec = own(catalog, parent.name);
        if (parentSpec?.mode === 'none' || (parentSpec?.mode === 'single' && parent.children.length > 1))
          issue(
            nameStart,
            cursor,
            'child-count',
            `<${parent.name}> ${parentSpec.mode === 'none' ? '不能包含子标签' : '最多只能包含一个子标签'}`,
          );
        if (['Expanded', 'Flexible', 'Spacer'].includes(name) && !['Flex', 'Row', 'Column'].includes(parent.name))
          issue(nameStart, cursor, 'invalid-parent', `<${name}> 只能直接位于 Flex、Row 或 Column 下`);
        if (name === 'Positioned' && !['Stack', 'IndexedStack'].includes(parent.name))
          issue(nameStart, cursor, 'invalid-parent', '<Positioned> 只能直接位于 Stack 或 IndexedStack 下');
        if (['Raw', 'Emoji', 'WidgetSpan'].includes(name) && !['Text', 'Raw'].includes(parent.name))
          issue(nameStart, cursor, 'invalid-parent', `<${name}> 只能位于文本内容中`);
        if (['Text', 'Raw'].includes(parent.name) && !['Text', 'Raw', 'Emoji', 'WidgetSpan'].includes(name))
          issue(nameStart, cursor, 'invalid-child', `<${parent.name}> 只能包含行内文本标签`);
      }
      if (spec) validateAttributes(node, spec, issue);
      if (!selfClosing) stack.push(node);
    }
    i = tagEnd;
  }
  for (const node of stack) node.end = source.length;
  if (!roots.length && source.trim() && !source.includes('<'))
    issue(0, source.length, 'missing-root', '文档需要 Snapshot 根标签');
  if (roots.length > 1)
    for (const node of roots.slice(1)) issue(node.start, node.nameEnd, 'duplicate-root', '文档只能有一个根标签');
  for (const node of elements)
    if (node.name === 'Snapshot' && !node.parent && node.closed && node.children.length === 0)
      issue(node.start, node.nameEnd, 'empty-root', '<Snapshot> 必须包含一个子标签');
  for (const node of elements)
    if (node.name === 'WidgetSpan' && !node.incomplete && node.children.length !== 1)
      issue(node.start, node.nameEnd, 'child-count', '<WidgetSpan> 必须包含一个子标签');
  return {
    elements,
    roots,
    tags,
    ignoredRanges,
    diagnostics: issues.map(({ start, end, code, message, severity }) => ({
      range: { start: document.positionAt(start), end: document.positionAt(end) },
      code,
      message,
      severity,
      source: 'snapshot',
    })),
  };
}

function validateAttributes(
  node: ElementNode,
  spec: TagSpec,
  issue: (start: number, end: number, code: string, message: string, severity?: 1 | 2) => void,
): void {
  const seen = new Set<string>();
  for (const attr of node.attributes) {
    if (seen.has(attr.name)) issue(attr.start, attr.end, 'duplicate-attribute', `属性 ${attr.name} 重复`);
    seen.add(attr.name);
    const definition = own(spec.attributes, attr.name);
    if (!definition) {
      issue(attr.start, attr.end, 'unknown-attribute', `<${node.name}> 不支持属性 ${attr.name}`, 2);
      continue;
    }
    if (attr.value === undefined) {
      if (
        !node.incomplete &&
        (definition.required ||
          node.name === 'ClipPath' ||
          (['Image', 'Emoji'].includes(node.name) && ['url', 'dataUri'].includes(attr.name)))
      )
        issue(attr.start, attr.end, 'missing-value', `<${node.name}> 属性 ${attr.name} 需要值`);
      continue;
    }
    const value = attr.value;
    const at = attr.valueStart ?? attr.start,
      until = attr.valueEnd ?? attr.end;
    if (definition.kind === 'color' && !isCssColor(value))
      issue(at, until, 'invalid-color', '颜色应为十六进制、命名颜色或 rgb()/hsl() 等支持的 CSS 颜色值');
    if (node.name === 'ClipPath' && attr.name === 'path' && (!value.trim() || value.includes('\0')))
      issue(at, until, 'invalid-path', 'SVG 路径不能为空或包含 NUL 字符');
    if (node.name === 'ClipPath' && attr.name === 'viewBox' && !validViewBox(value))
      issue(at, until, 'invalid-viewbox', 'viewBox 需要有限的 minX minY width height，且宽高必须大于 0');
    if (definition.kind === 'boolean' && !['true', 'false'].includes(value.toLowerCase()))
      issue(at, until, 'invalid-boolean', '建议使用 true 或 false；Snapshot 会把其他值解析为 false', 2);
    if (definition.kind === 'integer' && !/^[+-]?\d+$/.test(value)) issue(at, until, 'invalid-integer', '这里需要整数');
    if (definition.kind === 'number' && !/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|Infinity|NaN)$/.test(value))
      issue(at, until, 'invalid-number', '这里需要数字');
    if (
      definition.kind !== 'boolean' &&
      definition.values?.length &&
      !definition.values.includes(value) &&
      !(definition.valueType === 'BoxAlignment' && /^\([+-]?(?:\d*\.)?\d+,[+-]?(?:\d*\.)?\d+\)$/.test(value))
    )
      issue(at, until, 'invalid-value', `可选值：${definition.values.join('、')}`);
  }
  if (!node.incomplete)
    for (const [name, definition] of Object.entries(spec.attributes))
      if (definition.required && !seen.has(name))
        issue(node.start, node.nameEnd, 'missing-attribute', `<${node.name}> 缺少必填属性 ${name}`);
  if (['Image', 'Emoji'].includes(node.name) && !node.incomplete) {
    if (!seen.has('url') && !seen.has('dataUri'))
      issue(node.start, node.nameEnd, 'image-source', `<${node.name}> 需要 url 或 dataUri`);
    if (seen.has('url') && seen.has('dataUri'))
      issue(node.start, node.nameEnd, 'image-source', 'url 和 dataUri 不能同时使用');
    if (seen.has('dataUri') && seen.has('noCache'))
      issue(node.start, node.nameEnd, 'image-source', 'noCache 只能与 url 一起使用');
  }
}
