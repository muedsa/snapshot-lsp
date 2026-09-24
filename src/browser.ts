import { BrowserMessageReader, BrowserMessageWriter, createConnection, type MessageReader, type MessageWriter } from 'vscode-languageserver/lib/browser/main.js';
import { registerSnapshotServer } from './server.js';
import { SnapshotLanguageService } from './service.js';

/** Monaco 等浏览器宿主可将 Web Worker 的 reader/writer 注入此入口。 */
export function startBrowserServer(reader: MessageReader, writer: MessageWriter, service?: SnapshotLanguageService): void {
  const connection = createConnection(reader, writer);
  registerSnapshotServer(connection, service);
  connection.listen();
}

/** Web Worker 中可直接传入 self；也支持 MessagePort / Worker。 */
export function startBrowserWorkerServer(port: ConstructorParameters<typeof BrowserMessageReader>[0], service?: SnapshotLanguageService): void {
  startBrowserServer(new BrowserMessageReader(port), new BrowserMessageWriter(port), service);
}
