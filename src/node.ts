#!/usr/bin/env node
import { createConnection } from 'vscode-languageserver/lib/node/main.js';
import { registerSnapshotServer } from './server.js';

const connection = createConnection();
registerSnapshotServer(connection);
connection.listen();
