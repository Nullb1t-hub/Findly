import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    app: "Findly",
    status: "ok",
    capabilities: {
      ai: Boolean(process.env.GEMINI_API_KEY),
      telegramAuth: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      cloudStorage: Boolean(process.env.DATABASE_URL),
    },
  });
}
