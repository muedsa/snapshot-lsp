import type { CompletionItem, Diagnostic, Hover, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createCatalog, type TagSpec } from './catalog.js';
import { parseDocument, type ElementNode } from './parser.js';

export class SnapshotLanguageService {
  readonly catalog: Record<string, TagSpec>;

  constructor(overrides: Record<string, TagSpec> = {}) {
    this.catalog = createCatalog(overrides);
  }

  private document(text: string, uri: string): TextDocument {
    return TextDocument.create(uri, 'snapshot', 1, text);
  }

  diagnostics(text: string, uri = 'file:///document.snapshot'): Diagnostic[] {
    return parseDocument(this.document(text, uri), this.catalog).diagnostics;
  }

  completions(text: string, position: Position, uri = 'file:///document.snapshot'): CompletionItem[] {
    const document = this.document(text, uri), offset = document.offsetAt(position);
    const parsed = parseDocument(document, this.catalog);
    const before = text.slice(0, offset);
    const closing = /<\/([A-Za-z0-9:_-]*)$/.exec(before);
    if (closing) {
      const open = parsed.elements.filter((n) => n.start < offset && n.openEnd <= offset && n.end >= offset && !n.selfClosing).at(-1);
      return open ? [{ label: open.name, kind: 10, textEdit: { range: replaceRange(document, offset - closing[1].length, offset), newText: open.name } }] : [];
    }
    const opening = /<([A-Za-z0-9:_-]*)$/.exec(before);
    if (opening) {
      const openingStart = offset - opening[0].length;
      const parent = parsed.elements.filter((n) => n.start < openingStart && n.openEnd <= offset && n.end >= offset && !n.selfClosing).at(-1);
      if (parent && (this.catalog[parent.name]?.mode === 'none' || (this.catalog[parent.name]?.mode === 'single' && parent.children.some((child) => child.start < openingStart)))) return [];
      const allowed = parent ? Object.keys(this.catalog).filter((name) => allowedChild(parent.name, name)) : ['Snapshot'];
      return allowed.filter((name) => name.startsWith(opening[1])).map((name) => ({ label: name, kind: 7, detail: this.catalog[name].description, textEdit: { range: replaceRange(document, offset - opening[1].length, offset), newText: name } }));
    }
    const tag = parsed.elements.findLast((n) => n.start < offset && n.nameEnd <= offset && n.openEnd >= offset);
    if (!tag) return [];
    const spec = this.catalog[tag.name];
    if (!spec) return [];
    const valueAttr = tag.attributes.find((a) => a.valueStart !== undefined && a.valueStart <= offset && offset <= (a.valueEnd ?? -1));
    if (valueAttr) {
      const prefix = text.slice(valueAttr.valueStart, offset);
      return (spec.attributes[valueAttr.name]?.values ?? []).filter((value) => value.startsWith(prefix)).map((value) => ({ label: value, kind: 12, textEdit: { range: replaceRange(document, valueAttr.valueStart!, valueAttr.valueEnd!), newText: value } }));
    }
    const prefix = /[A-Za-z0-9:_-]*$/.exec(before)?.[0] ?? '';
    const existing = new Set(tag.attributes.filter((attr) => !(attr.start <= offset && offset <= attr.end)).map((attr) => attr.name));
    return Object.entries(spec.attributes).filter(([name]) => name.startsWith(prefix) && !existing.has(name)).map(([name, attr]) => ({
      label: name, kind: 10, detail: attr.required ? '必填属性' : attr.kind,
      insertTextFormat: 2,
      textEdit: { range: replaceRange(document, offset - prefix.length, offset), newText: `${name}="\${1}"` },
    }));
  }

  hover(text: string, position: Position, uri = 'file:///document.snapshot'): Hover | null {
    const document = this.document(text, uri), offset = document.offsetAt(position);
    const elements = parseDocument(document, this.catalog).elements;
    const node = elements.find((n) => n.start + 1 <= offset && offset <= n.nameEnd);
    if (node && this.catalog[node.name]) return { contents: { kind: 'markdown', value: `**<${node.name}>**\n\n${this.catalog[node.name].description || 'Snapshot 标签'}` }, range: replaceRange(document, node.start + 1, node.nameEnd) };
    for (const tag of elements) {
      const attr = tag.attributes.find((a) => a.start <= offset && offset <= a.end);
      const spec = attr && this.catalog[tag.name]?.attributes[attr.name];
      if (attr && spec) return { contents: { kind: 'markdown', value: `**${tag.name}.${attr.name}**\n\n类型：${spec.kind}${spec.required ? '，必填' : ''}${spec.values ? `\n\n可选值：${spec.values.join('、')}` : ''}` }, range: replaceRange(document, attr.start, attr.end) };
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
  if (parent === 'WidgetSpan') return !['Raw', 'Emoji', 'WidgetSpan', 'Expanded', 'Flexible', 'Spacer', 'Positioned'].includes(child);
  if (['Raw', 'Emoji', 'WidgetSpan'].includes(child)) return false;
  if (['Expanded', 'Flexible', 'Spacer'].includes(child)) return ['Flex', 'Row', 'Column'].includes(parent);
  if (child === 'Positioned') return ['Stack', 'IndexedStack'].includes(parent);
  return true;
}
