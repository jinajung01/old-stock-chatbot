# OLD STOCK 챗봇

빈티지 쇼핑몰 상담 챗봇이에요. Claude API로 상품을 찾아 주고 주문·배송을 조회해요. 관리자는 대화에 피드백을 남겨 챗봇 답변을 계속 고칠 수 있어요.

- **내 PC에서 실행**: 아래 "실행 방법" (데이터는 `data.json`, 로그인 없음, 이 PC에서만 접속 가능)
- **Firebase에 배포**: 아래 "Firebase 배포" (데이터는 Firestore, 관리자는 Google 로그인)

## 준비물

- **Node.js 18 이상** — 없으면 https://nodejs.org 에서 LTS 버전을 설치하세요.
  설치 확인: 터미널에서 `node -v`
- **Claude API 키** (`sk-ant-`로 시작, platform.claude.com에서 발급)

## 실행 방법

1. 이 폴더의 `.env` 파일을 열고 따옴표 안에 키를 붙여넣고 저장합니다.
   ```
   ANTHROPIC_API_KEY="여기에_키"
   ```
2. 터미널에서 이 폴더로 이동해 처음 한 번 패키지를 설치합니다.
   ```
   npm install
   ```
3. 서버를 켭니다.
   ```
   npm start
   ```
4. 브라우저에서 아래 주소를 엽니다.
   - OLD STOCK 챗봇: http://localhost:3000
   - OLD STOCK 관리자 페이지: http://localhost:3000/#admin
   - 모레상점 고객센터(탭 1~3): http://localhost:3000/moreh
5. 끄려면 터미널에서 `Ctrl + C`

> `index.html`을 더블클릭해서 열면 AI와 데이터가 작동하지 않아요. 꼭 서버를 켜고 주소로 여세요.
> `.env`를 고친 뒤에는 서버를 껐다가 다시 켜야 반영돼요.

## 모델과 비용

`.env`에서 바꿀 수 있어요. (100만 토큰당 가격)

| 설정 | 값 | 설명 |
|------|----|------|
| `CLAUDE_MODEL` | `claude-opus-5-5` (기본) | 가장 똑똑함 · 입력 $4 / 출력 $20 |
| | `claude-haiku-5-5` | 빠르고 저렴함 · 입력 $0.10 / 출력 $0.50 |
| `CLAUDE_EFFORT` | `low` (기본) / `medium` / `high` | 높을수록 더 깊이 생각하지만 느리고 비싸요 |

Opus 5.5를 쓸 때는 Claude가 안전 정책으로 답을 거절하면 다른 모델이 자동으로 이어서 답하는 기능(fallback)이 켜져 있어요.

## 화면 구성

**OLD STOCK 챗봇** (`/`) — Claude가 빈티지 상품을 찾아 주고 주문·배송을 조회해요. 관리자 페이지(`/#admin`)에서 상품·재고·주문·배송 데이터를 고칠 수 있어요.

**모레상점 고객센터** (`/moreh`)

| 탭 | 내용 |
|----|------|
| 탭 1 | AI 없이 미리 정한 시나리오로 답변 |
| 탭 2 | Claude · 주제 제한 없음 |
| 탭 3 | Claude · 쇼핑몰 주제만 답변 |

## 대화 기록 · 피드백 · 관리자 지침

OLD STOCK 챗봇과 나눈 대화는 브라우저의 **localStorage**에 자동으로 저장되고, 관리자 페이지에서 보고 피드백할 수 있어요. 피드백으로 만든 **지침은 서버(`data.json`의 `guidelines`)에 저장**되고, 챗봇 요청마다 서버가 사용 중인 지침을 Claude의 시스템 지시문으로 넣어요.

1. **대화 기록** 탭 — 대화 목록(시작 시각, 고객, 질문 수, 피드백 상태). 대화를 누르면 질문·답변·추천 상품·조회한 주문·응답 시간이 보여요.
2. 답변마다 **좋음 / 개선 필요**를 고르고 피드백을 쓴 뒤 **"다음 답변부터 챗봇 지침으로 반영"**을 체크해 저장하면 지침이 만들어져요.
3. **지침** 탭 — 지침을 켜고 끄거나 고치고, 직접 추가할 수 있어요. "챗봇에 전달되는 내용 보기"로 실제로 들어가는 문구를 확인할 수 있어요.
4. 고객이 질문할 때마다 서버가 사용 중인 지침(최근 20개)을 `[관리자 지침]`으로 넣어요. 어느 브라우저에서 질문해도 똑같이 반영돼요. 상품 목록·주문 조회·개인정보 보호 규칙이 지침보다 우선이에요.

알아 둘 점
- **대화 기록**은 브라우저에 저장돼서, 같은 브라우저·같은 주소(예: `http://localhost:3001`)에서 나눈 대화만 보여요. **지침**은 서버에 있어서 모든 브라우저에 공통이에요.
- 예전 버전에서 브라우저에 저장해 둔 지침은 관리자·챗봇 화면을 열 때 서버로 자동으로 옮겨져요.
- 브라우저 데이터(쿠키·사이트 데이터)를 지우면 대화 기록도 함께 지워져요(지침은 서버에 있어 그대로). 필요하면 대화 기록 탭의 **내보내기**로 JSON 파일을 받아 두세요.
- Firebase에 배포해도 대화 기록은 각 손님 브라우저에 저장돼요. 관리자는 **자기 브라우저에서 나눈 대화만** 볼 수 있어요.
- 대화는 최근 300건까지 보관하고, 저장 공간이 모자라면 오래된 대화부터 지워요.
- 기록에는 고객 이름·주문 정보가 들어 있으니 공용 PC에서는 다 쓴 뒤 **기록 비우기**를 해 주세요.

## Firebase 배포

구성: **Hosting**(화면 `public/`) + **Cloud Functions**(서버 `/api/**`, 서울 리전) + **Firestore**(데이터) + **Authentication**(관리자 Google 로그인)

### 처음 한 번 준비

1. **Firebase 프로젝트 고르기** — [Firebase 콘솔](https://console.firebase.google.com)에서 기존 프로젝트를 쓰거나 새로 만들어요.
   - 기존 프로젝트를 쓰면 이미 배포된 사이트가 이 앱으로 바뀌고, Firestore 보안 규칙도 이 프로젝트의 `firestore.rules`로 덮어써져요.
2. **요금제를 Blaze(쓴 만큼 결제)로 변경** — Cloud Functions가 Claude API를 부르려면 필요해요. 콘솔 → 사용량 및 결제에서 **예산 알림**도 꼭 설정하세요.
3. **Firestore 만들기** — 콘솔 → Firestore Database → 데이터베이스 만들기 (위치: `asia-northeast3` 서울 권장)
4. **Google 로그인 켜기** — 콘솔 → Authentication → 시작하기 → 로그인 방법 → Google 사용 설정
5. **관리자 등록** — 콘솔 → Firestore → 컬렉션 `admins` 만들기 → **문서 ID에 관리자 Google 이메일(소문자)**을 넣고 저장 (필드는 아무거나 하나, 예: `name`)
6. **Firebase CLI 설치·로그인** (터미널)
   ```
   npm install -g firebase-tools
   firebase login
   ```
7. **프로젝트 연결** — 이 폴더에서 실행하고 1번 프로젝트를 고르세요. (`.firebaserc` 파일이 생겨요)
   ```
   firebase use --add
   ```
8. **Claude API 키 등록** — 키는 코드나 저장소에 넣지 않고 Firebase 비밀 저장소에 넣어요. 명령을 실행하면 키를 붙여넣으라고 나와요.
   ```
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```

### 배포

```
npm install --prefix functions
firebase deploy
```

끝나면 `https://<프로젝트ID>.web.app` 주소가 나와요.

1. `https://<프로젝트ID>.web.app/#admin` → **Google로 관리자 로그인** (5번에서 등록한 이메일)
2. 상품 탭의 **예시 데이터 넣기**를 누르면 기본 상품·재고·주문·배송이 들어가요. (상품이 하나도 없을 때만 보여요)

### GitHub에 올리면 자동 배포 (선택)

`.github/workflows/firebase-deploy.yml`이 `main` 브랜치에 올라올 때마다 Hosting·Functions·Firestore 규칙을 배포해요. GitHub 저장소 → Settings → Secrets and variables → Actions 에서:

- **Variables** 탭: `FIREBASE_PROJECT_ID` = Firebase 프로젝트 ID
- **Secrets** 탭: `FIREBASE_SERVICE_ACCOUNT` = 배포용 서비스 계정 키(JSON) 전체
  - Google Cloud 콘솔 → IAM 및 관리자 → 서비스 계정 → 계정 만들기 → 역할: **Firebase 관리자**, **Cloud Functions 관리자**, **서비스 계정 사용자**, **Secret Manager 보안 비밀 접근자** → 키 → JSON 키 만들기
  - 받은 JSON 파일은 저장소에 올리지 말고 등록 후 지우세요.

두 값을 등록하기 전에는 자동 배포가 실행되지 않고 건너뛰어요.

### 배포했을 때 보안

- 관리자 기능(데이터·지침 수정, 지침 미리보기, 예시 데이터)은 **`admins`에 등록된 이메일로 로그인한 사람만** 쓸 수 있어요. 손님에게는 지침 내용도 보이지 않아요.
- 브라우저는 Firestore에 직접 접근할 수 없어요(`firestore.rules`가 모두 막음). 모든 읽기·쓰기는 서버를 거쳐요.
- Claude 질문은 IP 하나당 **10분에 30번**까지, 서버는 최대 3대까지만 늘어나요. 그래도 **API 사용 한도와 Firebase 예산 알림**을 꼭 설정하세요.
- 주문·배송 데이터는 챗봇 데모를 위해 손님도 읽을 수 있어요. **실제 고객 정보는 넣지 마세요.**

## 파일 설명

| 파일 | 역할 |
|------|------|
| `server.js` | 내 PC용 서버. 화면을 보여 주고 `/api/**` 요청을 `functions/core.js`로 넘김 |
| `functions/core.js` | 서버 핵심 코드 (내 PC와 Firebase가 같이 사용): Claude 호출, 데이터 저장, 관리자 확인, 지침 반영 |
| `functions/index.js` | Firebase Cloud Functions 진입점 (Firestore·로그인 연결) |
| `functions/seed-data.json` | Firebase에 처음 넣는 예시 데이터 |
| `public/index.html` | OLD STOCK 챗봇·관리자 화면 |
| `public/moreh.html` | 모레상점 고객센터 화면 (탭 1~3) |
| `data.json` | 내 PC에서 쓰는 가상 데이터 (관리자 페이지에서 수정하면 여기에 저장) |
| `firebase.json`, `firestore.rules` | Firebase 배포 설정, Firestore 보안 규칙 |
| `.env` | 내 PC용 API 키 (공유·커밋 금지) |

## 테스트해 볼 질문 (OLD STOCK)

- "90년대 느낌의 L 사이즈 재킷"
- "5만 원 이하 가을 옷"
- 로그인 고객을 **김하늘 (C001)** 로 두고 "내 주문 배송 조회"
- 비로그인 상태에서 "주문번호 OS261114007, 이름 김하늘로 배송 조회"
