import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { generateSlug } from '../src/lib/utils';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const PROJECT_ID = 'af644069-65cf-4487-8bf1-5373ec345f46';
const PRODUCT_ID = 'd57fdd76-c873-4c18-b674-a9e5fae3a9b6';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const csv = readFileSync('/Users/jun/Downloads/단가표 3월 - 단가받은 컨펌리스트.csv', 'utf-8').replace(/\r/g, '');
  const lines = csv.split('\n').filter(Boolean).slice(1);

  const creators: { handle: string; contractAmount: number }[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const parts = line.split(',');
    const handle = (parts[3] || '').trim().replace(/^@/, '');
    if (!handle || seen.has(handle.toLowerCase())) continue;
    seen.add(handle.toLowerCase());

    const contract = (parts[16] || '').trim();
    const priceRaw = (parts[24] || '').trim().replace(/["$]/g, '');
    const price = parseFloat(priceRaw) || 0;
    const contractAmount = (contract === 'FREE' || contract === '0') ? 0 : price;

    creators.push({ handle, contractAmount });
  }

  console.log(`Parsed ${creators.length} creators\n`);

  let added = 0, skipped = 0;

  for (let i = 0; i < creators.length; i++) {
    const { handle, contractAmount } = creators[i];

    // Find or create creator
    let creatorId: string;
    const { data: existing } = await supabase.from('creators').select('id').eq('tiktok_handle', handle).maybeSingle();

    if (existing) {
      creatorId = existing.id;
    } else {
      const { data: newCreator, error } = await supabase.from('creators').insert({
        name: handle,
        email: '',
        tiktok_handle: handle,
        slug: generateSlug(),
      }).select('id').single();

      if (error || !newCreator) {
        console.log(`[${i + 1}] @${handle} - FAILED to create creator: ${error?.message}`);
        skipped++;
        continue;
      }
      creatorId = newCreator.id;
    }

    // Check if already in project
    const { data: existingPc } = await supabase.from('project_creators')
      .select('id')
      .eq('project_id', PROJECT_ID)
      .eq('creator_id', creatorId)
      .maybeSingle();

    if (existingPc) {
      console.log(`[${i + 1}] @${handle} - already in project`);
      skipped++;
      continue;
    }

    // Create project_creator
    const commLink = `https://allsale-affiliate.vercel.app/inbox?search=${handle}`;
    const advancePayment = Math.floor(contractAmount / 2);
    const isFree = contractAmount === 0;

    const { data: newPc, error: pcError } = await supabase.from('project_creators').insert({
      project_id: PROJECT_ID,
      creator_id: creatorId,
      unique_slug: generateSlug(),
      assigned_video_count: 1,
      content_type: 'shoppable_video',
      contract_amount: contractAmount,
      advance_payment: advancePayment,
      remaining_payment: contractAmount - advancePayment,
      commission_rate: 25,
      communication_link: commLink,
      status: 'pending',
      ...(isFree ? { contract_sent: true, signed_at: new Date().toISOString() } : {}),
    }).select('id').single();

    if (pcError || !newPc) {
      console.log(`[${i + 1}] @${handle} - FAILED: ${pcError?.message}`);
      skipped++;
      continue;
    }

    // Assign product
    await supabase.from('project_creator_products').insert({
      project_creator_id: newPc.id,
      product_id: PRODUCT_ID,
    });

    added++;
    console.log(`[${i + 1}] @${handle} - $${contractAmount}${isFree ? ' (FREE)' : ''}`);
  }

  console.log(`\nDone. Added: ${added}, Skipped: ${skipped}`);
}

main().catch(console.error);
