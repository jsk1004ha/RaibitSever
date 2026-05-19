import http from 'node:http';

const port = Number(process.env.PORT || 3000);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, databaseUrlPresent: Boolean(process.env.DATABASE_URL), sqlitePath: process.env.SQLITE_PATH || null }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('hello from RAIBITSERVER express-api example\n');
});
server.listen(port, '0.0.0.0');
