import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Node stdio LSP 握手、诊断和补全', async (t) => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('../dist/node.js', import.meta.url)), '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => server.kill());
  server.stdin.on('error', () => {});
  let buffer = Buffer.alloc(0), nextId = 1;
  const received = [];
  const waiters = [];
  server.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const split = buffer.indexOf('\r\n\r\n');
      if (split < 0) break;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, split).toString())?.[1]);
      if (!Number.isFinite(length) || buffer.length < split + 4 + length) break;
      const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length).toString());
      buffer = buffer.subarray(split + 4 + length);
      received.push(message);
      for (const waiter of [...waiters]) if (waiter.predicate(message)) { waiter.resolve(message); waiters.splice(waiters.indexOf(waiter), 1); }
    }
  });
  const send = (message) => {
    const body = Buffer.from(JSON.stringify(message));
    server.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  };
  const waitFor = (predicate) => new Promise((resolve, reject) => {
    const found = received.find(predicate);
    if (found) return resolve(found);
    const waiter = { predicate, resolve };
    waiters.push(waiter);
    setTimeout(() => { if (waiters.includes(waiter)) { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('LSP 响应超时')); } }, 5000).unref();
  });
  const request = async (method, params) => {
    const id = nextId++;
    send({ jsonrpc: '2.0', id, method, params });
    return waitFor((message) => message.id === id);
  };
  const initialize = await request('initialize', { processId: process.pid, rootUri: null, capabilities: {} });
  assert.equal(initialize.result.serverInfo.name, 'snapshot-lsp');
  send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  const uri = 'file:///test.snapshot';
  send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'snapshot', version: 1, text: '<Snapshot><Image color="red"/></Snapshot>' } } });
  const diagnostic = await waitFor((message) => message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri);
  assert.ok(diagnostic.params.diagnostics.some((item) => item.code === 'invalid-color'));
  send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: '<Snapshot><Container color="#FF0000"/></Snapshot>' }] } });
  const updated = await waitFor((message) => message.method === 'textDocument/publishDiagnostics' && message.params.uri === uri && message.params.version === 2);
  assert.deepEqual(updated.params.diagnostics, []);
  const completion = await request('textDocument/completion', { textDocument: { uri }, position: { line: 0, character: 11 } });
  assert.ok(completion.result.some((item) => item.label === 'Container'));
  await request('shutdown', null);
  send({ jsonrpc: '2.0', method: 'exit' });
});
