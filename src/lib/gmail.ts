/**
 * Gmail API wrapper — OAuth token exchange, send, list, get
 * Uses raw fetch to Gmail REST API (no Google client library needed)
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function getOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  };
}

/** Build Google OAuth consent URL */
export function getOAuthUrl(state?: string): string {
  const { clientId, redirectUri } = getOAuthConfig();
  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
  ];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    ...(state ? { state } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Exchange authorization code for tokens */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  email: string;
}> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokens = await res.json();

  // Get email from userinfo
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await userRes.json();

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    email: userInfo.email,
  };
}

/** Refresh access token from refresh token */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getOAuthConfig();

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** Encode email to RFC 2822 base64url format. Returns raw + generated Message-ID. */
function encodeEmail(params: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  bodyHtml: string;
  inReplyTo?: string;
  references?: string;
  attachments?: EmailAttachment[];
}): { raw: string; messageIdHeader: string } {
  const boundary = `boundary_${Date.now()}`;
  const hasAttachments = params.attachments && params.attachments.length > 0;

  // Generate RFC 2822 Message-ID using sender's domain (Gmail preserves this header).
  const senderDomain = params.from.match(/@([^>\s]+)/)?.[1] || 'allsale-affiliate-tracker.vercel.app';
  const messageIdHeader = `<${crypto.randomUUID()}@${senderDomain}>`;

  const headers = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    `Subject: ${params.subject}`,
    `Message-ID: ${messageIdHeader}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/${hasAttachments ? 'mixed' : 'alternative'}; boundary="${boundary}"`,
    ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`, `References: ${params.references || params.inReplyTo}`] : []),
  ].join('\r\n');

  const parts = [
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    params.bodyHtml,
  ];

  if (hasAttachments) {
    for (const att of params.attachments!) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        att.data.toString('base64'),
      );
    }
  }

  parts.push(`--${boundary}--`);

  const raw = `${headers}\r\n\r\n${parts.join('\r\n')}`;
  return { raw: Buffer.from(raw).toString('base64url'), messageIdHeader };
}

/** Send an email via Gmail API */
export async function sendGmailEmail(params: {
  refreshToken: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  bodyHtml: string;
  threadId?: string;
  inReplyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<{ messageId: string; threadId: string; messageIdHeader: string }> {
  const accessToken = await getAccessToken(params.refreshToken);
  const { raw, messageIdHeader } = encodeEmail(params);

  const body: Record<string, string> = { raw };
  if (params.threadId) body.threadId = params.threadId;

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send failed: ${err}`);
  }

  const data = await res.json();
  return { messageId: data.id, threadId: data.threadId, messageIdHeader };
}

/** List new emails received after a given date */
export async function listNewEmails(
  refreshToken: string,
  since: Date,
  maxResults = 50
): Promise<Array<{
  id: string;
  threadId: string;
  snippet: string;
}>> {
  const accessToken = await getAccessToken(refreshToken);
  const afterEpoch = Math.floor(since.getTime() / 1000);
  const query = `after:${afterEpoch} in:inbox`;

  const res = await fetch(
    `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) return [];
  const data = await res.json();
  return data.messages || [];
}

/** Get full email details by message ID */
export async function getEmailById(
  refreshToken: string,
  messageId: string
): Promise<{
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  date: string;
  messageIdHeader: string;
}> {
  const accessToken = await getAccessToken(refreshToken);

  const res = await fetch(
    `${GMAIL_API}/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) throw new Error(`Failed to fetch email ${messageId}`);
  const data = await res.json();

  const headers = data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  // Extract body
  let bodyText = '';
  let bodyHtml = '';

  function extractParts(payload: any) {
    if (payload.body?.data) {
      const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      if (payload.mimeType === 'text/plain') bodyText = decoded;
      if (payload.mimeType === 'text/html') bodyHtml = decoded;
    }
    if (payload.parts) {
      for (const part of payload.parts) extractParts(part);
    }
  }
  extractParts(data.payload);

  return {
    id: data.id,
    threadId: data.threadId,
    from: getHeader('From'),
    to: getHeader('To'),
    cc: getHeader('Cc'),
    subject: getHeader('Subject'),
    bodyText,
    bodyHtml,
    date: getHeader('Date'),
    messageIdHeader: getHeader('Message-ID'),
  };
}
