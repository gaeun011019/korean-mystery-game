import { createServer } from 'node:http';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectDirectory = fileURLToPath(new URL('.', import.meta.url));
const files = [
  'index.html',
  'src/styles.css',
  'src/app.js',
  'src/game-engine.js',
  'src/case-data.js',
  'src/additional-cases.js',
  'src/expanded-cases.js',
  'src/save-store.js',
];
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const command = process.argv[2] ?? 'dev';
const port = Number(process.env.PORT ?? 4173);

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('PORT는 1024~65535의 정수여야 합니다.');
  process.exitCode = 1;
} else if (!['dev', 'build', 'preview'].includes(command)) {
  console.error('사용법: node dev.mjs [dev|build|preview]');
  process.exitCode = 1;
} else if (command === 'build') {
  await build();
} else {
  await serve(command === 'preview' ? join(projectDirectory, 'dist') : projectDirectory);
}

async function build() {
  // 모든 원본의 존재를 먼저 확인해 불완전한 빌드를 방지한다.
  await Promise.all(files.map((filename) => readFile(join(projectDirectory, filename))));
  const outputDirectory = join(projectDirectory, 'dist');
  await mkdir(outputDirectory, { recursive: true });

  for (const filename of files) {
    const outputPath = join(outputDirectory, filename);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(join(projectDirectory, filename), outputPath);
  }

  console.log(`빌드 완료: dist/에 게임 파일 ${files.length}개를 복사했습니다.`);
}

async function serve(directory) {
  try {
    await readFile(join(directory, 'index.html'));
  } catch {
    console.error('게임 파일을 찾을 수 없습니다. preview는 npm run build 후 실행하세요.');
    process.exitCode = 1;
    return;
  }

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');

    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('Method not allowed');
      return;
    }

    let pathname;

    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Bad request');
      return;
    }

    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);

    if (!files.includes(filename)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }

    try {
      const content = await readFile(join(directory, filename));
      const extension = filename.slice(filename.lastIndexOf('.'));
      response.writeHead(200, {
        'Content-Type': contentTypes[extension],
        'Content-Length': content.length,
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : '게임 파일을 읽을 수 없습니다.');
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`${port} 포트를 이미 사용 중입니다. 기존 실행을 Ctrl+C로 종료해 주세요.`);
    } else {
      console.error(`서버를 실행하지 못했습니다: ${error.message}`);
    }

    process.exitCode = 1;
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`사건 수첩: http://127.0.0.1:${port} (${command})`);
    console.log('종료하려면 Ctrl+C를 누르세요.');
  });
}
