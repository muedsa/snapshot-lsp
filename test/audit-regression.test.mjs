import test from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SnapshotLanguageService, parseDocument } from '../dist/index.js';

const service = new SnapshotLanguageService();
const codes = (text) => service.diagnostics(text).map((item) => item.code);
function atCursor(marked, target = service) {
  const offset = marked.indexOf('|');
  assert.ok(offset >= 0);
  const text = marked.replace('|', '');
  const document = TextDocument.create('file:///audit.snapshot', 'snapshot', 1, text);
  const position = document.positionAt(offset);
  return { document, position, items: target.completions(text, position, document.uri) };
}

test('原型上的标签和属性按未知名称处理，所有核心接口均不抛异常', () => {
  for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const text = `<Snapshot><${name}/></Snapshot>`;
    assert.ok(codes(text).includes('unknown-tag'), name);
    assert.equal(service.hover(text, { line: 0, character: 12 }), null);
    assert.deepEqual(atCursor(`<Snapshot><${name} |/></Snapshot>`).items, []);
    assert.ok(codes(`<Snapshot><Container ${name}="x"/></Snapshot>`).includes('unknown-attribute'));
    assert.equal(service.hover(`<Snapshot><Container ${name}="x"/></Snapshot>`, { line: 0, character: 24 }), null);
  }
  const document = TextDocument.create(
    'file:///external.snapshot',
    'snapshot',
    1,
    '<Snapshot><constructor/></Snapshot>',
  );
  assert.ok(
    parseDocument(document, { Snapshot: service.catalog.Snapshot }).diagnostics.some((d) => d.code === 'unknown-tag'),
  );
});

test('扩展目录显式注册的同名标签和属性仍可使用', () => {
  const custom = new SnapshotLanguageService({
    constructor: {
      mode: 'none',
      description: '自定义标签',
      attributes: { toString: { kind: 'string', values: ['OK'] } },
    },
  });
  assert.deepEqual(custom.diagnostics('<Snapshot><constructor toString="OK"/></Snapshot>'), []);
  assert.deepEqual(
    atCursor('<Snapshot><constructor toString="|"/>', custom).items.map((i) => i.label),
    ['OK'],
  );
});

test('无引号值保留 URL 和路径中的斜杠，后续属性正常补全和诊断', () => {
  for (const value of ['https://example.com/a.png', 'https://example.com/', 'a/b']) {
    const text = `<Snapshot><Image url=${value} fit="BAD" width="bad"/></Snapshot>`;
    const doc = TextDocument.create('file:///url.snapshot', 'snapshot', 1, text);
    const image = parseDocument(doc, service.catalog).elements[1];
    assert.equal(image.attributes[0].value, value);
    assert.equal(image.selfClosing, true);
    assert.ok(codes(text).includes('invalid-value'));
    assert.ok(codes(text).includes('invalid-number'));
    assert.deepEqual(
      atCursor(`<Snapshot><Image url=${value} fit="CO|"/>`).items.map((i) => i.label),
      ['CONTAIN', 'COVER'],
    );
  }
});

test('仅值外的斜杠表示自闭合，与 Snapshot tokenizer 保持一致', () => {
  for (const [source, value, selfClosing] of [
    ['<Text text=a/b/>', 'a/b/', false],
    ['<Text text=a/b />', 'a/b', true],
    ['<Text text="a/b"/>', 'a/b', true],
  ]) {
    const document = TextDocument.create('file:///slash.snapshot', 'snapshot', 1, source);
    const node = parseDocument(document, service.catalog).elements[0];
    assert.equal(node.attributes[0].value, value);
    assert.equal(node.selfClosing, selfClosing);
  }
});

test('copyWith 颜色别名保留颜色类型，并产生正确诊断与悬停', () => {
  for (const tag of ['Text', 'Raw', 'WidgetSpan']) {
    for (const attr of ['decorationColor', 'foregroundColor', 'backgroundColor']) {
      assert.equal(service.catalog[tag].attributes[attr].kind, 'color', `${tag}.${attr}`);
      const text = `<Snapshot><Text><${tag} ${attr}="bad"/></Text></Snapshot>`;
      assert.ok(codes(text).includes('invalid-color'), `${tag}.${attr}`);
      const document = TextDocument.create('file:///color.snapshot', 'snapshot', 1, text);
      assert.match(service.hover(text, document.positionAt(text.indexOf(attr) + 1)).contents.value, /类型：color/);
    }
  }
});

test('对齐枚举严格校验，同时保留合法 BoxAlignment 坐标', () => {
  for (const source of [
    '<Row mainAxisAlignment="WRONG"/>',
    '<Column crossAxisAlignment="WRONG"/>',
    '<Text><WidgetSpan alignment="CENTER"><Container/></WidgetSpan></Text>',
    '<Text><Emoji url="a" alignment="(0,0)"/></Text>',
    '<Container alignment="WRONG"/>',
  ])
    assert.ok(codes(`<Snapshot>${source}</Snapshot>`).includes('invalid-value'), source);
  for (const [tag, attr] of [
    ['Container', 'alignment'],
    ['Image', 'alignment'],
    ['Container', 'gradientBegin'],
    ['Container', 'foregroundGradientCenter'],
    ['Emoji', 'imageAlignment'],
  ]) {
    assert.equal(service.catalog[tag].attributes[attr].valueType, 'BoxAlignment');
    const source = `<${tag} ${attr}="(-.5,+0.25)"/>`;
    const text = `<Snapshot>${tag === 'Emoji' ? `<Text>${source}</Text>` : source}</Snapshot>`;
    assert.ok(!codes(text).includes('invalid-value'), attr);
  }
  const custom = new SnapshotLanguageService({
    Custom: { mode: 'none', description: '', attributes: { alignment: { kind: 'string', values: ['A'] } } },
  });
  assert.ok(
    custom.diagnostics('<Snapshot><Custom alignment="BAD"/></Snapshot>').some((d) => d.code === 'invalid-value'),
  );
});

test('完整标签的必填属性必须有值，未完成输入和可省值属性保持容错', () => {
  for (const source of [
    '<Flex direction/>',
    '<ColorFiltered color="#fff" blendMode/>',
    '<ColoredBox color/>',
    '<BackdropFilter sigmaX sigmaY="1"/>',
    '<ClipPath path/>',
    '<Image url/>',
  ])
    assert.ok(codes(`<Snapshot>${source}</Snapshot>`).includes('missing-value'), source);
  for (const text of [
    '<Snapshot><Flex direction',
    '<Snapshot><ColorFiltered color="#fff" blendMode',
    '<Snapshot><Container width/>',
    '<Snapshot><Text softWrap/>',
  ])
    assert.ok(!codes(text).includes('missing-value'), text);
});

test('多行枚举补全使用单行主编辑，应用所有编辑后保留完整文档', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const value of [`|BAD${newline}`, `${newline}R|${newline}BAD`, `${newline}|`, `R|${newline}BAD`]) {
      const marked = `<Snapshot><Text text="中文😀" textDirection="${value}"/></Snapshot>`;
      const { document, position, items } = atCursor(marked);
      const item = items.find((i) => i.label === 'RTL');
      assert.ok(item, marked);
      const range = item.textEdit.range;
      assert.equal(range.start.line, position.line);
      assert.equal(range.end.line, position.line);
      assert.ok(range.start.character <= position.character && range.end.character >= position.character);
      const edits = [item.textEdit, ...(item.additionalTextEdits ?? [])];
      const ordered = edits
        .map((e) => [document.offsetAt(e.range.start), document.offsetAt(e.range.end)])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i - 1][1] <= ordered[i][0], '补全编辑范围不得重叠');
      assert.equal(
        TextDocument.applyEdits(document, edits),
        '<Snapshot><Text text="中文😀" textDirection="RTL"/></Snapshot>',
      );
    }
  }
});

test('Raw 内的 WidgetSpan 与 Parser 和候选规则一致', () => {
  const text = '<Snapshot><Text><Raw><WidgetSpan><Container/></WidgetSpan></Raw></Text></Snapshot>';
  assert.deepEqual(codes(text), []);
  assert.ok(
    atCursor('<Snapshot><Text><Raw><Wi|/></Raw></Text></Snapshot>').items.some((i) => i.label === 'WidgetSpan'),
  );
  assert.ok(codes('<Snapshot><WidgetSpan><Container/></WidgetSpan></Snapshot>').includes('invalid-parent'));
});

test('标签补全检查前后全部子节点，同时允许修改现有唯一子节点', () => {
  for (const marked of [
    '<Snapshot><ClipPath path="M0 0"><| /><Text/></ClipPath></Snapshot>',
    '<Snapshot><ClipPath path="M0 0"><Text/><| /></ClipPath></Snapshot>',
    '<Snapshot><Text/></Snapshot><| />',
    '<| /><Snapshot><Text/></Snapshot>',
  ])
    assert.deepEqual(atCursor(marked).items, [], marked);
  for (const marked of [
    '<Snapshot><ClipPath path="M0 0"><Te|xt/></ClipPath></Snapshot>',
    '<Sna|pshot><Text/></Snapshot>',
  ])
    assert.equal(atCursor(marked).items.length, 1, marked);
  assert.ok(atCursor('<Snapshot><Column><| /><Text/></Column></Snapshot>').items.some((i) => i.label === 'Container'));
});

test('补齐所有已发现的枚举及同类型别名，补全与诊断同步', () => {
  const cases = [
    ['Image', 'repeat', ['REPEAT', 'REPEAT_X', 'REPEAT_Y', 'NO_REPEAT']],
    ['Emoji', 'repeat', ['REPEAT', 'REPEAT_X', 'REPEAT_Y', 'NO_REPEAT']],
    ['DecoratedBox', 'position', ['BACKGROUND', 'FOREGROUND']],
    ['Text', 'textWidthBasis', ['PARENT', 'LONGESTLINE']],
    ['Text', 'textHeightMode', ['ALL', 'DISABLE_FIRST_ASCENT', 'DISABLE_LAST_DESCENT', 'DISABLE_ALL']],
    ['Text', 'baselineMode', ['ALPHABETIC', 'IDEOGRAPHIC']],
    ['Row', 'textBaseline', ['ALPHABETIC', 'IDEOGRAPHIC']],
    ['WidgetSpan', 'baseline', ['ALPHABETIC', 'IDEOGRAPHIC']],
    ['Emoji', 'baseline', ['ALPHABETIC', 'IDEOGRAPHIC']],
    ['Text', 'fontEdging', ['ALIAS', 'ANTI_ALIAS', 'SUBPIXEL_ANTI_ALIAS']],
    ['Text', 'fontHinting', ['NONE', 'SLIGHT', 'NORMAL', 'FULL']],
    ['Raw', 'foregroundMode', ['FILL', 'STROKE', 'STROKE_AND_FILL']],
    ['Text', 'foregroundStrokeCap', ['BUTT', 'ROUND', 'SQUARE']],
    ['WidgetSpan', 'foregroundStrokeJoin', ['MITER', 'ROUND', 'BEVEL']],
    ['Container', 'foregroundShape', ['RECTANGLE', 'CIRCLE']],
    ['Text', 'fontStyle', ['NORMAL', 'BOLD', 'ITALIC', 'BOLD_ITALIC']],
    ['Text', 'strutFontStyle', ['NORMAL', 'BOLD', 'ITALIC', 'BOLD_ITALIC']],
    ['Text', 'decorationLineStyle', ['SOLID', 'DOUBLE', 'DOTTED', 'DASHED', 'WAVY']],
  ];
  for (const [tag, name, expected] of cases) {
    const marked = `<Snapshot><${tag} ${name}="|"/>`;
    assert.deepEqual(
      atCursor(marked).items.map((i) => i.label),
      expected,
      `${tag}.${name}`,
    );
    assert.ok(codes(marked.replace('|', 'WRONG')).includes('invalid-value'), `${tag}.${name}`);
    for (const value of expected)
      assert.ok(!codes(marked.replace('|', value)).includes('invalid-value'), `${tag}.${name}=${value}`);
  }
});
