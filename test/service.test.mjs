import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotLanguageService, tags } from '../dist/index.js';

const service = new SnapshotLanguageService();
const codes = (text) => service.diagnostics(text).map((d) => d.code);

test('内置目录包含 Snapshot 默认注册的 38 个标签', () => {
  assert.equal(Object.keys(tags).length, 38);
  assert.equal(tags.Text.mode, 'multiple');
  assert.equal(tags.Image.mode, 'none');
});

test('有效样例与 CDATA、注释不产生诊断', () => {
  assert.deepEqual(
    codes(
      '<Snapshot type="png"><Column><Text color="#FF0000">Hi<![CDATA[ <a> ]]></Text><Container width="100"/></Column></Snapshot>',
    ),
    [],
  );
  assert.deepEqual(codes('<!-- hello --><Snapshot><Text>Hi</Text></Snapshot>'), []);
  assert.deepEqual(codes('<Snapshot><Image url="https://example.com/a.png" fit="COVER"/></Snapshot>'), []);
});

test('结构、属性和取值诊断', () => {
  const found = codes(
    '<Snapshot><Row><Expanded/><Spacer/><Positioned/></Row><Image url="a" dataUri="b" width="oops" color="not-a-color" foo="x" foo="y"/></Snapshot>',
  );
  for (const code of [
    'child-count',
    'invalid-parent',
    'image-source',
    'invalid-number',
    'invalid-color',
    'unknown-attribute',
    'duplicate-attribute',
  ])
    assert.ok(found.includes(code), code);
  assert.ok(codes('<Container/>').includes('root-tag'));
  assert.ok(codes('<Snapshot><Flex/></Snapshot>').includes('missing-attribute'));
  assert.ok(codes('<Snapshot><Row><Expanded fit="LOOSE"/></Row></Snapshot>').includes('unknown-attribute'));
});

test('CSS 颜色诊断与 Snapshot parser 的支持范围一致', () => {
  const valid = [
    '#f00',
    '#f008',
    '#FF0000',
    '#ff000080',
    'red',
    'RebeccaPurple',
    'transparent',
    'rgb(255, 0, 0)',
    'rgba(255, 0, 0, .5)',
    'rgb(100% 0% 0% / 50%)',
    'hsl(120, 100%, 50%)',
    'hsla(120, 100%, 50%, 50%)',
    'hsl(0.5turn 100% 50% / 0.5)',
  ];
  for (const value of valid)
    assert.ok(!codes(`<Snapshot background="${value}"><Container/></Snapshot>`).includes('invalid-color'), value);
  const invalid = [
    '#12',
    '#abcdx',
    '#123456789',
    'rgb(1, 2)',
    'rgb(1 2 3 /)',
    'rgb(NaN 0 0)',
    'hsl(120 1 50%)',
    'hsl(0 100% 50% / NaN)',
    'hsl(1e308turn 100% 50%)',
    'currentColor',
    'lab(50% 0 0)',
  ];
  for (const value of invalid)
    assert.ok(codes(`<Snapshot background="${value}"><Container/></Snapshot>`).includes('invalid-color'), value);
});

test('标签、属性、枚举值和闭合标签补全', () => {
  const labels = (text) => service.completions(text, { line: 0, character: text.length }).map((item) => item.label);
  assert.deepEqual(labels('<S'), ['Snapshot']);
  assert.ok(labels('<Snapshot><Co').includes('Container'));
  assert.ok(labels('<Snapshot><Container wi').includes('width'));
  assert.ok(labels('<Snapshot type="p').includes('png'));
  assert.deepEqual(labels('<Snapshot><Text></'), ['Text']);
  assert.ok(!labels('<Snapshot><Text><').includes('Container'));
});

test('闭合标签补全包含结束尖括号且不会重复', () => {
  const incomplete = '<Snapshot><Text></Te';
  const completion = service.completions(incomplete, { line: 0, character: incomplete.length })[0];
  assert.equal(completion.textEdit.newText, 'Text>');

  const complete = '<Snapshot><Text></Text>';
  const beforeClosingBracket = complete.length - 1;
  const existingBracketCompletion = service.completions(complete, { line: 0, character: beforeClosingBracket })[0];
  assert.equal(existingBracketCompletion.textEdit.newText, 'Text');
});

test('标签名中间补全会替换完整名称', () => {
  const apply = (text, item) => {
    const { start, end } = item.textEdit.range;
    assert.equal(start.line, 0);
    assert.equal(end.line, 0);
    return text.slice(0, start.character) + item.textEdit.newText + text.slice(end.character);
  };
  const opening = '<Snapshot><Contaner/></Snapshot>';
  const openItem = service
    .completions(opening, { line: 0, character: opening.indexOf('Contaner') + 5 })
    .find((item) => item.label === 'Container');
  assert.equal(apply(opening, openItem), '<Snapshot><Container/></Snapshot>');

  const closing = '<Snapshot><Text></Text>';
  const closeItem = service.completions(closing, { line: 0, character: closing.indexOf('</Text>') + 4 })[0];
  assert.equal(apply(closing, closeItem), closing);

  const partial = '<Snapshot><Text></Te';
  const partialItem = service.completions(partial, { line: 0, character: partial.length })[0];
  assert.equal(apply(partial, partialItem), '<Snapshot><Text></Text>');
});

test('注释、CDATA 和属性值中不提供标签补全', () => {
  const labelsAtEnd = (text) =>
    service.completions(text, { line: 0, character: text.length }).map((item) => item.label);
  assert.deepEqual(labelsAtEnd('<Snapshot><!-- </'), []);
  assert.deepEqual(labelsAtEnd('<Snapshot><Text><![CDATA[</'), []);
  assert.deepEqual(labelsAtEnd('<Snapshot><Container width="</'), []);
  assert.deepEqual(labelsAtEnd('<Snapshot><Container width="<Co'), []);
});

test('已闭合的空 Snapshot 根节点报错，编辑中不提前报错', () => {
  assert.ok(codes('<Snapshot/>').includes('empty-root'));
  assert.ok(codes('<Snapshot></Snapshot>').includes('empty-root'));
  assert.ok(codes('<Snapshot><!-- 注释 --></Snapshot>').includes('empty-root'));
  assert.ok(!codes('<Snapshot>').includes('empty-root'));
  assert.ok(!codes('<Snapshot></Snapshot').includes('empty-root'));
  assert.ok(!codes('<Snapshot><Text/></Snapshot>').includes('empty-root'));
  assert.ok(!codes('<Snapshot><Snapshot/></Snapshot>').includes('empty-root'));
});

test('悬停信息与独立扩展目录', () => {
  const hover = service.hover('<Snapshot><Container width="10"/></Snapshot>', { line: 0, character: 23 });
  assert.match(hover.contents.value, /Container\.width/);
  const extended = new SnapshotLanguageService({
    Custom: { mode: 'none', description: '自定义', attributes: { title: { kind: 'string' } } },
  });
  assert.deepEqual(extended.diagnostics('<Snapshot><Custom title="x"/></Snapshot>'), []);
  assert.ok(service.diagnostics('<Snapshot><Custom/></Snapshot>').some((d) => d.code === 'unknown-tag'));
});
