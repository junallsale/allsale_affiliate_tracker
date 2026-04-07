import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const VIEWS = [
  { name: '2604_DM', brand_id: 'eb711cbc-ae7e-4e1e-a119-5e6e1f8f1acf', project_id: '9a03fd03-0e0e-4c1d-b647-b680156fe12e', project: '2604_Paid' },
  { name: '2604_ET_Soongjung2x', brand_id: '67ec6f91-5369-42d2-a68a-f301787eaca1', project_id: '836959ae-7642-41db-b116-6952ec454094', project: '2604_Soonjung2x' },
  { name: '2604_ooznary', brand_id: 'c639148c-ceb2-4b34-a594-e279629a9a62', project_id: '231cab47-ef1f-4665-8460-df491a62f3a9', project: '2604_paid' },
];

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const csv = readFileSync('/Users/jun/Downloads/단가표 3월 - Sheet9.csv', 'utf-8').replace(/\r/g, '');
  const lines = csv.split('\n').filter(Boolean).slice(1);

  const creators: { handle: string; price: number }[] = [];
  for (const line of lines) {
    const [handle, priceStr] = line.split(',');
    if (!handle?.trim()) continue;
    creators.push({ handle: handle.trim().replace(/^@/, ''), price: parseFloat(priceStr) || 0 });
  }

  console.log(`Parsed ${creators.length} creators × ${VIEWS.length} views = ${creators.length * VIEWS.length} inserts\n`);

  let total = 0, skipped = 0;

  for (const view of VIEWS) {
    console.log(`=== ${view.name} (${view.project}) ===`);

    for (const c of creators) {
      // Check if already exists in this view
      const { data: existing } = await supabase
        .from('affiliate_creators')
        .select('id')
        .eq('handle', c.handle)
        .eq('brand_id', view.brand_id)
        .eq('project_id', view.project_id)
        .maybeSingle();

      if (existing) {
        process.stdout.write(`  @${c.handle} - already exists\n`);
        skipped++;
        continue;
      }

      const { error } = await supabase.from('affiliate_creators').insert({
        handle: c.handle,
        brand_id: view.brand_id,
        project_id: view.project_id,
        project: view.project,
        planned_video_count: 1,
        price_per_video: c.price,
        contract_amount: c.price,
        thread: `https://allsale-affiliate.vercel.app/inbox?search=${c.handle}`,
        status: 'Rate Received',
      });

      if (error) {
        process.stdout.write(`  @${c.handle} - ERROR: ${error.message}\n`);
        skipped++;
      } else {
        process.stdout.write(`  @${c.handle} - $${c.price}\n`);
        total++;
      }
    }
    console.log('');
  }

  console.log(`Done. Inserted: ${total}, Skipped: ${skipped}`);
}

main().catch(console.error);
