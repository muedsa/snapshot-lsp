import valueTypes from '../src/value-types.json' with { type: 'json' };

// 保留 CommonAttrDefine 和本地 copyWith 引用的语义，避免别名回落成普通字符串。
export function declarations(source, common = new Map()) {
  const result = new Map();
  const blocks = source.split(/(?=^\s*(?:private\s+)?val\s+\w+)/m);
  for (const block of blocks) {
    const name = block.match(/^\s*(?:private\s+)?val\s+(\w+)/)?.[1];
    if (!name) continue;
    const call = block.match(
      /=\s*(?:(CommonAttrDefine\.)?(\w+)\.copyWith|(\w+AttrDefine))\s*\(\s*(?:name\s*=\s*)?"([^"]+)"/,
    );
    if (!call) continue;
    const [, commonReference, reference, type, value] = call;
    if (reference) {
      const original = (commonReference ? common : result).get(reference);
      if (!original) throw new Error(`无法解析属性别名 ${name} 引用的 ${reference}`);
      result.set(name, { ...original, name: value });
      continue;
    }
    const shortType = type.replace(/^(?:Required|Nullable)/, '').replace(/AttrDefine$/, '');
    const valueType =
      shortType === 'Alignment'
        ? 'BoxAlignment'
        : shortType === 'Baseline'
          ? 'BaselineMode'
          : shortType === 'Enum'
            ? block.match(/(\w+)::valueOf/)?.[1]
            : shortType;
    result.set(name, {
      name: value,
      kind: kindOf(type),
      required: type.startsWith('Required'),
      ...(valueType && Object.hasOwn(valueTypes, valueType) ? { valueType } : {}),
    });
  }
  return result;
}

function kindOf(type) {
  if (/Color(?!List)/.test(type)) return 'color';
  if (/Boolean/.test(type)) return 'boolean';
  if (/IntAttr/.test(type)) return 'integer';
  if (/FloatAttr/.test(type)) return 'number';
  return 'string';
}
