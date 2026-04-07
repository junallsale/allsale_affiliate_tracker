Affiliate 데이터를 Google Sheets에 붙여넣을 수 있도록 TSV 표로 정리해줘.

## 절차

1. Supabase MCP `execute_sql`로 아래 쿼리 실행 (project_id: kzfzgrblbvdmzsfcdkhq):

```sql
SELECT
  ac.id,
  ac.handle,
  ac.email,
  ac.contact_type,
  ac.followers,
  ac.avg_view,
  ac.engagement,
  ac.gmv,
  ac.max_price,
  ac.min_price,
  ac.price_comment,
  ac.tier,
  ac.category,
  ac.planned_video_count,
  ac.price_per_video,
  ac.contract_amount,
  ac.payment_method,
  ac.thread,
  ac.recommendation_reason,
  ac.live_commission,
  ac.live_price,
  b.name AS brand_name,
  p.name AS project_name
FROM affiliate_creators ac
LEFT JOIN brands b ON ac.brand_id = b.id
LEFT JOIN projects p ON ac.project_id = p.id
WHERE ac.status = '단가 받음 진행 가능'
ORDER BY p.name, ac.handle
```

2. 결과를 **프로젝트별로 그룹핑**하여 각각 TSV(탭 구분) 표로 출력:
   - 각 그룹 앞에 `## 프로젝트명 (N건)` 헤더
   - 헤더 행 포함
   - 숫자는 포맷 없이 raw 값 그대로 (쉼표 없이)
   - null/빈값은 빈 문자열로

3. **컬럼 순서:**
   Handle, Email, Contact Type, Followers, Avg View, Engagement(%), GMV, Max Price, Min Price, Price Comment, Tier, Category, Planned Videos, Price/Video, Contract Amount, Payment Method, Thread, Recommendation, LIVE Commission, LIVE Price

4. project_id가 NULL인 행은 `## 미배정 (N건)` 그룹으로 별도 출력

5. 표 출력이 완료되면, 해당 행들의 상태를 '컨펌 요청'으로 변경:

```sql
UPDATE affiliate_creators
SET status = '컨펌 요청', updated_at = now()
WHERE status = '단가 받음 진행 가능'
```

6. 변경된 행 수를 알려줘.

## 주의사항
- 데이터가 0건이면 "동기화할 데이터가 없습니다 (status='단가 받음 진행 가능' 인 행이 없음)" 출력 후 종료
- UPDATE 전에 반드시 사용자에게 "N건의 상태를 '컨펌 요청'으로 변경합니다" 확인 받기
