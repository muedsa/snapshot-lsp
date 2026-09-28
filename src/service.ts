import type { CompletionItem, Diagnostic, Hover, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createCatalog, type TagSpec } from './catalog.js';
import { parseDocument, type ParseResult } from './parser.js';

interface Analysis {
  text: string;
  document: TextDocument;
  parsed: ParseResult;
}

export class SnapshotLanguageService {
  readonly catalog: Record<string, TagSpec>;
  private readonly analyses = new Map<string, Analysis>();

  constructor(overrides: Record<string, TagSpec> = {}) {
    this.catalog = createCatalog(overrides);
  }

  private analyze(text: string, uri: string): Analysis {
    const cached = this.analyses.get(uri);
    if (cached?.text === text) return cached;
    const document = TextDocument.create(uri, 'snapshot', 1, text);
    const analysis = { text, document, parsed: parseDocument(document, this.catalog) };
    this.analyses.set(uri, analysis);
    return analysis;
  }

  /** 文档关闭或标签目录被外部修改后，清除对应文档的解析缓存。 */
  release(uri: string): void {
    this.analyses.delete(uri);
  }

  diagnostics(text: string, uri = 'file:///document.snapshot'): Diagnostic[] {
    return this.analyze(text, uri).parsed.diagnostics;
  }

  completions(text: string, position: Position, uri = 'file:///document.snapshot'): CompletionItem[] {
    const { document, parsed } = this.analyze(text, uri);
    const offset = document.offsetAt(position);
    if (
      parsed.ignoredRanges.some(
        ({ start, end, incomplete }) => offset > start && (offset < end || (incomplete && offset === end)),
      )
    )
      return [];
    const token = parsed.tags.findLast(
      ({ nameStart, end, incomplete }) => offset >= nameStart && (offset < end || (incomplete && offset === end)),
    );
    if (!token) return [];
    if (token.closing) {
      if (offset > token.nameEnd) return [];
      const open = parsed.elements
        .filter((n) => n.start < token.start && n.openEnd <= token.start && n.end >= token.start && !n.selfClosing)
        .at(-1);
      return open
        ? [
            {
              label: open.name,
              kind: 10,
              textEdit: {
                range: replaceRange(document, token.nameStart, token.nameEnd),
                newText: open.name + (token.incomplete && token.nameEnd === token.end ? '>' : ''),
              },
            },
          ]
        : [];
    }
    if (offset <= token.nameEnd) {
      const parent =
        token.element?.parent ??
        parsed.elements
          .filter((n) => n.start < token.start && n.openEnd <= token.start && n.end >= token.start && !n.selfClosing)
          .at(-1);
      if (
        parent &&
        (this.catalog[parent.name]?.mode === 'none' ||
          (this.catalog[parent.name]?.mode === 'single' && parent.children.some((child) => child.start < token.start)))
      )
        return [];
      const allowed = parent
        ? Object.keys(this.catalog).filter((name) => allowedChild(parent.name, name))
        : ['Snapshot'];
      const prefix = text.slice(token.nameStart, offset);
      return allowed
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({
          label: name,
          kind: 7,
          detail: this.catalog[name].description,
          textEdit: { range: replaceRange(document, token.nameStart, token.nameEnd), newText: name },
        }));
    }
    const tag = token.element;
    if (!tag) return [];
    const spec = this.catalog[tag.name];
    if (!spec) return [];
    const valueAttr = tag.attributes.find(
      (a) => a.valueStart !== undefined && a.valueStart <= offset && offset <= (a.valueEnd ?? -1),
    );
    if (valueAttr) {
      const prefix = text.slice(valueAttr.valueStart, offset);
      return (spec.attributes[valueAttr.name]?.values ?? [])
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({
          label: value,
          kind: 12,
          textEdit: { range: replaceRange(document, valueAttr.valueStart!, valueAttr.valueEnd!), newText: value },
        }));
    }
    const editingName = tag.attributes.find((attr) => attr.start <= offset && offset <= attr.end);
    const prefix = editingName
      ? text.slice(editingName.start, offset)
      : (/[A-Za-z0-9:_-]*$/.exec(text.slice(tag.nameEnd, offset))?.[0] ?? '');
    const existing = new Set(tag.attributes.filter((attr) => attr !== editingName).map((attr) => attr.name));
    return Object.entries(spec.attributes)
      .filter(([name]) => name.startsWith(prefix) && !existing.has(name))
      .map(([name, attr]) => ({
        label: name,
        kind: 10,
        detail: attr.required ? '必填属性' : attr.kind,
        insertTextFormat: 2,
        textEdit: {
          range: replaceRange(document, editingName?.start ?? offset - prefix.length, editingName?.end ?? offset),
          newText: `${name}="\${1}"`,
        },
      }));
  }

  hover(text: string, position: Position, uri = 'file:///document.snapshot'): Hover | null {
    const { document, parsed } = this.analyze(text, uri);
    const offset = document.offsetAt(position);
    const elements = parsed.elements;
    const node = elements.find((n) => n.start + 1 <= offset && offset <= n.nameEnd);
    if (node && this.catalog[node.name])
      return {
        contents: {
          kind: 'markdown',
          value: `**<${node.name}>**\n\n${this.catalog[node.name].description || 'Snapshot 标签'}`,
        },
        range: replaceRange(document, node.start + 1, node.nameEnd),
      };
    for (const tag of elements) {
      const attr = tag.attributes.find((a) => a.start <= offset && offset <= a.end);
      const spec = attr && this.catalog[tag.name]?.attributes[attr.name];
      if (attr && spec)
        return {
          contents: {
            kind: 'markdown',
            value: `**${tag.name}.${attr.name}**\n\n类型：${spec.kind}${spec.required ? '，必填' : ''}${spec.values ? `\n\n可选值：${spec.values.join('、')}` : ''}`,
          },
          range: replaceRange(document, attr.start, attr.end),
        };
    }
    return null;
  }
}

function replaceRange(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

function allowedChild(parent: string, child: string): boolean {
  if (child === 'Snapshot') return false;
  if (['Text', 'Raw'].includes(parent)) return ['Text', 'Raw', 'Emoji', 'WidgetSpan'].includes(child);
  if (parent === 'WidgetSpan')
    return !['Raw', 'Emoji', 'WidgetSpan', 'Expanded', 'Flexible', 'Spacer', 'Positioned'].includes(child);
  if (['Raw', 'Emoji', 'WidgetSpan'].includes(child)) return false;
  if (['Expanded', 'Flexible', 'Spacer'].includes(child)) return ['Flex', 'Row', 'Column'].includes(parent);
  if (child === 'Positioned') return ['Stack', 'IndexedStack'].includes(parent);
  return true;
}
