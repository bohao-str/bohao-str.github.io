// Optional local preview. The deployed website does not use Node.js.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] ?? 8080);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Choose a port between 1024 and 65535.');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const segments = pathname.split(/[\\/]/);
    if (segments.some(segment => segment.startsWith('.')) || pathname.includes('\0')) {
      throw new Error('Not a public file');
    }
    let filename = path.resolve(root, `.${pathname}`);
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside site');
    if ((await stat(filename)).isDirectory()) {
      if (!pathname.endsWith('/')) {
        response.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        response.end();
        return;
      }
      filename = path.join(filename, 'index.html');
    }
    const type = types[path.extname(filename).toLowerCase()];
    if (!type) throw new Error('Not a public file');
    const content = await readFile(filename);
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    const content = await readFile(path.join(root, '404.html'));
    response.writeHead(404, { 'Content-Type': types['.html'], 'Content-Length': content.length });
    response.end(request.method === 'HEAD' ? undefined : content);
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is in use. Try: node tools/preview.mjs ${port + 1}`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Local preview: http://127.0.0.1:${port}/`);
  console.log('Press Ctrl+C to stop. Refresh the browser after editing a file.');
});
