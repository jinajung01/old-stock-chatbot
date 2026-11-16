// OLD STOCK 챗봇 서버 핵심 코드
// - 내 PC(server.js)와 Firebase(Cloud Functions, functions/index.js)가 이 파일을 함께 사용
// - 데이터 저장 방식(store)과 관리자 확인 방식(auth)만 바꿔 끼움
//     내 PC:    data.json 파일 + 로그인 없음(이 PC에서만 열리므로 모두 관리자)
//     Firebase: Firestore + Google 로그인 + Firestore의 admins 컬렉션에 있는 이메일만 관리자

const fs = require('fs');

const KINDS = ['products', 'inventory', 'orders', 'shipments', 'guidelines'];
const MAX_GUIDE_ACTIVE = 20;
const MAX_GUIDE_LEN = 300;
const MAX_BODY = 2_000_000;
// 안전 정책으로 답을 거절하면 서버가 다른 모델로 자동 재시도하는 기능(fallback)을 쓸 수 있는 모델
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-sonnet-5-5'];

function loadAnthropic() {
  const mod = require('@anthropic-ai/sdk');
  return mod.default || mod;
}

// ---------- 오류·응답 도우미 ----------
function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

// 요청 본문(JSON) 읽기. Cloud Functions는 본문을 미리 읽어 req.rawBody에 넣어 둠
function readBody(req) {
  const parse = (s) => {
    if (!s) return {};
    try { return JSON.parse(s); } catch { throw httpError(400, 'bad_json', 'JSON 형식이 올바르지 않아요.'); }
  };
  if (req.rawBody !== undefined) {
    const s = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody || '');
    if (s.length > MAX_BODY) return Promise.reject(httpError(413, 'too_large', '요청이 너무 커요.'));
    return Promise.resolve().then(() => parse(s));
  }
  return new Promise((resolve, reject) => {
    let s = '';
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;            // 너무 크면 버리면서 끝까지 받기만 함 (연결을 끊지 않고 413으로 답하기 위해)
      s += c;
      if (s.length > MAX_BODY) { tooBig = true; s = ''; }
    });
    req.on('end', () => {
      if (tooBig) return reject(httpError(413, 'too_large', '요청이 너무 커요.'));
      try { resolve(parse(s)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- 관리자 지침 ----------
// 사용 중인 지침을 오래된 순으로 정렬해 최근 MAX_GUIDE_ACTIVE개만 반환
function activeGuidelines(guidelines) {
  return Object.entries(guidelines || {})
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
function cleanGuideline(obj, prevCreatedAt) {
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text || text.length > MAX_GUIDE_LEN) return null;
  const s = obj.source && typeof obj.source === 'object' ? obj.source : null;
  const now = new Date().toISOString();
  return {
    text,
    active: obj.active === true,
    createdAt: String(prevCreatedAt || obj.createdAt || now),
    updatedAt: now,
    source: s ? {
      convId: String(s.convId || '').slice(0, 60),
      turnId: String(s.turnId || '').slice(0, 60),
      question: String(s.question || '').slice(0, 500),
      answer: String(s.answer || '').slice(0, 1000),
    } : null,
  };
}

// ---------- 저장소: 내 PC용 data.json ----------
function fileStore(file) {
  const read = () => {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const k of KINDS) if (!d[k] || typeof d[k] !== 'object') d[k] = {};
      return d;
    } catch {
      return Object.fromEntries(KINDS.map((k) => [k, {}]));
    }
  };
  const write = (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2), 'utf8');
  // 읽기→고치기→쓰기를 한 번에(중간에 기다리는 일 없이) 해서 동시 저장에도 서로 덮어쓰지 않음
  return {
    async readAll() { return read(); },
    async readKind(k) { return read()[k]; },
    async get(k, id) { return read()[k][id] || null; },
    async set(k, id, obj) { const d = read(); d[k][id] = obj; write(d); },
    async remove(k, id) { const d = read(); delete d[k][id]; write(d); },
    async replaceAll(seed) { const d = read(); for (const k of KINDS) if (k !== 'guidelines') d[k] = seed[k] || {}; write(d); },
  };
}

// ---------- 저장소: Firebase용 Firestore (종류마다 컬렉션 하나) ----------
function firestoreStore(db) {
  const readKind = async (k) => {
    const out = {};
    (await db.collection(k).get()).forEach((doc) => { out[doc.id] = doc.data(); });
    return out;
  };
  return {
    async readAll() {
      const entries = await Promise.all(KINDS.map(async (k) => [k, await readKind(k)]));
      return Object.fromEntries(entries);
    },
    readKind,
    async get(k, id) { const d = await db.collection(k).doc(id).get(); return d.exists ? d.data() : null; },
    async set(k, id, obj) { await db.collection(k).doc(id).set(obj); },
    async remove(k, id) { await db.collection(k).doc(id).delete(); },
    // 기본 데이터 넣기: 기존 상품·재고·주문·배송을 지우고 새로 씀 (지침은 그대로)
    async replaceAll(seed) {
      for (const k of KINDS) {
        if (k === 'guidelines') continue;
        const old = await db.collection(k).get();
        let batch = db.batch(); let n = 0;
        const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
        for (const doc of old.docs) { batch.delete(doc.ref); if (++n >= 400) await flush(); }
        for (const [id, v] of Object.entries(seed[k] || {})) { batch.set(db.collection(k).doc(id), v); if (++n >= 400) await flush(); }
        await flush();
      }
    },
  };
}

// ---------- 사용 횟수 제한 (IP별, 서버 인스턴스 안에서만 셈) ----------
function makeLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || (req.socket && req.socket.remoteAddress) || 'unknown';

// ---------- 요청 처리기 ----------
// opts: { apiKey, model, effort, store, auth, rateLimit, seed }
//   auth 없음 → 로컬 모드(모두 관리자)
//   auth = { verify(token) → 사용자 정보, isAdmin(사용자) → true/false }
function createHandler(opts) {
  const { apiKey, model, effort, store, auth, seed } = opts;
  const Anthropic = loadAnthropic();
  const client = apiKey ? new Anthropic({ apiKey }) : null;
  const limiter = opts.rateLimit ? makeLimiter(opts.rateLimit) : null;
  const mode = auth ? 'firebase' : 'local';

  async function whoIs(req) {
    if (!auth) return { mode, admin: true, email: null };
    const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return { mode, admin: false, email: null };
    try {
      const user = await auth.verify(m[1]);
      return { mode, admin: !!(await auth.isAdmin(user)), email: user.email || null };
    } catch {
      return { mode, admin: false, email: null };
    }
  }
  async function requireAdmin(req) {
    const me = await whoIs(req);
    if (me.admin) return me;
    if (me.email) throw httpError(403, 'not_admin', `${me.email} 계정은 관리자로 등록되어 있지 않아요.`);
    throw httpError(401, 'login_required', '관리자로 로그인해 주세요.');
  }

  async function callClaude(payload) {
    const params = {
      model,
      max_tokens: 16000,
      output_config: { effort },
      messages: payload.messages,
    };
    if (Array.isArray(payload.tools) && payload.tools.length) params.tools = payload.tools;
    // OLD STOCK 챗봇 요청이면 관리자 지침을 서버가 시스템 지시문으로 넣음 (브라우저와 상관없이 같은 지침 적용)
    const guides = payload.app === 'oldstock' ? activeGuidelines(await store.readKind('guidelines')) : [];
    if (guides.length) params.system = guideSection(guides);
    if (FALLBACK_MODELS.includes(model)) {
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

  return async function handle(req, res) {
    const p = new URL(req.url, 'http://localhost').pathname;
    const method = req.method;
    try {
      if (method === 'GET' && p === '/api/status') {
        return sendJson(res, 200, { hasKey: !!client, model, mode });
      }

      // 지금 접속한 사람이 관리자인지 (관리자 화면이 로그인 버튼·편집 가능 여부를 정할 때 사용)
      if (method === 'GET' && p === '/api/me') {
        return sendJson(res, 200, await whoIs(req));
      }

      if (method === 'POST' && p === '/api/claude') {
        if (!client) throw httpError(400, 'no_key', 'Claude API 키가 설정되어 있지 않아요.');
        if (limiter && !limiter(clientIp(req))) throw httpError(429, 'too_many', '질문이 너무 많아요. 잠시 뒤에 다시 보내 주세요.');
        const payload = await readBody(req);
        if (!Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 40) {
          throw httpError(400, 'bad_request', 'messages가 올바르지 않아요.');
        }
        try {
          return sendJson(res, 200, await callClaude(payload));
        } catch (e) {
          const [status, code] = claudeErrorCode(e);
          console.error(`[Claude 오류] ${code} ${(e && e.message) || e}`);
          return sendError(res, status, code, String((e && e.message) || e));
        }
      }

      // 화면에 필요한 데이터. 지침은 관리자에게만 보여 줌
      if (method === 'GET' && p === '/api/data') {
        const [me, data] = await Promise.all([whoIs(req), store.readAll()]);
        if (!me.admin) data.guidelines = {};
        return sendJson(res, 200, data);
      }

      // 지금 챗봇에 실제로 들어가는 지침 (관리자 화면 미리보기용)
      if (method === 'GET' && p === '/api/guidelines/active') {
        await requireAdmin(req);
        const g = activeGuidelines(await store.readKind('guidelines'));
        return sendJson(res, 200, { ids: g.map((x) => x.id), section: guideSection(g) });
      }

      // 기본(예시) 데이터 넣기: 상품이 하나도 없을 때만, 또는 force:true일 때
      if (method === 'POST' && p === '/api/admin/seed') {
        await requireAdmin(req);
        if (!seed) throw httpError(404, 'no_seed', '기본 데이터가 없어요.');
        const body = await readBody(req);
        const products = await store.readKind('products');
        if (Object.keys(products).length && body.force !== true) {
          throw httpError(409, 'not_empty', '이미 상품 데이터가 있어요. 덮어쓰려면 force를 켜 주세요.');
        }
        await store.replaceAll(seed);
        return sendJson(res, 200, { ok: true });
      }

      const m = p.match(/^\/api\/data\/([a-z]+)\/([^/]+)$/);
      if (m && (method === 'PUT' || method === 'DELETE')) {
        await requireAdmin(req);
        const kind = m[1];
        const id = decodeURIComponent(m[2]);
        if (!KINDS.includes(kind)) throw httpError(400, 'bad_kind', '알 수 없는 데이터 종류예요.');
        if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) throw httpError(400, 'bad_id', '키는 영문, 숫자, -, _만 쓸 수 있어요.');
        if (method === 'DELETE') {
          if (!(await store.get(kind, id))) throw httpError(404, 'not_found', '이미 없는 항목이에요.');
          await store.remove(kind, id);
          return sendJson(res, 200, { ok: true, saved: null });
        }
        const obj = await readBody(req);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw httpError(400, 'bad_body', '저장할 값이 올바르지 않아요.');
        let saved = obj;
        if (kind === 'guidelines') {
          const prev = await store.get(kind, id);
          saved = cleanGuideline(obj, prev && prev.createdAt);
          if (!saved) throw httpError(400, 'bad_guideline', `지침 내용은 1~${MAX_GUIDE_LEN}자로 입력해 주세요.`);
        }
        await store.set(kind, id, saved);
        return sendJson(res, 200, { ok: true, saved });
      }

      throw httpError(404, 'not_found', '없는 주소예요.');
    } catch (e) {
      if (e && e.status) return sendError(res, e.status, e.code, e.message);
      console.error('[서버 오류]', e);
      return sendError(res, 500, 'server_error', String((e && e.message) || e));
    }
  };
}

module.exports = { KINDS, createHandler, fileStore, firestoreStore, activeGuidelines, guideSection, cleanGuideline };
