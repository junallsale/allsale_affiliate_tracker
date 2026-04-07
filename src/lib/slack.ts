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
export async function escalateToSlack(params: EscalationParams): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('SLACK_BOT_TOKEN not configured');
    return false;
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `⚠️ Escalation: ${params.reason}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Creator:*\n${params.creatorName}` },
        { type: 'mrkdwn', text: `*Email:*\n${params.creatorEmail || 'N/A'}` },
        ...(params.projectName ? [{ type: 'mrkdwn', text: `*Project:*\n${params.projectName}` }] : []),
      ],
    },
    ...(params.emailSnippet ? [{
      type: 'section',
      text: { type: 'mrkdwn', text: `*Email Snippet:*\n>${params.emailSnippet.slice(0, 300)}` },
    }] : []),
    ...(params.adminLink ? [{
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'View in Admin' },
        url: params.adminLink,
        action_id: 'view_admin',
      }],
    }] : []),
  ];

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
    return data.ok === true;
  } catch (err) {
    console.error('Slack escalation failed:', err);
    return false;
  }
}
