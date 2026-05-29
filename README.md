# ALLSALE Affiliate Tracker

TikTok Shop 크리에이터 마케팅 캠페인을 관리하는 어드민 도구. 브랜드별 캠페인, 크리에이터 계약/정산, 영상 성과 추적, 이메일 자동화를 한 곳에서 운영한다.

Next.js (App Router) + Supabase 기반이며 Vercel에 배포된다.

---

## 데모 계정

외부 공유용 데모 계정. 가상 브랜드(Aurelia Skin)의 가공 데이터만 보이며, 실제 브랜드 데이터는 노출되지 않는다.

| 항목 | 값 |
|---|---|
| URL | https://allsale-affiliate-tracker.vercel.app/admin/login |
| Email | `demo@allsale.ai` |
| Password | `AllsaleDemo2026!` |
| 권한 | `brand_viewer` (배정된 데모 브랜드 대시보드만 접근) |

로그인하면 데모 브랜드 대시보드(`/admin/brands/demo-aurelia`)로 자동 이동한다.

---

## 주요 기능

### 캠페인 운영
- **Brands / Projects**: 브랜드별 캠페인(프로젝트) 생성과 관리. 제품, 번들, 콘텐츠 가이드, 샘플 초대 링크 관리.
- **Project 대시보드**: 크리에이터 수, 업로드/배정 영상 수, 총 조회수, GMV, 계약 금액, 정산액, 예산을 요약 카드로 표시. TikTok 성과 새로고침.
- **Creator Database**: 마스터 크리에이터 풀(`creator_master`). 단가/티어/카테고리 인라인 편집, CSV 내보내기.
- **Affiliates**: Notion 스타일 편집 테이블. 커스텀 뷰/필터/정렬/컬럼, 코멘트, CSV 임포트, 프로젝트 배정, TikTok 데이터 enrich.

### 계약 & 정산
- **크리에이터 포털** (`/c/[slug]`, 무인증): 계약 조건 확인, 캔버스 전자서명, 법적 이름 + 결제 정보(PayPal/ACH) 입력. 제출 시 계약 PDF 생성 후 이메일 발송.
- **Payments / Finance** (super_admin): 프로젝트 크리에이터 정산 통합 관리, 브랜드별 월간 계약 금액, 인보이스 확정/환불 추적.

### 영상 성과
- **Videos**: 제출된 TikTok 영상의 조회수/좋아요/댓글/공유/GMV 추적. TikTok Shop 분석 API로 성과 새로고침.

### 이메일 자동화
- **Email Queue**: AI가 생성한 답장 초안 검토(pending/reminder/unmatched/sent/dismissed/escalated). Gmail 연결, 수동 폴링, 발송/무시.
- **Cron**:
  - `poll-emails` (매시간): 활성 Gmail 계정의 수신 메일을 폴링, 크리에이터에 매칭, Claude Haiku로 분류, 계약 수정/배송 문의는 Slack 에스컬레이션, 그 외엔 답장 초안 생성.
  - `daily-remind` (매일 14:00 UTC): 미서명/미업로드/무응답 상태별 리마인더 초안과 Slack 에스컬레이션 생성.

### 공유 뷰
- **`/v/[slug]`** (무인증): 저장된 affiliate 테이블 뷰의 공유 스냅샷.

---

## 권한 (Roles)

4개 역할. 미들웨어(`src/middleware.ts`)가 `/admin/*` 경로를 강제하고, 레이아웃(`src/app/admin/layout.tsx`)이 DB(`admin_users`)에서 역할을 확정해 사이드바를 렌더한다.

| Role | 접근 범위 |
|---|---|
| `super_admin` | 전체. Payments, Finance, Users 포함 |
| `operator` | Affiliates, Brands, Creators, Checklist, Pricing, Email Queue |
| `brand_manager` | 배정된 브랜드로 스코프 (미들웨어 경로 잠금은 미적용) |
| `brand_viewer` | 배정 브랜드 대시보드 + Pricing만. 사이드바 없음 |

`brand_viewer`/`brand_manager`는 `brand_manager_assignments` 테이블로 브랜드가 배정된다. 권한 없는 메뉴 클릭 시 접근 불가 안내가 표시된다.

---

## 기술 스택

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS v4, Radix UI (shadcn 스타일), lucide-react
- **Backend**: Supabase (Auth + Postgres + Storage)
- **PDF**: pdfkit, jspdf (계약서 생성)
- **AI**: Anthropic Claude Haiku (이메일 분류)
- **배포**: Vercel (cron 포함)

---

## 외부 연동

| 연동 | 용도 | 위치 |
|---|---|---|
| Supabase | Auth, DB, Storage(`invoices` 버킷) | 전역 |
| TikTok Shop API | 크리에이터 마켓플레이스 enrich, 영상 성과 | `src/lib/tiktok-api.ts` 등 |
| Gmail OAuth | 이메일 송수신 자동화 | `src/lib/gmail.ts`, `api/auth/gmail/*` |
| Slack | 에스컬레이션 알림 | `src/lib/slack.ts` |
| Anthropic | 이메일 분류 (Haiku) | `src/lib/email-classifier.ts` |
| OpenAI / Notion / Postgres | 스크립트 전용 (단가 추출, 동기화, 임포트) | `scripts/` |

> TikTok 인증 정보(access_token, shop_cipher)는 별도 Supabase DB(`TIKTOK_DB_*`)의 `user_tiktok_info`에서 읽는다.

---

## 시작하기

```bash
npm install

# .env.local 작성 (아래 환경변수 참고)

npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # 린트
```

스크립트는 `npx tsx scripts/<name>.ts`로 실행한다 (`.env.local`을 런타임에 로드).

---

## 환경변수

`.env.local`에 설정한다.

**Supabase (필수)**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # 프로덕션 권장 (Storage/RLS 우회 쓰기)
```

**앱**
```
NEXT_PUBLIC_APP_URL=
CRON_SECRET=                   # cron 인증
```

**TikTok Shop API**
```
TIKTOK_APP_KEY=
TIKTOK_APP_SECRET=
TIKTOK_SHOP_ID=
TIKTOK_DB_SUPABASE_URL=
TIKTOK_DB_SUPABASE_KEY=
```

**Gmail / Google OAuth**
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

**AI / 알림**
```
ANTHROPIC_API_KEY=
SLACK_BOT_TOKEN=
```

**스크립트 전용**
```
OPEN_AI_KEY=                   # 단가 추출
NOTION_TOKEN=                  # Notion 동기화
DB_HOST= DB_PORT= DB_USER= DB_PASSWORD= DB_NAME=   # 프로덕션 Postgres
```

---

## 디렉토리 구조

```
src/
  app/
    admin/          어드민 페이지 (인증 필요)
    c/[slug]/       크리에이터 계약 포털 (무인증)
    v/[slug]/       공유 뷰 (무인증)
    api/            API 라우트
  components/        UI 컴포넌트
  hooks/            useUserRole, useFavoriteProjects 등
  lib/              supabase, tiktok-api, gmail, slack, email-* 등
  types/            database.ts (DB 타입)
scripts/            크리에이터 수집/enrich/임포트/동기화 (tsx 실행)
```

### 주요 테이블

`brands` → `projects` → `project_creators`(중심 junction) → `videos` / `payments` / `project_creator_reviews`. 크리에이터 정체성은 `creators`, 마스터 풀은 `creator_master`, 소싱은 `affiliate_creators`. 권한은 `admin_users` + `brand_manager_assignments`. 이메일 자동화는 `email_accounts` / `email_messages` / `email_drafts` / `email_templates`.

---

## 배포

Vercel에 배포된다. `vercel.json`에 cron(`poll-emails` 매시간, `daily-remind` 매일)과 함수 타임아웃이 정의돼 있다. 이 repo만 Vercel이 watch한다.
