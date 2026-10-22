import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({
      configured: false,
      authenticated: false,
      error: "telegram_not_configured",
      message: "TELEGRAM_BOT_TOKEN is missing from the server environment.",
    }, { status: 503 });
  }

  const initData = request.headers.get("x-telegram-init-data") || "";
  if (!initData) {
    return NextResponse.json({
      configured: true,
      authenticated: false,
      error: "telegram_init_data_missing",
      message: "Open this app from the Telegram bot to connect your account.",
    }, { status: 200 });
  }

  const user = verifyTelegramInitData(initData, token);
  if (!user) {
    return NextResponse.json({
      configured: true,
      authenticated: false,
      error: "telegram_auth_failed",
      message: "Telegram session could not be verified. Reopen the Mini App from the bot.",
    }, { status: 401 });
  }

  return NextResponse.json({
    configured: true,
    authenticated: true,
    user: {
      id: user.id,
      firstName: user.firstName,
      username: user.username || "",
      photoUrl: user.photoUrl || "",
    },
  });
}
