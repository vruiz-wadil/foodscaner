import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(fileURLToPath(import.meta.url), '../../..');
const PORT = parseInt(process.argv[2] || '3456', 10);

const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'application/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let filePath = path.join(dir, req.url === '/' ? '/index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  const ct = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
