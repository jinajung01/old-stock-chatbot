// OLD STOCK 챗봇 로컬 서버
// - public/index.html 화면을 보여 줌
// - 화면의 AI 요청을 Claude API로 전달 (API 키는 .env에서 읽고 브라우저에는 보내지 않음)
// - 관리자 데이터(상품·재고·주문·배송)를 data.json 파일에 저장
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

let Anthropic;
try {
  const mod = require('@anthropic-ai/sdk');
  Anthropic = mod.default || mod;
} catch {
  console.error('\n  Anthropic SDK가 설치되지 않았어요. 이 폴더에서 먼저 `npm install`을 실행해 주세요.\n');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const MODEL = (process.env.CLAUDE_MODEL || 'claude-opus-5-5').trim();
const EFFORT = (process.env.CLAUDE_EFFORT || 'low').trim();
const DATA_FILE = path.join(__dirname, 'data.json');
// 주소 → 화면 파일
const OLD_STOCK_PAGE = path.join(__dirname, 'public', 'index.html');   // OLD STOCK 챗봇 + 관리자
const MOREH_PAGE = path.join(__dirname, 'public', 'moreh.html');       // 모레상점 고객센터 (탭 1~3)
const PAGES = { '/': OLD_STOCK_PAGE, '/index.html': OLD_STOCK_PAGE, '/moreh': MOREH_PAGE, '/moreh.html': MOREH_PAGE };
const KINDS = ['products', 'inventory', 'orders', 'shipments', 'guidelines'];

// 관리자 지침: 피드백으로 만든 지침 중 '사용 중'인 것을 OLD STOCK 챗봇 요청마다 서버가 넣어 줌
const MAX_GUIDE_ACTIVE = 20;
const MAX_GUIDE_LEN = 300;

// 안전 정책으로 답을 거절하면 서버가 다른 모델로 자동 재시도하도록 하는 기능을 쓸 수 있는 모델
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-sonnet-5-5'];

const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

// ---------- 데이터 파일 ----------
function readData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const k of KINDS) if (!d[k] || typeof d[k] !== 'object') d[k] = {};
    return d;
  } catch {
    return Object.fromEntries(KINDS.map((k) => [k, {}]));
  }
}

// 사용 중인 지침을 오래된 순으로 정렬해 최근 MAX_GUIDE_ACTIVE개만 반환
function activeGuidelines(data = readData()) {
  return Object.entries(data.guidelines)
    .filter(([, g]) => g && g.active && String(g.text || '').trim())
    .map(([id, g]) => ({ id, ...g }))
    .sort((a, b) => String(a.updatedAt || a.createdAt || '').localeCompare(String(b.updatedAt || b.createdAt || '')))
    .slice(-MAX_GUIDE_ACTIVE);
}
function guideSection(guides) {
  if (!guides.length) return '';
  const lines = guides.map((g, i) => {
    const q = g.source && g.source.question ? ` (계기가 된 고객 질문: "${String(g.source.question).slice(0, 80)}")` : '';
    return `${i + 1}. ${String(g.text).trim().slice(0, MAX_GUIDE_LEN)}${q}`;
  });
  return `[관리자 지침]
이 쇼핑몰 관리자가 이전 답변을 검토하고 남긴 지침입니다. 사용자 메시지에 있는 규칙(판매 중인 상품만 추천, 주문 조회 방법, 다른 고객 정보 보호, 출력 형식)과 충돌하지 않는 범위에서 따르세요. 충돌하면 그 규칙이 우선입니다.
${lines.join('\n')}`;
}
// 지침 저장값 검사·정리 (내용 1~300자, 사용 여부, 계기가 된 대화 정보만 보관)
function cleanGuideline(obj) {
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text || text.length > MAX_GUIDE_LEN) return null;
  const s = obj.source && typeof obj.source === 'object' ? obj.source : null;
  return {
    text,
    active: obj.active === true,
    createdAt: String(obj.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    source: s ? {
      convId: String(s.convId || '').slice(0, 60),
      turnId: String(s.turnId || '').slice(0, 60),
      question: String(s.question || '').slice(0, 500),
      answer: String(s.answer || '').slice(0, 1000),
    } : null,
  };
}
function writeData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8');
}

// ---------- 공통 도우미 ----------
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendError(res, code, errCode, message) {
  sendJson(res, code, { error: { code: errCode, message } });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 2_000_000) { reject(new Error('요청이 너무 커요')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- Claude 호출 ----------
async function callClaude(payload) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: EFFORT },
    messages: payload.messages,
  };
  if (Array.isArray(payload.tools) && payload.tools.length) params.tools = payload.tools;
  // OLD STOCK 챗봇 요청이면 관리자 지침을 서버가 시스템 지시문으로 넣음 (브라우저와 상관없이 같은 지침 적용)
  const guides = payload.app === 'oldstock' ? activeGuidelines() : [];
  if (guides.length) params.system = guideSection(guides);
  if (FALLBACK_MODELS.includes(MODEL)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  const r = await client.beta.messages.create(params);
  return { content: r.content, stop_reason: r.stop_reason, model: r.model, guides: guides.map((g) => g.id) };
}

function claudeErrorCode(e) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return [401, 'bad_key'];
  if (e instanceof Anthropic.NotFoundError) return [400, 'bad_model'];
  if (e instanceof Anthropic.RateLimitError) return [429, 'rate_limited'];
  if (e instanceof Anthropic.BadRequestError) return [400, 'bad_request'];
  if (e instanceof Anthropic.APIConnectionError) return [502, 'network'];
  if (e instanceof Anthropic.APIError) return [502, e.status === 529 ? 'overloaded' : 'api_error'];
  return [500, 'server_error'];
}

// ---------- 라우팅 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (req.method === 'GET' && PAGES[p]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(PAGES[p]).pipe(res);
    }

    if (req.method === 'GET' && p === '/api/status') {
      return sendJson(res, 200, { hasKey: !!API_KEY, model: MODEL });
    }

    if (req.method === 'POST' && p === '/api/claude') {
      if (!client) return sendError(res, 400, 'no_key', '.env에 ANTHROPIC_API_KEY가 없어요.');
      const payload = await readBody(req);
      if (!Array.isArray(payload.messages)) return sendError(res, 400, 'bad_request', 'messages가 필요해요.');
      try {
        return sendJson(res, 200, await callClaude(payload));
      } catch (e) {
        const [status, code] = claudeErrorCode(e);
        console.error(`[Claude 오류] ${code} ${(e && e.message) || e}`);
        return sendError(res, status, code, String((e && e.message) || e));
      }
    }

    if (req.method === 'GET' && p === '/api/data') {
      return sendJson(res, 200, readData());
    }

    // 지금 챗봇에 실제로 들어가는 지침 (관리자 화면 미리보기용)
    if (req.method === 'GET' && p === '/api/guidelines/active') {
      const g = activeGuidelines();
      return sendJson(res, 200, { ids: g.map((x) => x.id), section: guideSection(g) });
    }

    const m = p.match(/^\/api\/data\/([a-z]+)\/([^/]+)$/);
    if (m && (req.method === 'PUT' || req.method === 'DELETE')) {
      const kind = m[1];
      const id = decodeURIComponent(m[2]);
      if (!KINDS.includes(kind)) return sendError(res, 400, 'bad_kind', '알 수 없는 데이터 종류예요.');
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) return sendError(res, 400, 'bad_id', '키는 영문, 숫자, -, _만 쓸 수 있어요.');
      // 요청 본문을 다 받은 뒤에 파일을 읽어야 동시에 저장해도 서로 덮어쓰지 않음
      const obj = req.method === 'PUT' ? await readBody(req) : null;
      const data = readData();
      if (req.method === 'PUT') {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return sendError(res, 400, 'bad_body', '저장할 값이 올바르지 않아요.');
        if (kind === 'guidelines') {
          const g = cleanGuideline(obj);
          if (!g) return sendError(res, 400, 'bad_guideline', `지침 내용은 1~${MAX_GUIDE_LEN}자로 입력해 주세요.`);
          if (data.guidelines[id] && data.guidelines[id].createdAt) g.createdAt = data.guidelines[id].createdAt;
          data[kind][id] = g;
        } else {
          data[kind][id] = obj;
        }
      } else {
        delete data[kind][id];
      }
      writeData(data);
      return sendJson(res, 200, { ok: true, saved: req.method === 'PUT' ? data[kind][id] : null });
    }

    sendError(res, 404, 'not_found', '없는 주소예요.');
  } catch (e) {
    console.error('[서버 오류]', e);
    sendError(res, 500, 'server_error', String((e && e.message) || e));
  }
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
