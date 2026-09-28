import names from './css-color-names.generated.json' with { type: 'json' };

const namedColors = new Set<string>(names);
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function finiteNumber(text: string): number | undefined {
  if (!numberPattern.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function channel(text: string): boolean {
  return finiteNumber(text.endsWith('%') ? text.slice(0, -1) : text) !== undefined;
}

function hue(text: string): boolean {
  const lower = text.toLowerCase();
  const suffix = ['turn', 'grad', 'rad', 'deg'].find((unit) => lower.endsWith(unit));
  const number = finiteNumber(suffix ? lower.slice(0, -suffix.length) : lower);
  if (number === undefined) return false;
  const multiplier = suffix === 'turn' ? 360 : suffix === 'grad' ? 0.9 : suffix === 'rad' ? 180 / Math.PI : 1;
  return Number.isFinite(number * multiplier);
}

function functionColor(text: string): boolean {
  const open = text.indexOf('(');
  if (open < 1 || !text.endsWith(')')) return false;
  const name = text.slice(0, open).toLowerCase();
  if (!['rgb', 'rgba', 'hsl', 'hsla'].includes(name)) return false;
  const body = text.slice(open + 1, -1);
  if (/[()]/.test(body)) return false;
  let channels: string[];
  let alpha: string | undefined;
  if (body.includes(',')) {
    if (body.includes('/')) return false;
    const parts = body.split(',').map((part) => part.trim());
    if (parts.length < 3 || parts.length > 4) return false;
    channels = parts.slice(0, 3);
    alpha = parts[3];
  } else {
    const parts = body.split('/').map((part) => part.trim());
    if (parts.length > 2) return false;
    channels = parts[0].split(/\s+/);
    alpha = parts[1];
  }
  if (channels.length !== 3 || channels.some((part) => !part) || (alpha !== undefined && !alpha)) return false;
  if (alpha !== undefined && !channel(alpha)) return false;
  if (name === 'rgb' || name === 'rgba') return channels.every(channel);
  return hue(channels[0]) && channels.slice(1).every((part) => part.endsWith('%') && channel(part));
}

/** 与 Snapshot parser 当前支持的 CSS 颜色语法保持一致。 */
export function isCssColor(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith('#')) return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(text);
  const lower = text.toLowerCase();
  return lower === 'transparent' || namedColors.has(lower) || functionColor(text);
}
