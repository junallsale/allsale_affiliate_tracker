import { createClient } from "@supabase/supabase-js";
import { enrichCreatorData } from "./tiktok-api";

/**
 * Enrich newly created affiliates with TikTok marketplace data.
 * Uses its own Supabase client (service_role) so it works outside request context.
 */
export function enrichAfterInsert(
  affiliates: Array<{ id: string; handle: string }>
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("[Enrich] Missing Supabase env vars");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fire-and-forget: don't await
  (async () => {
    for (const affiliate of affiliates) {
      if (!affiliate.handle) continue;

      try {
        const data = await enrichCreatorData(affiliate.handle);
        if (!data) {
          console.log(`[Enrich] No TikTok data for ${affiliate.handle}`);
          continue;
        }

        const updates: Record<string, unknown> = {};
        if (data.gmv != null) updates.gmv = data.gmv;
        if (data.avg_view != null) updates.avg_view = data.avg_view;
        if (data.followers != null) updates.followers = data.followers;

        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          const { error } = await supabase
            .from("affiliate_creators")
            .update(updates)
            .eq("id", affiliate.id);

          if (error) {
            console.error(`[Enrich] DB update failed for ${affiliate.handle}:`, error.message);
          } else {
            console.log(`[Enrich] ${affiliate.handle}: gmv=${data.gmv}, avg_view=${data.avg_view}, followers=${data.followers}`);
          }
        }
      } catch (err) {
        console.error(`[Enrich] Failed for ${affiliate.handle}:`, err);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 300));
    }
  })();
}
