/**
 * Email classifier — AI-powered using Claude Haiku
 */

export type EmailClassification =
  | 'price_negotiation'
  | 'interest'
  | 'sample_request'
  | 'content_brief'
  | 'contract_modification'
  | 'shipping_info'
  | 'other';

/** Classify email using Claude Haiku */
export async function classifyEmail(subject: string, bodyText: string): Promise<EmailClassification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'other';

  const fullText = `Subject: ${subject}\n\nBody:\n${(bodyText || '').slice(0, 1000)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `You are classifying an email from a TikTok creator who is in the process of a paid brand collaboration. Reply with ONLY the category name, nothing else.

Categories:
- contract_modification — Creator is negotiating, counter-offering, requesting changes to rate/terms/contract, proposing different pricing, or discussing Spark Ad usage terms. This includes any attempt to change the agreed-upon deal.
- price_negotiation — Creator is asking about rates, payment details, or pricing for the first time (not counter-offering an existing deal).
- interest — Creator is expressing interest in collaborating, saying yes, or showing enthusiasm.
- sample_request — Creator is requesting product samples.
- content_brief — Creator is asking about content guidelines, what to post, or filming instructions.
- shipping_info — Creator is providing or asking about shipping/delivery address.
- other — Doesn't fit any category above (auto-replies, unrelated content, etc.)

${fullText}`,
        }],
      }),
    });

    if (!res.ok) return 'other';
    const data = await res.json();
    const result = (data.content?.[0]?.text || '').trim().toLowerCase();

    const validCategories: EmailClassification[] = [
      'price_negotiation', 'interest', 'sample_request',
      'content_brief', 'contract_modification', 'shipping_info', 'other',
    ];
    return validCategories.includes(result as EmailClassification)
      ? (result as EmailClassification)
      : 'other';
  } catch {
    return 'other';
  }
}
