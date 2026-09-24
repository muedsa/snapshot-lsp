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
  assert.deepEqual(codes('<Snapshot type="png"><Column><Text color="#FF0000">Hi<![CDATA[ <a> ]]></Text><Container width="100"/></Column></Snapshot>'), []);
  assert.deepEqual(codes('<!-- hello --><Snapshot><Text>Hi</Text></Snapshot>'), []);
  assert.deepEqual(codes('<Snapshot><Image url="https://example.com/a.png" fit="COVER"/></Snapshot>'), []);
});

test('结构、属性和取值诊断', () => {
  const found = codes('<Snapshot><Row><Expanded/><Spacer/><Positioned/></Row><Image url="a" dataUri="b" width="oops" color="red" foo="x" foo="y"/></Snapshot>');
  for (const code of ['child-count', 'invalid-parent', 'image-source', 'invalid-number', 'invalid-color', 'unknown-attribute', 'duplicate-attribute']) assert.ok(found.includes(code), code);
  assert.ok(codes('<Container/>').includes('root-tag'));
  assert.ok(codes('<Snapshot><Flex/></Snapshot>').includes('missing-attribute'));
  assert.ok(codes('<Snapshot><Row><Expanded fit="LOOSE"/></Row></Snapshot>').includes('unknown-attribute'));
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

test('悬停信息与独立扩展目录', () => {
  const hover = service.hover('<Snapshot><Container width="10"/></Snapshot>', { line: 0, character: 23 });
  assert.match(hover.contents.value, /Container\.width/);
  const extended = new SnapshotLanguageService({ Custom: { mode: 'none', description: '自定义', attributes: { title: { kind: 'string' } } } });
  assert.deepEqual(extended.diagnostics('<Snapshot><Custom title="x"/></Snapshot>'), []);
  assert.ok(service.diagnostics('<Snapshot><Custom/></Snapshot>').some((d) => d.code === 'unknown-tag'));
});
