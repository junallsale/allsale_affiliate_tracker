/**
 * Slack escalation service — sends alerts to the escalation channel
 *
 * ★ 2026-08-11: 채널을 #partner-success 로 고쳤다.
 *   그 전 기본값 'C0AR6PNDYAJ' 는 **존재하지 않는 채널**이었다(conversations.info →
 *   channel_not_found). 그래서 2026-04-07 ~ 08-10 사이 에스컬레이션 413건이
 *   한 통도 도착하지 않았다(7_days_no_reply 379 · contract_modification 20 ·
 *   signed_shipping_on 14, Old DB email_messages 실측).
 *
 *   에스컬레이션은 PS팀이 받아 처리하는 일이라 #partner-success 로 보낸다
 *   (C090SJ486P6, 2026-08-11 conversations.info 로 존재·봇 멤버 확인).
 *
 * ★ 환경변수로 덮어쓸 수 있게 했다.
 *   전에는 상수 하나뿐이라 채널을 옮기려면 코드를 고쳐 재배포해야 했고,
 *   그 값이 죽어 있으면 **조용히 아무 데도 안 가는 상태**가 그대로 운영 동작이 됐다.
 *   동작하지 않는 기본값은 폴백이 아니라 조용한 고장이다.
 *
 * ⚠️ 알려진 한계 (이 커밋이 고치지 않은 것)
 *   호출부 3곳(cron/daily-remind, cron/poll-emails, emails/escalate)은
 *   escalateToSlack 의 반환값을 보지 않고 중복 방지 마커를 남긴다.
 *   발송이 실패해도 마커가 남으므로 그 건은 다시 나가지 않는다.
 *   signed_shipping_on 은 시간 조건 없는 **영구** 마커라 특히 그렇다.
 *   ops-admin 쪽에는 성공했을 때만 마커를 남기도록 고쳐 두었다
 *   (allsale-ops-admin/lib/tracker/slack-escalation.ts 참조).
 */

/** #partner-success (C090SJ486P6). 환경변수로 덮어쓸 수 있다. */
const SLACK_CHANNEL = process.env.SLACK_ESCALATION_CHANNEL_ID || 'C090SJ486P6';

interface EscalationParams {
  reason: string;
  creatorName: string;
  creatorEmail?: string;
  projectName?: string;
  emailSnippet?: string;
  adminLink?: string;
}

/** Send an escalation message to Slack */
export async function escalateToSlack(params: EscalationParams): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('SLACK_BOT_TOKEN not configured');
    return { ok: false, error: 'SLACK_BOT_TOKEN not configured' };
  }

  const blocks: any[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*⚠️ Escalation: ${params.reason}*` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Creator:* ${params.creatorName}`,
          `*Email:* ${params.creatorEmail || 'N/A'}`,
          params.projectName ? `*Project:* ${params.projectName}` : null,
        ].filter(Boolean).join('\n'),
      },
    },
  ];

  if (params.emailSnippet) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Email Snippet:*\n>${params.emailSnippet.slice(0, 300).replace(/\n/g, '\n>')}` },
    });
  }

  if (params.adminLink) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<${params.adminLink}|View in Admin>` },
    });
  }

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL,
        text: `⚠️ Escalation: ${params.reason} — ${params.creatorName}`,
        blocks,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error('Slack API error:', data.error, data);
    }
    return data;
  } catch (err) {
    console.error('Slack escalation failed:', err);
    return { ok: false, error: String(err) };
  }
}
