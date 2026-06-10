import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";
import type { ViewFilter } from "@/types/database";

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

async function getClient() {
  return await createSupabaseServer();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, filters: ViewFilter[]) {
  for (const filter of filters) {
    const col = filter.column;
    if (col === '_skip') continue;
    switch (filter.operator) {
      case 'eq': query = query.eq(col, filter.value); break;
      case 'neq': query = query.neq(col, filter.value); break;
      case 'gt': query = query.gt(col, filter.value); break;
      case 'gte': query = query.gte(col, filter.value); break;
      case 'lt': query = query.lt(col, filter.value); break;
      case 'lte': query = query.lte(col, filter.value); break;
      case 'contains': query = query.ilike(col, `%${filter.value}%`); break;
      case 'not_contains': query = query.not(col, 'ilike', `%${filter.value}%`); break;
      case 'is_empty': query = query.is(col, null); break;
      case 'is_not_empty': query = query.not(col, 'is', null); break;
    }
  }
  return query;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const supabase = await getClient();
    const { slug } = await params;

    const { data: view, error: viewError } = await supabase
      .from("affiliate_views")
      .select("*")
      .eq("slug", slug)
      .single();

    if (viewError || !view) {
      return NextResponse.json({ error: "View not found" }, { status: 404 });
    }

    const visibleCols = view.visible_columns as string[];
    let selectCols: string;
    if (visibleCols.length > 0) {
      const required = ['id', 'handle'];
      const merged = [...new Set([...required, ...visibleCols])];
      selectCols = merged.join(",");
    } else {
      selectCols = "*";
    }

    let query = supabase
      .from("affiliate_creators")
      .select(selectCols);

    const filters = (view.filters || []) as ViewFilter[];

    // Resolve brand_id/project_id filters that use names instead of UUIDs
    for (const filter of filters) {
      if (filter.column === 'brand_id' && filter.value && !isUUID(String(filter.value))) {
        const { data: brand } = await supabase
          .from('brands')
          .select('id')
          .eq('name', filter.value)
          .single();
        if (!brand) {
          // brand name not found in brands table — skip this filter
          filter.column = '_skip';
        } else {
          filter.value = brand.id;
        }
      }
      if (filter.column === 'project_id' && filter.value && !isUUID(String(filter.value))) {
        const { data: project } = await supabase
          .from('projects')
          .select('id')
          .eq('name', filter.value)
          .single();
        if (project) {
          filter.value = project.id;
        } else {
          // Fallback: filter on 'project' text column instead of 'project_id' uuid column
          filter.column = 'project';
        }
      }
    }

    query = applyFilters(query, filters);

    const sortConfig = view.sort_config as { column: string; direction: string } | null;
    if (sortConfig?.column) {
      query = query.order(sortConfig.column, { ascending: sortConfig.direction === 'asc' });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Aggregate comment counts per creator for the rows in this view
    const commentCounts: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creatorIds = (data || []).map((row: any) => row.id).filter(Boolean);
    if (creatorIds.length > 0) {
      const { data: commentRows } = await supabase
        .from("affiliate_comments")
        .select("affiliate_creator_id")
        .in("affiliate_creator_id", creatorIds);
      for (const c of commentRows || []) {
        const cid = c.affiliate_creator_id as string;
        commentCounts[cid] = (commentCounts[cid] || 0) + 1;
      }
    }

    return NextResponse.json({
      view: {
        id: view.id,
        name: view.name,
        visible_columns: view.visible_columns,
        column_order: view.column_order,
        sort_config: view.sort_config,
      },
      data,
      commentCounts,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
