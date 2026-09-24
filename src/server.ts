import type { Connection } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SnapshotLanguageService } from './service.js';

/** 给 Node stdio、Web Worker 等传输复用的协议处理器。 */
export function registerSnapshotServer(connection: Connection, service = new SnapshotLanguageService()): void {
  const documents = new Map<string, TextDocument>();
  const publish = (document: TextDocument) => connection.sendDiagnostics({ uri: document.uri, version: document.version, diagnostics: service.diagnostics(document.getText(), document.uri) });
  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: 2,
      completionProvider: { triggerCharacters: ['<', '/', ' ', '=', '"', "'"] },
      hoverProvider: true,
    },
    serverInfo: { name: 'snapshot-lsp', version: '0.1.0' },
  }));
  connection.onDidOpenTextDocument(({ textDocument }) => {
    const document = TextDocument.create(textDocument.uri, textDocument.languageId, textDocument.version, textDocument.text);
    documents.set(document.uri, document); publish(document);
  });
  connection.onDidChangeTextDocument(({ textDocument, contentChanges }) => {
    const previous = documents.get(textDocument.uri);
    if (!previous) return;
    const document = TextDocument.update(previous, contentChanges, textDocument.version);
    documents.set(document.uri, document); publish(document);
  });
  connection.onDidCloseTextDocument(({ textDocument }) => {
    documents.delete(textDocument.uri);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
  });
  connection.onCompletion(({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    return document ? service.completions(document.getText(), position, document.uri) : [];
  });
  connection.onHover(({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    return document ? service.hover(document.getText(), position, document.uri) : null;
  });
}
