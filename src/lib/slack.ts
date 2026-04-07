/**
 * Slack escalation service — sends alerts to the escalation channel
 */

const SLACK_CHANNEL = 'C0AR6PNDYAJ';

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
