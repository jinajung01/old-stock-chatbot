// OLD STOCK 챗봇 — 내 PC에서 실행하는 서버
// - public/ 화면을 보여 주고, /api/... 요청은 functions/core.js(Firebase와 같은 코드)로 처리
// - 데이터는 data.json 파일에 저장, API 키는 .env에서 읽음 (브라우저로는 보내지 않음)
// - 이 PC에서만 열리므로 로그인 없이 관리자 기능을 쓸 수 있음
// 처음 한 번 `npm install` 후 `npm start`로 실행합니다. (Node.js 18 이상)

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- .env 읽기 ----------
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
})();

let core;
try {
  core = require('./functions/core');
} catch (e) {
  console.error('\n  필요한 패키지가 설치되지 않았어요. 이 폴더에서 먼저 `npm install`을 실행해 주세요.\n', e.message);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const MODEL = (process.env.CLAUDE_MODEL || 'claude-opus-5-5').trim();
const EFFORT = (process.env.CLAUDE_EFFORT || 'low').trim();
const DATA_FILE = path.join(__dirname, 'data.json');
const SEED_FILE = path.join(__dirname, 'functions', 'seed-data.json');

// 주소 → 화면 파일 (Firebase Hosting의 cleanUrls와 같은 주소 규칙)
const OLD_STOCK_PAGE = path.join(__dirname, 'public', 'index.html');   // OLD STOCK 챗봇 + 관리자
const MOREH_PAGE = path.join(__dirname, 'public', 'moreh.html');       // 모레상점 고객센터 (탭 1~3)
const PAGES = { '/': OLD_STOCK_PAGE, '/index.html': OLD_STOCK_PAGE, '/moreh': MOREH_PAGE, '/moreh.html': MOREH_PAGE };

const handle = core.createHandler({
  apiKey: API_KEY,
  model: MODEL,
  effort: EFFORT,
  store: core.fileStore(DATA_FILE),
  auth: null, // 이 PC 전용: 로그인 없이 관리자
  seed: fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) : null,
});

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && PAGES[p]) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(PAGES[p]).pipe(res);
  }
  return handle(req, res);
});

// 127.0.0.1: 이 PC에서만 접속 가능 (같은 와이파이의 다른 기기는 접속 불가 → API 키 비용·고객 정보·지침 보호)
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log(`  OLD STOCK 챗봇 서버가 켜졌어요 → http://localhost:${PORT}`);
  console.log(`  관리자 페이지 → http://localhost:${PORT}/#admin`);
  console.log(`  모레상점 고객센터(탭 1~3) → http://localhost:${PORT}/moreh`);
  console.log(`  Claude 모델: ${MODEL} (effort: ${EFFORT})`);
  if (!API_KEY) console.log('  ⚠ .env 파일에 ANTHROPIC_API_KEY가 비어 있어요. 키를 넣고 서버를 다시 켜 주세요.');
  console.log('  끄려면 Ctrl + C');
  console.log('');
});
