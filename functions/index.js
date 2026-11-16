// OLD STOCK 챗봇 — Firebase Cloud Functions 진입점
// Firebase Hosting이 /api/** 요청을 이 함수(api)로 보냄. 처리 로직은 core.js(내 PC 서버와 같은 코드)
//
// 배포 전에 한 번:
//   firebase functions:secrets:set ANTHROPIC_API_KEY   ← Claude API 키 (직접 입력, 코드·저장소에 넣지 않음)
// 관리자 등록:
//   Firestore 콘솔 → admins 컬렉션 → 문서 ID를 관리자 Google 이메일(소문자)로 만들기

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const core = require('./core');
const seed = require('./seed-data.json');

initializeApp();
const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const auth = {
  // 브라우저가 보낸 Firebase 로그인 토큰 확인
  verify: (token) => getAuth().verifyIdToken(token),
  // 이메일 인증된 Google 계정이고, Firestore admins/{이메일} 문서가 있으면 관리자
  async isAdmin(user) {
    if (!user || !user.email || !user.email_verified) return false;
    const doc = await db.collection('admins').doc(String(user.email).toLowerCase()).get();
    return doc.exists;
  },
};

let handle = null;
exports.api = onRequest(
  {
    region: 'asia-northeast3',   // 서울
    secrets: [ANTHROPIC_API_KEY],
    maxInstances: 3,              // 갑자기 요청이 몰려도 서버가 3대 이상 늘지 않게 (비용 보호)
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  (req, res) => {
    if (!handle) {
      handle = core.createHandler({
        apiKey: ANTHROPIC_API_KEY.value(),
        model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
        effort: process.env.CLAUDE_EFFORT || 'low',
        store: core.firestoreStore(db),
        auth,
        seed,
        rateLimit: { max: 30, windowMs: 10 * 60 * 1000 }, // IP 하나당 10분에 Claude 질문 30번까지
      });
    }
    return handle(req, res);
  },
);
