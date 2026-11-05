import test from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { readFileSync } from 'node:fs';
import { SnapshotLanguageService, parseDocument } from '../dist/index.js';

const service = new SnapshotLanguageService();
const wrap = (tag, attr, value) => {
  const element = `<${tag} ${attr}="${value}"${['Image', 'Emoji'].includes(tag) ? ' url="a"' : tag === 'ClipPath' ? ' path="M0 0"' : ''}${tag === 'WidgetSpan' ? '><Container/></WidgetSpan>' : '/>'}`;
  return `<Snapshot>${['Emoji', 'WidgetSpan', 'Raw'].includes(tag) ? `<Text>${element}</Text>` : element}</Snapshot>`;
};
function check(tag, attr, valid, invalid) {
  for (const value of valid)
    assert.deepEqual(service.diagnostics(wrap(tag, attr, value)), [], `${tag}.${attr}=${value}`);
  for (const value of invalid) {
    const text = wrap(tag, attr, value);
    const diagnostics = service.diagnostics(text);
    assert.ok(diagnostics.length, `应拒绝 ${tag}.${attr}=${value}`);
    const document = TextDocument.create('file:///syntax.snapshot', 'snapshot', 1, text);
    assert.ok(
      diagnostics.some(
        (item) =>
          document.offsetAt(item.range.start) === text.indexOf(value, text.indexOf(`${attr}="`) + attr.length + 2),
      ),
      `诊断应定位属性值：${tag}.${attr}=${value}`,
    );
  }
}
function complete(marked, target = service, options = { snippetSupport: false }) {
  const offset = marked.indexOf('|');
  const text = marked.replace('|', '');
  const document = TextDocument.create('file:///syntax.snapshot', 'snapshot', 1, text);
  const items = target.completions(text, document.positionAt(offset), document.uri, options);
  return {
    document,
    items,
    apply: (item) => TextDocument.applyEdits(document, [item.textEdit, ...(item.additionalTextEdits ?? [])]),
  };
}

test('边距支持 CSS 1～4 值简写与旧元组，拒绝混合及非有限数', () => {
  for (const [tag, attr] of [
    ['Padding', 'padding'],
    ['Container', 'margin'],
  ])
    check(
      tag,
      attr,
      ['8', '8 16', '1 2 3', '1 2 3 4', ' .5\t2.\n1e-2 ', '(1,2)', ' ( 1, 2, 3, 4 ) '],
      ['', '1,2,3,4', '(1,2,3)', '(1 2)', '1 2 3 4 5', '(1,,2,3)', '1px', 'NaN', 'Infinity', '1e100'],
    );
});

test('坐标支持两种分隔和可选括号，所有 BoxAlignment 别名及 origin 同步', () => {
  for (const [tag, attr] of [
    ['Container', 'alignment'],
    ['Container', 'transformAlignment'],
    ['Container', 'gradientBegin'],
    ['Container', 'foregroundGradientFocal'],
    ['Image', 'alignment'],
    ['Emoji', 'imageAlignment'],
  ])
    check(
      tag,
      attr,
      ['center', ' top-left ', '-2 3', '.5,2.', ' ( 1e-2 , +3 ) ', '(1 2)'],
      ['1', '1 2 3', '(1,,2)', '1 2,3', '1,', 'NaN 0', '1e100 0', 'space between'],
    );
  for (const value of ['1 2', '(1 2)', '1,2', '(1,2)'])
    assert.deepEqual(service.diagnostics(`<Snapshot><Transform matrix="none" origin="${value}"/></Snapshot>`), []);
  assert.ok(service.diagnostics('<Snapshot><Transform matrix="none" origin="center"/></Snapshot>').length);
});

test('全部内置枚举接受首尾空白、大小写及连字符，ClipPath 仍限制候选', () => {
  for (const [tag, spec] of Object.entries(service.catalog)) {
    for (const [attr, definition] of Object.entries(spec.attributes)) {
      if (!definition.valueType || !definition.values || definition.syntax === 'TextDecoration') continue;
      for (const value of definition.values) {
        const alias = ` ${value.toLowerCase().replaceAll('_', '-')} `;
        const errors = service.diagnostics(wrap(tag, attr, alias));
        assert.ok(!errors.some((item) => item.code === 'invalid-value'), `${tag}.${attr}=${alias}`);
      }
    }
  }
  check('ClipPath', 'fit', [' fill ', 'contain'], ['cover', 'fit-width']);
  check('ClipPath', 'fillRule', [' non-zero ', 'even-odd'], ['inverse-even-odd']);
  for (const value of [' PNG ', 'JpG', 'WEBP'])
    assert.deepEqual(service.diagnostics(`<Snapshot type="${value}"><Text/></Snapshot>`), []);
  assert.ok(service.diagnostics('<Snapshot type="jpeg"><Text/></Snapshot>').length);
});

test('字体列表逐项 trim 且拒绝空项，保留字体名语义', () => {
  for (const attr of ['fontFamily', 'strutFontFamily'])
    check(
      'Text',
      attr,
      ['Arial, Noto Sans', ' My-Font,UPPER CASE ', 'Noto Sans'],
      ['', ' ', ',Arial', 'Arial,', 'Arial,,Noto'],
    );
});

test('圆角支持斜线及旧坐标写法，覆盖前景和裁剪圆角', () => {
  for (const [tag, attr] of [
    ['Border', 'borderRadius'],
    ['Container', 'foregroundBorderRadiusTopLeft'],
    ['ClipRRect', 'borderRadiusBottomRight'],
  ])
    check(
      tag,
      attr,
      ['12', '12 / 6', '(12,6)', '(12 6)', ' 1.2e1 / +6. '],
      ['', '12 6', '12,6', '12/', '/6', '1/2/3', '1 2/3', '(12,6', 'NaN', '1e100/2'],
    );
});

test('矩阵支持原始列优先数据、函数序列和 none，检查有限合成结果', () => {
  const identity = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';
  const valid = [
    identity,
    `(${identity.replaceAll(' ', ', ')})`,
    identity.replaceAll(' ', '\n'),
    'NoNe',
    'translate(12,8) rotate(30deg) scale(1.2)',
    'TRANSLATE(1.2e1 8)rotate( .5RAD ) scale(2 3)',
    'translate(12)',
    'scale(-2)',
  ];
  const invalid = [
    '',
    'translate()',
    'translate(1,)',
    'scale(1,2,3)',
    'rotate(30)',
    'rotate(1 2deg)',
    'translate(1) garbage',
    'translate(1',
    'skew(1)',
    'none scale(2)',
    'translate(1px,2)',
    'scale(1e30) scale(1e30)',
    'translate(3e38) translate(3e38)',
    '(1,0,0,1)',
    identity.replace('1 0', '1,0'),
    'scale(1e100)',
    'translate(scale(2))',
  ];
  for (const [tag, attr] of [
    ['Transform', 'matrix'],
    ['Container', 'transform'],
  ])
    check(tag, attr, valid, invalid);
});

test('边框简写保留 CSS 颜色函数和独立 none，宽度有限且样式受限', () => {
  for (const attr of ['border', 'borderTop', 'foregroundBorderLeft'])
    check(
      'Container',
      attr,
      ['2 red', '2 solid red', 'none', '1e-2 NONE #f008', '2 rgb(255 0 0 / 50%)', '2 solid rgb(255, 0, 0)'],
      ['', 'red', 'red 2', '2px red', '2 dashed red', '2', '1e100 red', '2 rgb(1,2)', 'none red'],
    );
});

test('渐变色标选择空白或逗号分隔，并检查范围、顺序及颜色数量', () => {
  for (const prefix of ['', 'foreground']) {
    const key = (name) => (prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name);
    for (const stops of ['0 .5 1', '0, 5e-1, 1', ' 0\t.5\n1 '])
      assert.deepEqual(
        service.diagnostics(
          `<Snapshot><Container ${key('gradientType')}="linear" ${key('gradientColors')}="rgb(255,0,0),green,blue" ${key('gradientStops')}="${stops}"/></Snapshot>`,
        ),
        [],
      );
    for (const stops of ['', '0,,1', '0,', ',1', '0 .5,1', '0 NaN 1', '0 .5 1e100', '-.1 .5 1', '0 1 .5', '0 .5'])
      assert.ok(
        service.diagnostics(
          `<Snapshot><Container ${key('gradientType')}="linear" ${key('gradientColors')}="red,green,blue" ${key('gradientStops')}="${stops}"/></Snapshot>`,
        ).length,
        stops,
      );
  }
  check(
    'Container',
    'gradientColors',
    ['red,blue', 'rgb(255, 0, 0),hsl(240 100% 50%)'],
    ['red blue', 'red', 'red,,blue', 'rgb(1,2),blue'],
  );
});

test('文本装饰列表支持别名，拒绝规范化后的重复和混合分隔符', () => {
  for (const tag of ['Text', 'Raw', 'WidgetSpan'])
    check(
      tag,
      'decoration',
      ['none', 'underline line-through', ' UNDERLINE, LINE_THROUGH ', 'overline\nunderline'],
      [
        '',
        'underline,',
        ',underline',
        'underline,,overline',
        'underline overline,line-through',
        'underline UNDERLINE',
        'line-through LINE_THROUGH',
        'none underline',
        'wrong',
      ],
    );
});

test('盒阴影按数值出现顺序取半径，支持颜色函数与别名且拒绝重复参数', () => {
  for (const attr of ['boxShadow', 'foregroundBoxShadow'])
    check(
      'Container',
      attr,
      [
        'none',
        'elevation-2',
        'ELEVATION_0',
        '0 2',
        '0 2 red 4',
        '0 2 inner red 4 -1',
        '0 2e0 rgb(255,0,0) 4e0 normal',
        '0 2 red 4,1 3 blue 2',
      ],
      [
        '',
        '0',
        '0 0 red blue',
        '0 0 normal inner',
        '0 0 1 2 3',
        '0 0 -1',
        '0 0 NaN',
        'NaN 0',
        '0 0 1e100',
        'none,0 0',
        '0 0,',
        '0 0,,1 1',
        'elevation-5',
        'elevation-2,0 0',
        '0 0 inset',
      ],
    );
});

test('文本阴影保留 sigma 语义和双精度范围，不接受盒阴影专属参数', () => {
  check(
    'Text',
    'textShadow',
    ['none', '0 2', '0 2 red 4', '0 2 4 red', '0e0 2e0 rgb(255,0,0) 4e0', '0 0 1e100', '0 2 rgb(255,0,0) 4,1 3 blue 2'],
    [
      '',
      '0',
      '0 0 red blue',
      '0 0 -1',
      '0 0 NaN',
      '0 0 1e999',
      'none,0 0',
      '0 0,',
      '0 0 1 2',
      'elevation-2',
      '0 0 normal',
    ],
  );
});

test('布尔值区分缺失、裸属性、空串和无效文本，错误为 error', () => {
  for (const [tag, attr] of [
    ['Snapshot', 'debug'],
    ['Text', 'softWrap'],
    ['Text', 'subpixel'],
    ['Text', 'strutEnabled'],
    ['Text', 'foregroundAntiAlias'],
    ['Image', 'noCache'],
  ]) {
    for (const value of ['true', 'false', ' TRUE ', 'FaLsE']) {
      const source = tag === 'Snapshot' ? `<Snapshot ${attr}="${value}"><Text/></Snapshot>` : wrap(tag, attr, value);
      assert.deepEqual(service.diagnostics(source), [], source);
    }
    for (const value of ['', ' ', 'tru', 'yes', '1', '0', 'true false']) {
      const source = tag === 'Snapshot' ? `<Snapshot ${attr}="${value}"><Text/></Snapshot>` : wrap(tag, attr, value);
      const error = service.diagnostics(source).find((item) => item.code === 'invalid-boolean');
      assert.ok(error, source);
      assert.equal(error.severity, 1);
      assert.doesNotMatch(error.message, /解析为 false/);
    }
  }
  for (const text of ['<Snapshot><Text/></Snapshot>', '<Snapshot debug><Text softWrap subpixel/></Snapshot>'])
    assert.deepEqual(service.diagnostics(text), []);
  const document = TextDocument.create(
    'file:///boolean.snapshot',
    'snapshot',
    1,
    '<Snapshot debug=""><Text softWrap/></Snapshot>',
  );
  const parsed = parseDocument(document, service.catalog);
  assert.equal(parsed.elements[0].attributes[0].value, '');
  assert.equal(parsed.elements[1].attributes[0].value, undefined);
});

test('自定义候选保持大小写敏感，自由字符串和字体不产生枚举补全', () => {
  const custom = new SnapshotLanguageService({
    Custom: {
      mode: 'none',
      description: '',
      attributes: {
        choice: { kind: 'string', values: ['My-Value'] },
        mode: { kind: 'string', valueType: 'PaintMode' },
        text: { kind: 'string' },
      },
    },
  });
  assert.deepEqual(custom.diagnostics('<Snapshot><Custom choice="My-Value" text="MiXeD-Case"/></Snapshot>'), []);
  assert.ok(custom.diagnostics('<Snapshot><Custom choice="my-value"/></Snapshot>').length);
  assert.ok(custom.diagnostics('<Snapshot><Custom mode="fill"/></Snapshot>').length);
  assert.deepEqual(complete('<Snapshot><Custom choice="my-|"/>', custom).items, []);
  for (const attr of ['text', 'fontFamily', 'strutFontFamily'])
    assert.deepEqual(complete(`<Snapshot><Text ${attr}="my-|"/>`).items, []);
  check('Text', 'fontFeatures', ['none', 'kern -liga', 'liga[0:5]=0'], ['none liga']);
});

test('别名补全匹配大小写和连字符，推荐规范值并保留合法 LSP 编辑范围', () => {
  const cases = [
    ['<Snapshot><Row mainAxisAlignment=" space-b|"/>', 'SPACE_BETWEEN'],
    ['<Snapshot><ClipPath fillRule="even-o|"/>', 'EVEN_ODD'],
    ['<Snapshot type="JP|">', 'jpg'],
    ['<Snapshot><Text softWrap=" F|"/>', 'false'],
    ['<Snapshot><Text textDirection="\n r|\nBAD"/>', 'RTL'],
  ];
  for (const [marked, label] of cases) {
    const result = complete(marked);
    const item = result.items.find((item) => item.label === label);
    assert.ok(item, marked);
    assert.ok(result.apply(item).includes(`="${label}"`));
    assert.equal(item.textEdit.range.start.line, item.textEdit.range.end.line);
  }
});

test('装饰列表补全保留已有项和分隔符，过滤重复项及 NONE', () => {
  for (const [value, expected] of [
    ['underline li|', 'underline LINE_THROUGH'],
    ['underline, li|', 'underline, LINE_THROUGH'],
    ['line-t| overline', 'LINE_THROUGH overline'],
  ]) {
    const result = complete(`<Snapshot><Text decoration="${value}"/></Snapshot>`);
    const item = result.items.find((item) => item.label === 'LINE_THROUGH');
    assert.ok(item, value);
    assert.ok(result.apply(item).includes(`decoration="${expected}"`));
    assert.ok(!result.items.some((item) => item.label === 'NONE'));
  }
  assert.deepEqual(
    complete('<Snapshot><Text decoration="underline |"/>').items.map((item) => item.label),
    ['OVERLINE', 'LINE_THROUGH'],
  );
  assert.deepEqual(complete('<Snapshot><Text decoration="none |"/>').items, []);
});

test('复合属性补全与悬停解释新格式、旧顺序和布尔语义', () => {
  for (const [tag, attr, expected, hoverPattern] of [
    ['Container', 'padding', '8 16', /旧.*左.*上.*右.*下/],
    ['Transform', 'matrix', 'translate(12,8) rotate(30deg) scale(1.2)', /右乘.*右侧.*先/],
    ['Container', 'borderRadius', '12 / 6', /水平.*垂直/],
    ['Text', 'softWrap', 'true', /裸属性.*true.*未提供.*默认/],
  ]) {
    const result = complete(`<Snapshot><${tag} ${attr}="|"/>`);
    assert.ok(
      result.items.some((item) => item.textEdit.newText === expected),
      `${tag}.${attr}`,
    );
    const text = wrap(tag, attr, expected);
    const document = TextDocument.create('file:///hover.snapshot', 'snapshot', 1, text);
    const hover = service.hover(text, document.positionAt(text.indexOf(attr) + 1));
    assert.match(hover.contents.value, hoverPattern);
  }
  const result = complete('<Snapshot><Text softW|', service, { snippetSupport: true });
  assert.equal(result.items.find((item) => item.label === 'softWrap').textEdit.newText, 'softWrap="${1:true}"');
});

test('复合值补全为无引号赋值补上引号，保留后续属性与文档', () => {
  for (const [attr, label] of [
    ['padding', '8 16'],
    ['borderRadius', '12 / 6'],
    ['transform', 'translate(12,8) rotate(30deg) scale(1.2)'],
  ]) {
    const result = complete(`<Snapshot><Container ${attr}=|8 width="20"/></Snapshot>`);
    const item = result.items.find((item) => item.label === label);
    assert.ok(item, attr);
    const text = result.apply(item);
    assert.equal(text, `<Snapshot><Container ${attr}="${label}" width="20"/></Snapshot>`);
    assert.deepEqual(service.diagnostics(text), []);
  }
});

test('复合关键字补全支持别名，不规范化字体或 OpenType 普通标签', () => {
  for (const [tag, attr, prefix, label] of [
    ['Container', 'boxShadow', 'ELEVATION-', 'elevation-2'],
    ['Container', 'border', 'NO', 'none'],
    ['Text', 'fontFeatures', 'NO', 'none'],
    ['Container', 'transform', 'TRANSLATE', 'translate(12,8) rotate(30deg) scale(1.2)'],
  ])
    assert.ok(complete(`<Snapshot><${tag} ${attr}="${prefix}|"/>`).items.some((item) => item.label === label));
  assert.deepEqual(complete('<Snapshot><Text fontFeatures="KERN|"/>').items, []);
});

test('综合样例涵盖新语法、旧元组和别名，无静态诊断', () => {
  const text = readFileSync(new URL('../sample/attribute-syntax.snapshot', import.meta.url), 'utf8');
  assert.deepEqual(service.diagnostics(text), []);
});
