import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";

function getUser(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const initData = request.headers.get("x-telegram-init-data") || "";
  return token ? verifyTelegramInitData(initData, token) : null;
}

export async function GET(request: NextRequest) {
  const user = getUser(request);
  if (!user) return NextResponse.json({ error: "telegram_auth_failed" }, { status: 401 });
  if (!(await ensureSchema())) return NextResponse.json({ error: "database_not_configured", message: "Общие коллекции не подключены: в Vercel нужно настроить DATABASE_URL." }, { status: 503 });
  const { getPool } = await import("@/lib/db-internal");
  const pool = getPool();
  await pool.query(
    "UPDATE findly_members SET first_name=$2, username=$3, photo_url=$4 WHERE user_id=$1",
    [user.id, user.firstName, user.username || null, user.photoUrl || null],
  );
  const result = await pool.query(
    `SELECT c.id, c.name, c.owner_id, m.role,
      (SELECT COUNT(*)::int FROM findly_items i WHERE i.collection_id=c.id AND i.status <> 'archived') AS item_count,
      (SELECT COALESCE(json_agg(json_build_object('user_id', cm.user_id, 'first_name', cm.first_name, 'username', cm.username, 'photo_url', cm.photo_url, 'role', cm.role) ORDER BY cm.created_at), '[]'::json)
       FROM findly_members cm WHERE cm.collection_id=c.id) AS members
     FROM findly_collections c JOIN findly_members m ON m.collection_id=c.id
     WHERE m.user_id=$1 ORDER BY c.created_at DESC`,
    [user.id],
  );
  return NextResponse.json({ collections: result.rows });
}

export async function POST(request: NextRequest) {
  const user = getUser(request);
  if (!user) return NextResponse.json({ error: "telegram_auth_failed" }, { status: 401 });
  if (!(await ensureSchema())) return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  const { getPool } = await import("@/lib/db-internal");
  const pool = getPool();
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
  if (action === "create") {
    const name = String(body.name || "Общая коллекция").trim().slice(0, 80);
    const id = randomBytes(12).toString("hex");
    await pool.query("INSERT INTO findly_collections (id,name,owner_id) VALUES ($1,$2,$3)", [id, name || "Общая коллекция", user.id]);
    await pool.query("INSERT INTO findly_members (collection_id,user_id,role,first_name,username,photo_url) VALUES ($1,$2,'owner',$3,$4,$5)", [id, user.id, user.firstName, user.username || null, user.photoUrl || null]);
    return NextResponse.json({ collection: { id, name: name || "Общая коллекция", role: "owner", item_count: 0 } });
  }
  if (action === "invite") {
    const collectionId = String(body.collectionId || "");
    const membership = await pool.query("SELECT role FROM findly_members WHERE collection_id=$1 AND user_id=$2", [collectionId, user.id]);
    if (!membership.rows.length || !["owner", "editor"].includes(membership.rows[0].role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await pool.query("INSERT INTO findly_invites (token_hash,collection_id,role,expires_at,created_by) VALUES ($1,$2,'editor',NOW()+INTERVAL '7 days',$3)", [tokenHash, collectionId, user.id]);
    return NextResponse.json({ token, expiresInDays: 7 });
  }
  if (action === "join") {
    const token = String(body.token || "").trim();
    if (token.length < 20 || token.length > 120) return NextResponse.json({ error: "invalid_invite" }, { status: 400 });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invite = await pool.query("SELECT collection_id,role FROM findly_invites WHERE token_hash=$1 AND expires_at>NOW()", [tokenHash]);
    if (!invite.rows.length) return NextResponse.json({ error: "invite_expired" }, { status: 404 });
    const row = invite.rows[0];
    await pool.query("INSERT INTO findly_members (collection_id,user_id,role,first_name,username,photo_url) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (collection_id,user_id) DO UPDATE SET first_name=EXCLUDED.first_name, username=EXCLUDED.username, photo_url=EXCLUDED.photo_url", [row.collection_id, user.id, row.role, user.firstName, user.username || null, user.photoUrl || null]);
    await pool.query("DELETE FROM findly_invites WHERE token_hash=$1", [tokenHash]);
    const collection = await pool.query("SELECT id,name FROM findly_collections WHERE id=$1", [row.collection_id]);
    return NextResponse.json({ collection: collection.rows[0] });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    console.error("[Findly] Family action failed:", { action, message });
    return NextResponse.json({
      error: "family_action_failed",
      message: "Не удалось сохранить общую коллекцию. Проверь подключение базы данных (DATABASE_URL) в Vercel.",
    }, { status: 500 });
  }
}
