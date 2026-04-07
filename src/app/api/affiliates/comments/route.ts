import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase-server";

async function requireAuthClient() {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return supabase;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await requireAuthClient();
    const { searchParams } = new URL(request.url);
    const affiliateCreatorId = searchParams.get("affiliate_creator_id");

    if (!affiliateCreatorId) {
      return NextResponse.json({ error: "Missing affiliate_creator_id" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("affiliate_comments")
      .select("*")
      .eq("affiliate_creator_id", affiliateCreatorId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await requireAuthClient();
    const body = await request.json();

    const { affiliate_creator_id, author_name, content } = body;

    if (!affiliate_creator_id || !author_name || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("affiliate_comments")
      .insert({ affiliate_creator_id, author_name, content })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await requireAuthClient();
    const body = await request.json();
    const { id, content } = body;

    if (!id || !content?.trim()) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("affiliate_comments")
      .update({ content: content.trim() })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await requireAuthClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing comment id" }, { status: 400 });
    }

    const { error } = await supabase
      .from("affiliate_comments")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
