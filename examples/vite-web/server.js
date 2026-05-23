import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.PORT || 3000);
const root = path.resolve('dist');
const server = http.createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '');
  const target = path.join(root, file);
  if (!target.startsWith(root) || !fs.existsSync(target)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'text/plain' });
  fs.createReadStream(target).pipe(res);
});
server.listen(port, '0.0.0.0');
