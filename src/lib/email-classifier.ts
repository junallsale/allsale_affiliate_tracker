/**
 * Email classifier — keyword matching + Claude API fallback
 */

export type EmailClassification =
  | 'price_negotiation'
  | 'interest'
  | 'sample_request'
  | 'content_brief'
  | 'contract_modification'
  | 'shipping_info'
  | 'other';

interface KeywordRule {
  classification: EmailClassification;
  keywords: string[];
  weight: number;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    classification: 'contract_modification',
    keywords: ['change contract', 'modify terms', 'modify contract', 'different terms', 'revise contract', 'update contract', 'amendment'],
    weight: 10,
  },
  {
    classification: 'price_negotiation',
    keywords: ['rate', 'price', 'how much', 'budget', 'payment', 'negotiate', 'pricing', 'cost', 'fee', 'compensation', 'pay me'],
    weight: 5,
  },
  {
    classification: 'shipping_info',
    keywords: ['address', 'ship to', 'delivery', 'shipping', 'send sample to', 'my address', 'mailing address'],
    weight: 7,
  },
  {
    classification: 'sample_request',
    keywords: ['sample', 'want to try', 'send me product', 'product sample', 'try the product', 'receive sample', 'get sample'],
    weight: 6,
  },
  {
    classification: 'content_brief',
    keywords: ['content guide', 'brief', 'what should i post', 'guidelines', 'content requirements', 'talking points', 'script', 'what to film'],
    weight: 6,
  },
  {
    classification: 'interest',
    keywords: ['interested', "i'd love to", 'sounds great', 'count me in', 'sign me up', 'i want to', 'love to work', 'happy to', 'down to collaborate'],
    weight: 3,
  },
];

/** Tier 1: Keyword-based classification */
function classifyByKeywords(text: string): { classification: EmailClassification; confidence: number } {
  const lower = text.toLowerCase();
  let bestMatch: EmailClassification = 'other';
  let bestScore = 0;

  for (const rule of KEYWORD_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        score += rule.weight;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule.classification;
    }
  }

  // Confidence: 0-1 scale based on score
  const confidence = Math.min(bestScore / 15, 1);
  return { classification: bestMatch, confidence };
}

/** Tier 2: Claude API classification (fallback) */
async function classifyWithClaude(text: string): Promise<EmailClassification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'other';

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
          content: `Classify this email from a TikTok creator into exactly one category. Reply with ONLY the category name, nothing else.

Categories:
- price_negotiation (asking about rates, payment, pricing)
- interest (expressing interest in collaboration)
- sample_request (requesting product samples)
- content_brief (asking about content guidelines, what to post)
- contract_modification (wanting to change contract terms)
- shipping_info (providing or asking about shipping/delivery address)
- other (doesn't fit any category)

Email:
${text.slice(0, 500)}`,
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

/** Main classification function — keywords first, Claude fallback if low confidence */
export async function classifyEmail(subject: string, bodyText: string): Promise<EmailClassification> {
  const fullText = `${subject} ${bodyText}`;
  const { classification, confidence } = classifyByKeywords(fullText);

  // If keyword matching is confident enough, use it
  if (confidence >= 0.3) return classification;

  // Otherwise, fall back to Claude
  return classifyWithClaude(fullText);
}
