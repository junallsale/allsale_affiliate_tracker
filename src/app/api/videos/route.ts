import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { project_creator_id, tiktok_url, spark_ad_code } = body;

    // Validate required fields
    if (!project_creator_id || !tiktok_url || !spark_ad_code) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Extract tiktok_video_id from URL
    const videoIdMatch = tiktok_url.match(/video\/(\d+)/);
    const tiktok_video_id = videoIdMatch ? videoIdMatch[1] : null;

    // Create Supabase client (use service role key if available, otherwise anon key)
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseKey
    );

    // Check for duplicate TikTok URL across all videos on the platform
    const { data: existingByUrl } = await supabase
      .from("videos")
      .select("id, project_creator_id")
      .eq("tiktok_url", tiktok_url)
      .maybeSingle();

    if (existingByUrl) {
      const isSameCreator = existingByUrl.project_creator_id === project_creator_id;
      return NextResponse.json(
        {
          error: isSameCreator
            ? "You have already submitted this TikTok video."
            : "This TikTok video has already been submitted by another creator.",
        },
        { status: 409 }
      );
    }

    // Check for duplicate Spark Ad Code across all videos on the platform
    const { data: existingByCode } = await supabase
      .from("videos")
      .select("id, project_creator_id")
      .eq("spark_ad_code", spark_ad_code)
      .maybeSingle();

    if (existingByCode) {
      const isSameCreator = existingByCode.project_creator_id === project_creator_id;
      return NextResponse.json(
        {
          error: isSameCreator
            ? "You have already used this Spark Ad Code."
            : "This Spark Ad Code has already been used by another creator.",
        },
        { status: 409 }
      );
    }

    // Insert video
    const { data: videoData, error: videoError } = await supabase
      .from("videos")
      .insert({
        project_creator_id,
        tiktok_url,
        spark_ad_code,
        tiktok_video_id,
        status: "submitted",
      })
      .select()
      .single();

    if (videoError) {
      // Handle unique constraint violation as fallback
      if (videoError.code === "23505") {
        return NextResponse.json(
          { error: "This video or Spark Ad Code has already been submitted." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to insert video" },
        { status: 500 }
      );
    }

    // Count videos for this project_creator
    const { count, error: countError } = await supabase
      .from("videos")
      .select("*", { count: "exact", head: true })
      .eq("project_creator_id", project_creator_id);

    if (!countError && count !== null) {
      // Get assigned_video_count
      const { data: projectCreatorData, error: pcError } = await supabase
        .from("project_creators")
        .select("assigned_video_count")
        .eq("id", project_creator_id)
        .single();

      if (!pcError && projectCreatorData) {
        const newStatus =
          count >= projectCreatorData.assigned_video_count
            ? "completed"
            : "in-progress";

        // Update project_creators status
        await supabase
          .from("project_creators")
          .update({ status: newStatus })
          .eq("id", project_creator_id);
      }
    }

    return NextResponse.json(videoData, { status: 201 });
  } catch (error) {
    console.error("Error in POST /api/videos:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
