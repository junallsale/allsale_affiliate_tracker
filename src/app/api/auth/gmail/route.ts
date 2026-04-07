import { NextResponse } from 'next/server';
import { getOAuthUrl } from '@/lib/gmail';

/** GET /api/auth/gmail — Redirect to Google OAuth consent screen */
export async function GET() {
  const url = getOAuthUrl();
  return NextResponse.redirect(url);
}
