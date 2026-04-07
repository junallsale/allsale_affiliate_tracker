# sync-notion
노션 DB로 affiliate_creators 데이터를 동기화합니다. 중복 체크 포함.

## 사용법
"[project명] [status]인 데이터를 노션 [URL or DB ID]에 복사해줘"

## 실행 명령
```bash
npx ts-node scripts/sync-to-notion.ts "[PROJECT]" "[STATUS]" "[NOTION_DB_ID]"
```

## 파라미터
- **PROJECT**: affiliate_creators.project 컬럼 값 (예: `DF_KOL`, `DF_Retainer`)
- **STATUS**: affiliate_creators.status 컬럼 값 (예: `단가 받음 진행 가능`, `협의중`)
- **NOTION_DB_ID**: Notion URL에서 추출 (예: `https://notion.so/xxx/[DB_ID]?v=...`)

## Notion DB URL → DB ID 추출
`https://www.notion.so/allsale/315c05e83dcc801b8d48fd06af9966c1?v=...`
→ DB ID = `315c05e83dcc801b8d48fd06af9966c1`

## 필드 매핑 (Supabase → Notion)
| Supabase | Notion |
|---|---|
| handle | Name (title), TikTok Handle |
| handle | TikTok 프로필 링크 (https://tiktok.com/@{handle}) |
| followers | 팔로워 수 |
| gmv | GMV (30일) |
| min_price | 영상 단가 (Min) |
| max_price | 영상 단가 (Max) |
| price_comment | 단가 메모 |
| recommendation_reason | 추천 사유 |
| tier | 추천 등급 |
| (fixed) | type = "KOL" |

## 중복 체크
- Notion DB의 TikTok Handle + Name 필드로 기존 항목 확인
- 이미 있는 handle은 스킵

## 환경변수 (.env.local)
- `NOTION_TOKEN`: Notion Integration 토큰
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key

## 예시
```bash
# 기본 (DF_KOL, 단가 받음 진행 가능 → 기본 DB)
npx ts-node scripts/sync-to-notion.ts

# 다른 프로젝트/상태
npx ts-node scripts/sync-to-notion.ts "DF_Retainer" "협의중" "abc123def456..."
```
