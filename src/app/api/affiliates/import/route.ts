import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import { COLUMN_MAP_KO_EN, NUMERIC_COLUMNS } from "@/lib/affiliate-columns";
import { enrichAfterInsert } from "@/lib/enrich-affiliates";

async function requireAuthClient() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return supabase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanRow(row: Record<string, string>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleaned: Record<string, any> = {};

  for (const [csvCol, value] of Object.entries(row)) {
    const dbCol = COLUMN_MAP_KO_EN[csvCol.trim()];
    if (!dbCol) continue;

    const trimmed = value?.trim() || '';
    if (trimmed === '') {
      cleaned[dbCol] = null;
      continue;
    }

    if (NUMERIC_COLUMNS.has(dbCol)) {
      const num = parseFloat(trimmed.replace(/,/g, ''));
      cleaned[dbCol] = isNaN(num) ? null : num;
    } else if (dbCol === 'advance_payment_date' || dbCol === 'final_payment_date') {
      const d = new Date(trimmed);
      cleaned[dbCol] = isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    } else {
      cleaned[dbCol] = trimmed;
    }
  }

  return cleaned;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await requireAuthClient();
    const body = await request.json();
    const { rows } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No data to import" }, { status: 400 });
    }

    const cleanedRows = rows.map(cleanRow).filter(row => row.handle);

    if (cleanedRows.length === 0) {
      return NextResponse.json({ error: "No valid rows with handle" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("affiliate_creators")
      .insert(cleanedRows)
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-enrich with TikTok data (fire-and-forget)
    if (data && data.length > 0) {
      const toEnrich = data
        .filter((row: { id: string; handle?: string }) => row.handle)
        .map((row: { id: string; handle: string }) => ({ id: row.id, handle: row.handle }));
      if (toEnrich.length > 0) {
        enrichAfterInsert(toEnrich);
      }
    }

    return NextResponse.json({ imported: data?.length || 0 }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
