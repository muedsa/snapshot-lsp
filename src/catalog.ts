import generated from './catalog.generated.json' with { type: 'json' };
import valueTypes from './value-types.json' with { type: 'json' };
import attributeFormats from './attribute-formats.json' with { type: 'json' };
import { own } from './lookup.js';

export type ValueKind = 'string' | 'color' | 'boolean' | 'integer' | 'number';
export type ValueType = keyof typeof valueTypes;
export type AttributeSyntax = keyof typeof attributeFormats;
export interface AttributeSpec {
  kind: ValueKind;
  required?: boolean;
  /** Parser 属性类型对应的值域，别名共享相同的枚举与特殊语法。 */
  valueType?: ValueType;
  values?: readonly string[];
  /** 复合格式的静态语法；不将格式内部的关键字当成整个值的候选限制。 */
  syntax?: AttributeSyntax;
  /** 显式启用内置枚举的 trim、大小写及连字符别名；自定义候选默认区分大小写。 */
  enumAliases?: boolean;
}
export interface TagSpec {
  mode: 'none' | 'single' | 'multiple';
  description: string;
  attributes: Record<string, AttributeSpec>;
}

/** 与 Snapshot parser 的默认 WidgetParserManager 对应的静态目录。 */
export const tags: Record<string, TagSpec> = generated as Record<string, TagSpec>;

function valuesFor(attr: AttributeSpec): readonly string[] | undefined {
  return (
    attr.values ??
    (attr.kind === 'boolean' ? ['true', 'false'] : attr.valueType ? own(valueTypes, attr.valueType) : undefined)
  );
}
for (const spec of Object.values(tags))
  for (const attr of Object.values(spec.attributes)) attr.values = valuesFor(attr);

/** 允许宿主按需扩展/覆盖标签，实例之间不共享可变目录。 */
export function createCatalog(overrides: Record<string, TagSpec> = {}): Record<string, TagSpec> {
  return Object.fromEntries(
    Object.entries({ ...tags, ...overrides }).map(([name, tag]) => [
      name,
      {
        ...tag,
        attributes: Object.fromEntries(
          Object.entries(tag.attributes).map(([key, attr]) => {
            const values = valuesFor(attr);
            return [key, { ...attr, values: values ? [...values] : undefined }];
          }),
        ),
      },
    ]),
  );
}
