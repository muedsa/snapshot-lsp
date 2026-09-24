import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 从 Snapshot 源码更新静态目录。运行时和发布的包不依赖 Snapshot 仓库。
const snapshot = resolve(process.argv[2] ?? '../snapshot');
const base = resolve(snapshot, 'parser/src/main/kotlin/com/muedsa/snapshot/parser');
const read = (path) => readFileSync(resolve(base, path), 'utf8');
const declarations = (source) => {
  const result = new Map();
  const blocks = source.split(/(?=^\s*(?:private\s+)?val\s+\w+)/m);
  for (const block of blocks) {
    const name = block.match(/^\s*(?:private\s+)?val\s+(\w+)/)?.[1];
    if (!name) continue;
    const value = block.match(/(?:AttrDefine|copyWith)\s*\(\s*(?:name\s*=\s*)?"([^"]+)"/)?.[1];
    if (!value) continue;
    const type = block.match(/(?:\w+\.)?(\w+AttrDefine)\s*\(/)?.[1] ?? 'StringAttrDefine';
    result.set(name, { name: value, kind: kindOf(type), required: type.startsWith('Required') });
  }
  return result;
};
function kindOf(type) {
  if (/Color(?!List)/.test(type)) return 'color';
  if (/Boolean/.test(type)) return 'boolean';
  if (/IntAttr/.test(type)) return 'integer';
  if (/FloatAttr/.test(type)) return 'number';
  return 'string';
}
const common = declarations(read('attr/CommonAttrDefine.kt'));
const docs = readFileSync(resolve(snapshot, 'docs/usage/README.md'), 'utf8');
const tagDocs = new Map();
for (const row of docs.matchAll(/^\| `([A-Za-z]+)` \|[^\n]+/gm)) {
  if (!tagDocs.has(row[1])) tagDocs.set(row[1], row[0].split('|').at(-2)?.trim() ?? '');
}
const manager = read('widget/WidgetParserManager.kt');
const classes = [...manager.matchAll(/\{ (\w+Parser)(?:\(\))? \}/g)].map((m) => m[1]);
const tags = {};
for (const cls of classes) {
  const source = read(`widget/${cls}.kt`);
  const name = source.match(/override val id:\s*String\s*=\s*"([^"]+)"/)?.[1];
  const inherited = cls === 'IndexedStackParser' ? read('widget/StackParser.kt') : '';
  const mode = (source + inherited).match(/override val containerMode:\s*ContainerMode\s*=\s*ContainerMode\.(\w+)/)?.[1]?.toLowerCase();
  if (!name || !mode) throw new Error(`无法读取 ${cls} 的标签声明`);
  const attrs = new Map();
  for (const ref of source.matchAll(/CommonAttrDefine\.(\w+)(?:\.copyWith\s*\(\s*"([^"]+)")?/g)) {
    const definition = common.get(ref[1]);
    if (definition) attrs.set(ref[2] ?? definition.name, { ...definition, name: ref[2] ?? definition.name });
  }
  for (const definition of declarations(source).values()) attrs.set(definition.name, definition);
  if (inherited) {
    for (const ref of inherited.matchAll(/CommonAttrDefine\.(\w+)(?:\.copyWith\s*\(\s*"([^"]+)")?/g)) {
      const definition = common.get(ref[1]);
      if (definition) attrs.set(ref[2] ?? definition.name, { ...definition, name: ref[2] ?? definition.name });
    }
    for (const definition of declarations(inherited).values()) attrs.set(definition.name, definition);
  }
  const add = (definitions, prefix = '') => {
    for (const definition of definitions) {
      const attrName = prefix ? prefix + definition.name[0].toUpperCase() + definition.name.slice(1) : definition.name;
      attrs.set(attrName, { ...definition, name: attrName });
    }
  };
  if (['Border', 'DecoratedBox', 'Container'].includes(name)) {
    const border = ['COLOR_N', 'BORDER_N', 'BORDER_LEFT_N', 'BORDER_TOP_N', 'BORDER_RIGHT_N', 'BORDER_BOTTOM_N', 'BOX_SHAPE', 'BORDER_RADIUS_N', 'BORDER_RADIUS_TOP_LEFT_N', 'BORDER_RADIUS_TOP_RIGHT_N', 'BORDER_RADIUS_BOTTOM_LEFT_N', 'BORDER_RADIUS_BOTTOM_RIGHT_N', 'BOX_SHADOW_N', 'BACKGROUND_BLEND_MODE_N'].map((key) => common.get(key));
    const gradient = [...declarations(read('widget/GradientParser.kt')).values()];
    add([...border, ...gradient]);
    if (name === 'Container') add([...border, ...gradient], 'foreground');
  }
  if (['Image', 'Emoji'].includes(name)) {
    const image = read('widget/InlineSpanParser.kt');
    if (name === 'Emoji') {
      for (const ref of image.matchAll(/CommonAttrDefine\.(\w+)/g)) {
        const d = common.get(ref[1]);
        if (d) attrs.set(d.name, d);
      }
      for (const key of ['imageAlignment', 'colorBlendMode']) attrs.set(key, { name: key, kind: 'string', required: false });
    }
    attrs.set('url', common.get('URL'));
    attrs.set('dataUri', { name: 'dataUri', kind: 'string', required: false });
    if (name === 'Image') attrs.set('colorBlendMode', { name: 'colorBlendMode', kind: 'string', required: false });
    attrs.set('url', { ...attrs.get('url'), required: false }); // url 或 dataUri 二选一
  }
  if (['Text', 'Raw', 'WidgetSpan'].includes(name)) {
    for (const ref of read('widget/TextStyleParser.kt').matchAll(/CommonAttrDefine\.(\w+)/g)) {
      const d = common.get(ref[1]);
      if (d) attrs.set(d.name, d);
    }
    add([...declarations(read('widget/TextParser.kt')).values()].filter((d) => !d.name.startsWith('strut') && !['textAlign', 'textDirection', 'softWrap', 'overflow', 'maxLines', 'textWidthBasis', 'textHeightMode', 'imageAlignment'].includes(d.name)));
    attrs.set('text', { ...common.get('TEXT_N') });
    if (name === 'Text') {
      for (const key of ['textAlign', 'textDirection', 'softWrap', 'overflow', 'maxLines', 'textWidthBasis', 'textHeightMode']) attrs.set(key, declarations(read('widget/TextParser.kt')).get('ATTR_' + key.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()) ?? { name: key, kind: 'string', required: false });
      for (const d of declarations(read('widget/TextParser.kt')).values()) if (d.name.startsWith('strut')) attrs.set(d.name, d);
    }
  }
  if (name === 'Snapshot') {
    for (const d of declarations(read('SnapshotElement.kt')).values()) attrs.set(d.name, d);
  }
  if (name === 'ClipRRect') {
    for (const key of ['BORDER_RADIUS_N', 'BORDER_RADIUS_TOP_LEFT_N', 'BORDER_RADIUS_TOP_RIGHT_N', 'BORDER_RADIUS_BOTTOM_LEFT_N', 'BORDER_RADIUS_BOTTOM_RIGHT_N']) {
      const d = common.get(key); attrs.set(d.name, d);
    }
  }
  if (name === 'BackdropFilter') {
    for (const key of ['sigmaX', 'sigmaY', 'tileMode']) attrs.set(key, { ...({ sigmaX: { name: key, kind: 'number', required: true }, sigmaY: { name: key, kind: 'number', required: true }, tileMode: common.get('FILTER_TILE_MODE') })[key], name: key });
  }
  if (['Expanded', 'Spacer'].includes(name)) attrs.delete('fit');
  if (name === 'Text') attrs.delete('imageAlignment');
  if (['Emoji', 'WidgetSpan'].includes(name)) attrs.delete('text');
  if (name === 'ColoredBox' || name === 'ColorFiltered') attrs.set('color', { ...attrs.get('color'), required: true });
  if (name === 'ColorFiltered') attrs.set('blendMode', { ...attrs.get('blendMode'), required: true });
  if (name === 'WidgetSpan') {
    attrs.set('alignment', { name: 'alignment', kind: 'string', required: false });
    attrs.set('baseline', { name: 'baseline', kind: 'string', required: false });
  }
  if (name === 'Emoji') {
    attrs.set('alignment', { name: 'alignment', kind: 'string', required: false });
    attrs.set('baseline', { name: 'baseline', kind: 'string', required: false });
  }
  tags[name] = { mode, description: tagDocs.get(name) ?? '', attributes: Object.fromEntries([...attrs].sort(([a], [b]) => a.localeCompare(b)).map(([key, d]) => [key, { kind: d.kind, ...(d.required ? { required: true } : {}) }])) };
}
if (Object.keys(tags).length !== 38) throw new Error(`标签数量异常: ${Object.keys(tags).length}`);
writeFileSync(resolve('src/catalog.generated.json'), JSON.stringify(tags, null, 2) + '\n');
console.log(`已更新 ${Object.keys(tags).length} 个标签的静态目录`);
