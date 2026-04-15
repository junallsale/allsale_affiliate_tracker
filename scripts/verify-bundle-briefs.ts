/**
 * Verify bundle product brief expansion end-to-end.
 *
 * Creates a test bundle with component products, assigns to a test
 * project_creator, renders draft HTML, and asserts structure.
 *
 * Uses --cleanup to remove test fixtures after verification.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

try {
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
} catch {}

import { buildProductBriefItems, renderContentGuideSectionLi } from "../src/lib/product-briefs";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // 1. Find any brand with at least 2 existing products we can borrow
  const { data: brands } = await db.from("brands").select("id, name").limit(5);
  if (!brands?.length) throw new Error("No brands found");

  let usableBrand: any = null;
  let componentCandidates: any[] = [];
  for (const b of brands) {
    const { data: ps } = await db
      .from("products")
      .select("id, name, is_bundle, content_guide_url")
      .eq("brand_id", b.id)
      .eq("is_bundle", false)
      .limit(3);
    if (ps && ps.length >= 2) {
      usableBrand = b;
      componentCandidates = ps;
      break;
    }
  }
  if (!usableBrand) throw new Error("Need at least 1 brand with 2+ non-bundle products");

  console.log(`Using brand: ${usableBrand.name} (${usableBrand.id})`);
  console.log(`Components: ${componentCandidates.map((p) => p.name).join(", ")}`);

  // 2. Create bundle product
  const bundleName = `__test_bundle_${Date.now()}`;
  const { data: bundle, error: be } = await db
    .from("products")
    .insert({
      brand_id: usableBrand.id,
      name: bundleName,
      is_bundle: true,
      content_guide_url: "https://example.com/bundle-guide",
    })
    .select("id, name")
    .single();
  if (be || !bundle) throw new Error(`bundle insert: ${be?.message}`);
  console.log(`Created bundle: ${bundle.id}`);

  // 3. Link components
  const compRows = componentCandidates.map((c, i) => ({
    bundle_product_id: bundle.id,
    component_product_id: c.id,
    position: i,
  }));
  const { error: le } = await db.from("product_bundle_components").insert(compRows);
  if (le) throw new Error(`component link: ${le.message}`);

  // 4. Simulate loading assigned products the way composeEmail does
  const { data: simulated } = await db
    .from("products")
    .select("id, name, content_guide_url, is_bundle")
    .in("id", [bundle.id]);

  const assigned = (simulated || []).map((p) => ({ product: p }));
  const items = await buildProductBriefItems(assigned, db);

  console.log(`\nBrief items (${items.length}):`);
  for (const it of items) {
    console.log(`  [${it.role.padEnd(10)}] ${it.label} ${it.contentGuideUrl ? "→ " + it.contentGuideUrl : ""}`);
  }

  // 5. Render HTML
  const html = renderContentGuideSectionLi(items);
  console.log(`\nRendered HTML:\n${html}\n`);

  const assertions = [
    { label: "bundle appears", pass: html.includes(`${bundle.name} (bundle)`) },
    { label: "at least 1 component appears", pass: componentCandidates.some((c) => html.includes(c.name)) },
    { label: "uses Product briefs label (multi-item)", pass: html.includes("Product briefs:") },
  ];
  for (const a of assertions) console.log(`  ${a.pass ? "✓" : "✗"} ${a.label}`);

  // 6. Compare with single-product case (regression check).
  // Find a non-bundle product anywhere that has content_guide_url set.
  const { data: singleWithGuide } = await db
    .from("products")
    .select("id, name, content_guide_url, is_bundle")
    .eq("is_bundle", false)
    .not("content_guide_url", "is", null)
    .limit(1);
  if (singleWithGuide?.length) {
    const singleAssigned = singleWithGuide.map((p) => ({ product: p }));
    const singleItems = await buildProductBriefItems(singleAssigned, db);
    const singleHtml = renderContentGuideSectionLi(singleItems);
    console.log(`\nSingle product HTML (regression):\n${singleHtml}\n`);
    const singleOk = singleHtml.startsWith("<li><strong>Product brief:</strong>") && !singleHtml.includes("<ul>");
    console.log(`  ${singleOk ? "✓" : "✗"} legacy single-line HTML preserved`);
  } else {
    console.log(`\nRegression test skipped: no non-bundle product with content_guide_url in DB`);
  }

  // 7. Cleanup
  if (process.argv.includes("--cleanup") || process.argv.includes("--apply")) {
    await db.from("product_bundle_components").delete().eq("bundle_product_id", bundle.id);
    await db.from("products").delete().eq("id", bundle.id);
    console.log(`\nCleaned up test bundle.`);
  } else {
    console.log(`\nTest bundle left in DB (id=${bundle.id}). Re-run with --cleanup to remove.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
