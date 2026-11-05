import test from 'node:test';
import assert from 'node:assert/strict';
import { declarations } from '../scripts/catalog-definitions.mjs';
import generated from '../src/catalog.generated.json' with { type: 'json' };
import valueTypes from '../src/value-types.json' with { type: 'json' };
import attributeFormats from '../src/attribute-formats.json' with { type: 'json' };
import { SnapshotLanguageService } from '../dist/index.js';

test('目录生成器保留公共、本地和具名 copyWith 的属性类型', () => {
  const common = declarations(`
    val COLOR_N = NullableColorAttrDefine(name = "color")
    val WIDTH = RequiredFloatAttrDefine("width")
    val ALIGNMENT = AlignmentAttrDefine("alignment")
  `);
  const aliases = declarations(
    `
    val COLOR = CommonAttrDefine.COLOR_N.copyWith("foregroundColor")
    val BACKGROUND = COLOR.copyWith(name = "backgroundColor")
    val SIZE = CommonAttrDefine.WIDTH.copyWith(name = "size")
    val ALIGN = CommonAttrDefine.ALIGNMENT.copyWith(name = "imageAlignment")
    val MODE = NullableEnumAttrDefine("foregroundMode", PaintMode::valueOf)
  `,
    common,
  );
  assert.equal(aliases.get('COLOR').kind, 'color');
  assert.equal(aliases.get('BACKGROUND').kind, 'color');
  assert.equal(aliases.get('SIZE').kind, 'number');
  assert.equal(aliases.get('SIZE').required, true);
  assert.equal(aliases.get('ALIGN').valueType, 'BoxAlignment');
  assert.equal(aliases.get('MODE').valueType, 'PaintMode');
  assert.throws(
    () => declarations('val COLOR = CommonAttrDefine.MISSING.copyWith("color")', common),
    /无法解析属性别名/,
  );
});

test('生成目录的类型元数据与运行时枚举映射完整且一致', () => {
  const service = new SnapshotLanguageService();
  const coveredTypes = new Set();
  for (const [tag, spec] of Object.entries(generated)) {
    for (const [attr, definition] of Object.entries(spec.attributes)) {
      if (!definition.valueType) continue;
      coveredTypes.add(definition.valueType);
      assert.ok(Object.hasOwn(valueTypes, definition.valueType), `${tag}.${attr}`);
      assert.deepEqual(
        service.catalog[tag].attributes[attr].values,
        valueTypes[definition.valueType],
        `${tag}.${attr}`,
      );
    }
  }
  assert.deepEqual([...coveredTypes].sort(), Object.keys(valueTypes).sort());
  for (const tag of ['Text', 'Raw', 'WidgetSpan'])
    for (const attr of ['decorationColor', 'foregroundColor', 'backgroundColor'])
      assert.equal(generated[tag].attributes[attr].kind, 'color', `${tag}.${attr}`);
});

test('自定义属性可复用值域且实例间不共享枚举数组', () => {
  const overrides = {
    Custom: { mode: 'none', description: '', attributes: { mode: { kind: 'string', valueType: 'PaintMode' } } },
  };
  const first = new SnapshotLanguageService(overrides);
  const second = new SnapshotLanguageService(overrides);
  assert.deepEqual(first.catalog.Custom.attributes.mode.values, ['FILL', 'STROKE', 'STROKE_AND_FILL']);
  first.catalog.Custom.attributes.mode.values.push('CUSTOM');
  assert.ok(!second.catalog.Custom.attributes.mode.values.includes('CUSTOM'));
  assert.equal(overrides.Custom.attributes.mode.values, undefined);
});

test('生成器保留复合语法、受限字符串候选与显式枚举 normalizer', () => {
  const common = declarations(`
    val PADDING = EdgeInsetsAttrDefine("padding")
    val BORDER = NullableBorderSideAttrDefine("border")
    val FONT = NullableStringAttrDefine("fontFamily")
  `);
  const aliases = declarations(
    `
    val MARGIN = CommonAttrDefine.PADDING.copyWith("margin")
    val SIDE = CommonAttrDefine.BORDER.copyWith("foregroundBorderLeft")
    val STRUT = CommonAttrDefine.FONT.copyWith("strutFontFamily")
    val FIT = StringAttrDefine("fit", "FILL", AttributeValueInfo.enumNames(listOf("FILL", "CONTAIN")), EnumAttributeSyntax::normalize) { _, _ -> }
    val CUSTOM = StringAttrDefine("custom", "A", AttributeValueInfo.enumNames(listOf("A", "B"))) { _, _ -> }
    val MODE = NullableEnumAttrDefine("mode", AttributeValueInfo.enum(PaintMode.entries), EnumAttributeSyntax::normalize, PaintMode::valueOf)
    val RAW_MODE = NullableEnumAttrDefine("rawMode", AttributeValueInfo.enum(PaintMode.entries), PaintMode::valueOf)
  `,
    common,
  );
  assert.equal(aliases.get('MARGIN').syntax, 'EdgeInsets');
  assert.equal(aliases.get('SIDE').syntax, 'BorderSide');
  assert.equal(aliases.get('STRUT').syntax, 'FontFamily');
  assert.deepEqual(aliases.get('FIT').values, ['FILL', 'CONTAIN']);
  assert.equal(aliases.get('FIT').enumAliases, true);
  assert.equal(aliases.get('CUSTOM').enumAliases, undefined);
  assert.equal(aliases.get('MODE').enumAliases, true);
  assert.equal(aliases.get('RAW_MODE').enumAliases, undefined);
});

test('复合语法元数据覆盖全部格式、别名和 ClipPath 的受限候选', () => {
  const syntaxes = new Set();
  for (const tag of Object.values(generated))
    for (const attr of Object.values(tag.attributes)) {
      if (attr.syntax) {
        assert.ok(Object.hasOwn(attributeFormats, attr.syntax));
        syntaxes.add(attr.syntax);
      }
    }
  assert.deepEqual([...syntaxes].sort(), Object.keys(attributeFormats).sort());
  assert.deepEqual(generated.ClipPath.attributes.fit.values, ['FILL', 'CONTAIN']);
  assert.deepEqual(generated.ClipPath.attributes.fillRule.values, ['NON_ZERO', 'EVEN_ODD']);
  assert.deepEqual(generated.Snapshot.attributes.type.values, ['png', 'jpg', 'webp']);
  assert.equal(generated.Text.attributes.strutFontFamily.syntax, 'FontFamily');
  assert.equal(generated.Container.attributes.foregroundBoxShadow.syntax, 'BoxShadow');
  assert.equal(generated.Container.attributes.foregroundBorderRadius.syntax, 'Radius');
  assert.equal(generated.Container.attributes.foregroundGradientStops.syntax, 'FloatList');
});
