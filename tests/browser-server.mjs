// 저장 장애 UI 검증용 서버. 배포 빌드나 기본 개발 서버에서 제공하지 않는다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const allowed = new Set(['tests/browser-fixture.html', 'src/styles.css', 'src/app.js', 'src/case-data.js', 'src/additional-cases.js', 'src/expanded-cases.js', 'src/save-store.js', 'src/game-engine.js']);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname.slice(1);
  if (!allowed.has(pathname)) { response.writeHead(404); response.end(); return; }
  try {
    response.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(await readFile(new URL(pathname, root)));
  } catch { response.end(); }
});
server.listen(44974, '127.0.0.1', () => console.log('저장 장애 검증 전용: http://127.0.0.1:44974/tests/browser-fixture.html'));
