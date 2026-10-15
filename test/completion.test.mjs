import test from 'node:test';
import assert from 'node:assert/strict';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SnapshotLanguageService, parseDocument } from '../dist/index.js';

const service = new SnapshotLanguageService();

function complete(marked, options) {
  const offset = marked.indexOf('|');
  assert.notEqual(offset, -1, '用 | 标记光标');
  const text = marked.slice(0, offset) + marked.slice(offset + 1);
  const document = TextDocument.create('file:///completion.snapshot', 'snapshot', 1, text);
  const items = service.completions(text, document.positionAt(offset), document.uri, options);
  return { text, document, items };
}

function apply(marked, label, options) {
  const { document, items } = complete(marked, options);
  const item = items.find((item) => item.label === label);
  assert.ok(item, `${marked} 缺少候选 ${label}`);
  const edit = { ...item.textEdit };
  // 当前属性模板只含一个空占位符，模拟客户端接受该 snippet。
  if (item.insertTextFormat === 2) edit.newText = edit.newText.replace('${1}', '');
  return TextDocument.applyEdits(document, [edit]);
}

test('属性名补全保留已有赋值、引号和空白', () => {
  for (const assignment of ['="100"', "='100'", '=100', ' = "100"', '=""', '=']) {
    const marked = `<Snapshot><Container wi|dth${assignment}/></Snapshot>`;
    assert.equal(apply(marked, 'width'), marked.replace('|', ''), marked);
  }
  assert.equal(
    apply('<Snapshot><Container wi|dht="100"/></Snapshot>', 'width'),
    '<Snapshot><Container width="100"/></Snapshot>',
  );
});

test('新属性在合法空白处插入，名称补全替换整个名称', () => {
  for (const marked of [
    '<Snapshot><Container wi|dht/></Snapshot>',
    '<Snapshot><Container |/></Snapshot>',
    '<Snapshot><Container height="20"\n  | /></Snapshot>',
    '<Snapshot><Container height=20 |/>',
  ]) {
    const expected = marked.includes('wi|dht') ? marked.replace('wi|dht', 'width=""') : marked.replace('|', 'width=""');
    assert.equal(apply(marked, 'width'), expected);
  }
  const { items } = complete('<Snapshot><Container width="100" |/>');
  assert.ok(!items.some((item) => item.label === 'width'));
});

test('赋值过渡、值和关闭标记中不会插入属性名', () => {
  for (const marked of [
    '<Snapshot><Container width=|"100"/></Snapshot>',
    '<Snapshot><Container width = | "100"/></Snapshot>',
    '<Snapshot><Container width | = "100"/></Snapshot>',
    '<Snapshot><Container width="1|00"/></Snapshot>',
    '<Snapshot><Container width="100"|/></Snapshot>',
    '<Snapshot><Container /|></Snapshot>',
    '<Snapshot><Container / |></Snapshot>',
    '<Snapshot><Container width="100" /|></Snapshot>',
    '<Snapshot><Container/>|</Snapshot>',
  ])
    assert.deepEqual(complete(marked).items, [], marked);
});

test('闭合标签使用当前位置未闭合的父节点', () => {
  for (const [marked, expected] of [
    ['<Snapshot><Column><Text></Text></|', '<Snapshot><Column><Text></Text></Column>'],
    ['<Snapshot><Column><Text></Text></Co|lumn></Snapshot>', '<Snapshot><Column><Text></Text></Column></Snapshot>'],
    ['<Snapshot><Column><Text/></|>', '<Snapshot><Column><Text/></Column>'],
    ['<Snapshot><Column><Text></Text></Column></|', '<Snapshot><Column><Text></Text></Column></Snapshot>'],
    ['<Snapshot><Text></Te|', '<Snapshot><Text></Text>'],
  ]) {
    const { items } = complete(marked);
    assert.equal(items.length, 1);
    assert.equal(apply(marked, items[0].label), expected);
  }
  assert.deepEqual(complete('<Snapshot><Text/></Snapshot></|').items, []);
});

test('不完整标签遇到下一个标签时恢复，闭合补全补齐尖括号', () => {
  for (const gap of ['', '\n', '  \r\n']) {
    assert.equal(apply(`<Snapshot><Text></Te|${gap}</Snapshot>`, 'Text'), `<Snapshot><Text></Text>${gap}</Snapshot>`);
    assert.equal(apply(`<Snapshot><Text></Text|${gap}</Snapshot>`, 'Text'), `<Snapshot><Text></Text>${gap}</Snapshot>`);
  }
  assert.equal(apply('<Snapshot><Te|xt\n</Snapshot>', 'Text'), '<Snapshot><Text\n</Snapshot>');
  const document = TextDocument.create('file:///recovery.snapshot', 'snapshot', 1, '<Snapshot><Text\n</Snapshot>');
  const parsed = parseDocument(document, service.catalog);
  assert.equal(parsed.tags.length, 3);
  assert.equal(parsed.tags[1].incomplete, true);
  assert.equal(parsed.tags[2].name, 'Snapshot');
});

test('文档中间的空标签名可补全且不创建虚假元素', () => {
  for (const [marked, label] of [
    ['<Snapshot><|</Snapshot>', 'Container'],
    ['<Snapshot><|></Snapshot>', 'Container'],
    ['<Snapshot><Text></|></Snapshot>', 'Text'],
    ['<|>', 'Snapshot'],
  ]) {
    assert.equal(apply(marked, label), marked.replace('|', label));
    const { document } = complete(marked);
    const parsed = parseDocument(document, service.catalog);
    assert.ok(parsed.elements.every((element) => element.name !== ''));
    assert.ok(!parsed.diagnostics.some((item) => item.code === 'unknown-tag'));
  }
});

test('空标签补全仍遵守文本、父子关系和子节点数量限制', () => {
  assert.ok(
    complete('<Snapshot><Column><Text></Text><|></Column></Snapshot>').items.some((item) => item.label === 'Container'),
  );
  const inline = complete('<Snapshot><Text><|></Text></Snapshot>').items.map((item) => item.label);
  assert.ok(inline.includes('WidgetSpan'));
  assert.ok(!inline.includes('Container'));
  for (const marked of [
    '<Snapshot><Container/><|></Snapshot>',
    '<Snapshot><Image><|></Image></Snapshot>',
    '<Snapshot><ClipPath path="M0 0"><Text/><|></ClipPath></Snapshot>',
  ])
    assert.deepEqual(complete(marked).items, [], marked);
});

test('注释、CDATA 和引号内的尖括号不影响标签扫描', () => {
  for (const marked of [
    '<Snapshot><!-- <| --><Container/></Snapshot>',
    '<Snapshot><Text><![CDATA[<|>]]></Text></Snapshot>',
    '<Snapshot><Container width="<|>"/></Snapshot>',
    "<Snapshot><Container width='<|>'/></Snapshot>",
  ])
    assert.deepEqual(complete(marked).items, [], marked);
  const text = '<Snapshot><Text text="<Container>"/></Snapshot>';
  const document = TextDocument.create('file:///quoted.snapshot', 'snapshot', 1, text);
  assert.deepEqual(
    parseDocument(document, service.catalog).tags.map((token) => token.name),
    ['Snapshot', 'Text', 'Snapshot'],
  );
  assert.equal(
    apply('<Snapshot><Column><Text text="<Container>"/><|>', 'Container'),
    '<Snapshot><Column><Text text="<Container>"/><Container>',
  );
});

test('核心补全可显式禁用 snippet，并兼容原有默认调用', () => {
  const marked = '<Snapshot><Container wi|';
  for (const options of [undefined, {}, { snippetSupport: true }, { snippetSupport: false }]) {
    const { items } = complete(marked, options);
    const width = items.find((item) => item.label === 'width');
    const snippet = options?.snippetSupport !== false;
    assert.equal(width.insertTextFormat, snippet ? 2 : 1);
    assert.equal(width.textEdit.newText, snippet ? 'width="${1}"' : 'width=""');
    assert.equal(apply(marked, 'width', options), '<Snapshot><Container width=""');
  }
});

test('方向、占位符、平铺和混合模式补全覆盖同类型别名', () => {
  const blendMode = [
    'CLEAR',
    'SRC',
    'DST',
    'SRC_OVER',
    'DST_OVER',
    'SRC_IN',
    'DST_IN',
    'SRC_OUT',
    'DST_OUT',
    'SRC_ATOP',
    'DST_ATOP',
    'XOR',
    'PLUS',
    'MODULATE',
    'SCREEN',
    'OVERLAY',
    'DARKEN',
    'LIGHTEN',
    'COLOR_DODGE',
    'COLOR_BURN',
    'HARD_LIGHT',
    'SOFT_LIGHT',
    'DIFFERENCE',
    'EXCLUSION',
    'MULTIPLY',
    'HUE',
    'SATURATION',
    'COLOR',
    'LUMINOSITY',
  ];
  const placeholder = ['BASELINE', 'ABOVE_BASELINE', 'BELOW_BASELINE', 'TOP', 'BOTTOM', 'MIDDLE'];
  const tileMode = ['CLAMP', 'REPEAT', 'MIRROR', 'DECAL'];
  for (const [tag, spec] of Object.entries(service.catalog)) {
    for (const name of Object.keys(spec.attributes)) {
      const expected =
        name === 'textDirection'
          ? ['LTR', 'RTL']
          : name === 'alignment' && ['Emoji', 'WidgetSpan'].includes(tag)
            ? placeholder
            : /^(?:tileMode|.*TileMode)$/.test(name)
              ? tileMode
              : /^(?:blendMode|.*BlendMode)$/.test(name)
                ? blendMode
                : undefined;
      if (!expected) continue;
      const marked = `<Snapshot><${tag} ${name}="|"/>`;
      assert.deepEqual(
        complete(marked).items.map((item) => item.label),
        expected,
        `${tag}.${name}`,
      );
      assert.equal(apply(marked, expected[0]), marked.replace('|', expected[0]));
    }
  }
  assert.equal(apply('<Snapshot><Text textDirection="R|TL"/>', 'RTL'), '<Snapshot><Text textDirection="RTL"/>');
  assert.equal(
    apply('<Snapshot><BackdropFilter tileMode=DE|CAL/>', 'DECAL'),
    '<Snapshot><BackdropFilter tileMode=DECAL/>',
  );
  assert.equal(
    apply("<Snapshot><ColorFiltered blendMode='SRC_|OVER'/>", 'SRC_OVER'),
    "<Snapshot><ColorFiltered blendMode='SRC_OVER'/>",
  );
  assert.deepEqual(complete('<Snapshot><Text><WidgetSpan alignment="C|"/>').items, []);
  assert.ok(complete('<Snapshot><Container alignment="C|"/>').items.some((item) => item.label === 'CENTER'));
});
