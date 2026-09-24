import generated from './catalog.generated.json' with { type: 'json' };

export type ValueKind = 'string' | 'color' | 'boolean' | 'integer' | 'number';
export interface AttributeSpec { kind: ValueKind; required?: boolean; values?: readonly string[] }
export interface TagSpec { mode: 'none' | 'single' | 'multiple'; description: string; attributes: Record<string, AttributeSpec> }

/** 与 Snapshot parser 的默认 WidgetParserManager 对应的静态目录。 */
export const tags: Record<string, TagSpec> = generated as Record<string, TagSpec>;

const values: Record<string, readonly string[]> = {
  type: ['png', 'jpg', 'webp'],
  direction: ['HORIZONTAL', 'VERTICAL'],
  shape: ['RECTANGLE', 'CIRCLE'],
  gradientType: ['LINEAR', 'RADIAL', 'SWEEP'],
  softWrap: ['true', 'false'],
  debug: ['true', 'false'],
  raw: ['true', 'false'],
  noCache: ['true', 'false'],
  mainAxisAlignment: ['START', 'END', 'CENTER', 'SPACE_BETWEEN', 'SPACE_AROUND', 'SPACE_EVENLY'],
  mainAxisSize: ['MIN', 'MAX'],
  crossAxisAlignment: ['START', 'END', 'CENTER', 'STRETCH', 'BASELINE'],
  verticalDirection: ['UP', 'DOWN'],
  textAlign: ['LEFT', 'RIGHT', 'CENTER', 'JUSTIFY', 'START', 'END'],
  overflow: ['CLIP', 'FADE', 'ELLIPSIS', 'VISIBLE'],
  clipBehavior: ['NONE', 'HARD_EDGE', 'ANTI_ALIAS', 'ANTI_ALIAS_WITH_SAVE_LAYER'],
};
const alignment = ['TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'CENTER_LEFT', 'CENTER', 'CENTER_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT'];
for (const [tagName, spec] of Object.entries(tags)) {
  for (const [attrName, attr] of Object.entries(spec.attributes)) {
    if (attr.kind === 'boolean') attr.values = ['true', 'false'];
    else if (attrName === 'alignment' && tagName !== 'Emoji' && tagName !== 'WidgetSpan') attr.values = alignment;
    else if (attrName.endsWith('Alignment') && attrName !== 'mainAxisAlignment' && attrName !== 'crossAxisAlignment') attr.values = alignment;
    else if (attrName.endsWith('GradientType')) attr.values = values.gradientType;
    else if (values[attrName]) attr.values = values[attrName];
  }
}
for (const name of ['Image', 'Emoji']) tags[name].attributes.fit.values = ['FILL', 'CONTAIN', 'COVER', 'FIT_WIDTH', 'FIT_HEIGHT', 'NONE', 'SCALE_DOWN'];
for (const name of ['Stack', 'IndexedStack']) tags[name].attributes.fit.values = ['LOOSE', 'EXPAND', 'PASSTHROUGH'];
tags.Flexible.attributes.fit.values = ['LOOSE', 'TIGHT'];
tags.Flex.attributes.direction = { kind: 'string', required: true, values: ['HORIZONTAL', 'VERTICAL'] };
tags.Snapshot.attributes.type.values = values.type;

/** 允许宿主按需扩展/覆盖标签，实例之间不共享可变目录。 */
export function createCatalog(overrides: Record<string, TagSpec> = {}): Record<string, TagSpec> {
  return Object.fromEntries(Object.entries({ ...tags, ...overrides }).map(([name, tag]) => [name, {
    ...tag,
    attributes: Object.fromEntries(Object.entries(tag.attributes).map(([key, attr]) => [key, { ...attr, values: attr.values ? [...attr.values] : undefined }])),
  }]));
}
