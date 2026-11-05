import formats from './attribute-formats.json' with { type: 'json' };
import type { AttributeSpec, AttributeSyntax } from './catalog.js';
import { isCssColor } from './css-color.js';
import { own } from './lookup.js';

const numberPattern = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const elevations = new Set([0, 1, 2, 3, 4, 6, 8, 9, 12, 16, 24]);
const blurModes = new Set(['NORMAL', 'SOLID', 'OUTER', 'INNER']);

export const normalizeEnum = (value: string): string => value.trim().replaceAll('-', '_').toUpperCase();
export const syntaxOf = (attr: AttributeSpec): AttributeSyntax | undefined =>
  attr.syntax ?? (attr.valueType === 'BoxAlignment' ? 'BoxAlignment' : undefined);

/** 复合数值使用 Parser 的 Float 范围；文本阴影 sigma 单独保留 Double 范围。 */
function finiteNumber(value: string, double = false): number | undefined {
  if (!numberPattern.test(value)) return undefined;
  const result = double ? Number(value) : Math.fround(Number(value));
  return Number.isFinite(result) ? result : undefined;
}

export function numericList(value: string, commaSeparated = value.includes(',')): number[] | undefined {
  const parts = commaSeparated ? value.trim().split(',') : value.trim().split(/\s+/);
  const numbers = parts.map((part) => finiteNumber(part.trim()));
  return numbers.every((number) => number !== undefined) ? (numbers as number[]) : undefined;
}

function unparen(value: string): string {
  const text = value.trim();
  return text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1) : text;
}

function pair(value: string): boolean {
  return numericList(unparen(value))?.length === 2;
}

/** 仅在括号外分隔，保留逗号产生的空项；不拆开 CSS 颜色函数。 */
export function splitOutside(value: string, delimiter: ',' | 'space'): string[] | undefined {
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (--depth < 0) return undefined;
    } else if (depth === 0 && (delimiter === ',' ? ch === ',' : /\s/.test(ch))) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return undefined;
  parts.push(value.slice(start).trim());
  return delimiter === 'space' ? parts.filter(Boolean) : parts;
}

function validMatrix(value: string): boolean {
  const text = value.trim();
  if (text.toLowerCase() === 'none') return true;
  if (!/^[A-Za-z]/.test(text)) return numericList(unparen(text))?.length === 16;
  // 函数都在二维平面上作用；按 Matrix44CMO 的 Float 运算顺序检查每步合成溢出。
  const f = Math.fround;
  const mul = (a: number, b: number) => f(a * b);
  const add = (a: number, b: number) => f(a + b);
  let a = 1,
    b = 0,
    c = 0,
    d = 1,
    tx = 0,
    ty = 0;
  const functionPattern = /([A-Za-z]+)\s*\(([^()]*)\)/y;
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) {
      index++;
      continue;
    }
    functionPattern.lastIndex = index;
    const match = functionPattern.exec(text);
    if (!match) return false;
    const name = match[1].toLowerCase();
    const args = match[2].trim();
    if (name === 'translate' || name === 'scale') {
      const numbers = numericList(args);
      if (!numbers || numbers.length < 1 || numbers.length > 2) return false;
      const x = numbers[0],
        y = numbers[1] ?? (name === 'scale' ? x : 0);
      if (name === 'translate') {
        tx = add(add(mul(a, x), mul(c, y)), tx);
        ty = add(add(mul(b, x), mul(d, y)), ty);
      } else {
        a = mul(a, x);
        b = mul(b, x);
        c = mul(c, y);
        d = mul(d, y);
      }
    } else if (name === 'rotate') {
      const angle = /^(.+?)(deg|rad)$/i.exec(args);
      const numbers = angle && numericList(angle[1], false);
      if (!angle || !numbers || numbers.length !== 1) return false;
      const radians = angle[2].toLowerCase() === 'deg' ? f((numbers[0] * Math.PI) / 180) : numbers[0];
      const cos = f(Math.cos(radians)),
        sin = f(Math.sin(radians));
      [a, b, c, d] = [
        add(mul(a, cos), mul(c, sin)),
        add(mul(b, cos), mul(d, sin)),
        add(mul(a, -sin), mul(c, cos)),
        add(mul(b, -sin), mul(d, cos)),
      ];
    } else return false;
    if (![a, b, c, d, tx, ty].every(Number.isFinite)) return false;
    index = functionPattern.lastIndex;
  }
  return true;
}

function validShadow(value: string, box: boolean): boolean {
  const keyword = normalizeEnum(value);
  if (box && keyword.startsWith('ELEVATION_')) {
    const match = /^ELEVATION_([0-9]+)$/.exec(keyword);
    return !!match && elevations.has(Number(match[1]));
  }
  const entries = splitOutside(value, ',');
  if (!entries?.length || entries.some((entry) => !entry)) return false;
  if (entries.some((entry) => normalizeEnum(entry) === 'NONE')) return entries.length === 1;
  return entries.every((entry) => {
    const tokens = splitOutside(entry, 'space');
    if (!tokens || tokens.length < 2 || tokens.length > (box ? 6 : 4)) return false;
    if (tokens.slice(0, 2).some((token) => finiteNumber(token) === undefined)) return false;
    let colors = 0,
      modes = 0;
    const radii: number[] = [];
    for (const token of tokens.slice(2)) {
      if (numberPattern.test(token)) {
        const number = finiteNumber(token, !box);
        if (number === undefined || radii.length >= (box ? 2 : 1)) return false;
        radii.push(number);
      } else if (isCssColor(token)) {
        if (++colors > 1) return false;
      } else if (box && blurModes.has(normalizeEnum(token))) {
        if (++modes > 1) return false;
      } else return false;
    }
    return (radii[0] ?? 0) >= 0;
  });
}

export function validSyntax(value: string, syntax: AttributeSyntax): boolean {
  const text = value.trim();
  switch (syntax) {
    case 'EdgeInsets': {
      const tuple = text.startsWith('(') && text.endsWith(')');
      const numbers = numericList(tuple ? text.slice(1, -1) : text, tuple);
      return (
        !!numbers && (tuple ? numbers.length === 2 || numbers.length === 4 : numbers.length >= 1 && numbers.length <= 4)
      );
    }
    case 'BoxAlignment':
    case 'Offset':
      return pair(text);
    case 'Radius': {
      if (text.startsWith('(') && text.endsWith(')')) return pair(text);
      const axes = text.split('/');
      return axes.length <= 2 && axes.every((axis) => numericList(axis, false)?.length === 1);
    }
    case 'Matrix44CMO':
      return validMatrix(text);
    case 'FontFamily':
      return text.split(',').every((font) => font.trim().length > 0);
    case 'BorderSide': {
      if (text.toLowerCase() === 'none') return true;
      const tokens = splitOutside(text, 'space');
      return (
        !!tokens &&
        (tokens.length === 2 || tokens.length === 3) &&
        finiteNumber(tokens[0]) !== undefined &&
        (tokens.length === 2 || ['NONE', 'SOLID'].includes(normalizeEnum(tokens[1]))) &&
        isCssColor(tokens.at(-1)!)
      );
    }
    case 'FloatList':
      return numericList(text) !== undefined;
    case 'ColorList': {
      const colors = splitOutside(text, ',');
      return !!colors && colors.length >= 2 && colors.every(isCssColor);
    }
    case 'TextDecoration': {
      const names = (text.includes(',') ? text.split(',') : text.split(/\s+/)).map(normalizeEnum);
      return (
        new Set(names).size === names.length &&
        names.every((name) => ['NONE', 'UNDERLINE', 'OVERLINE', 'LINE_THROUGH'].includes(name)) &&
        (!names.includes('NONE') || names.length === 1)
      );
    }
    case 'BoxShadow':
      return validShadow(text, true);
    case 'TextShadow':
      return validShadow(text, false);
    case 'FontFeatureList': {
      const tokens = text.split(/\s+/);
      return !!text && (!tokens.some((token) => normalizeEnum(token) === 'NONE') || tokens.length === 1);
    }
  }
}

export function attributeFormat(attr: AttributeSpec): { format: string; examples: readonly string[] } | undefined {
  if (attr.kind === 'boolean')
    return {
      format:
        '布尔值 true / false，忽略首尾空白和大小写；裸属性表示 true，未提供时使用默认值或保留继承；显式空字符串、空白和其他文本均报错。',
      examples: ['true', 'false'],
    };
  const syntax = syntaxOf(attr);
  return syntax
    ? own(formats, syntax)
    : attr.enumAliases
      ? {
          format: '枚举忽略首尾空白和大小写，连字符可代替下划线。',
          examples: [],
        }
      : undefined;
}

export function valueMatches(attr: AttributeSpec, value: string, prefix: string): boolean {
  const keyword = attr.syntax && /^(?:none|elevation[_-][0-9]+)$/i.test(value);
  return attr.enumAliases || attr.kind === 'boolean' || keyword
    ? normalizeEnum(value).startsWith(normalizeEnum(prefix))
    : attr.syntax === 'Matrix44CMO'
      ? value.toLowerCase().startsWith(prefix.trimStart().toLowerCase())
      : value.startsWith(prefix);
}

export function valueCandidates(attr: AttributeSpec): readonly string[] {
  // 具有值域的属性优先给出枚举，复合语法示例单独作为可替换的完整值。
  return attr.values ?? attributeFormat(attr)?.examples ?? [];
}
