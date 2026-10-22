import { NextRequest, NextResponse } from "next/server";
import { listItems, saveItem, updateItemStatus } from "@/lib/db";
import { verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 15;

function identity(request: NextRequest) {
  const initData = request.headers.get("x-telegram-init-data") || "";
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return { error: "telegram_not_configured" as const };
  const user = verifyTelegramInitData(initData, token);
  return user ? { user } : { error: "telegram_auth_failed" as const };
}

export async function GET(request: NextRequest) {
  const auth = identity(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const items = await listItems(auth.user.id);
    if (!items) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "collection_unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = identity(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !body.item || typeof body.item !== "object") {
      return NextResponse.json({ error: "invalid_item" }, { status: 400 });
    }
    const saved = await saveItem(auth.user.id, body.item);
    if (!saved) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
    return NextResponse.json({ item: saved });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = identity(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });
  try {
    const body = await request.json();
    if (!body?.id || !body?.status) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    const updated = await updateItemStatus(auth.user.id, String(body.id), String(body.status));
    if (updated === null) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
