import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var findlyPool: Pool | undefined;
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!global.findlyPool) {
    global.findlyPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.findlyPool;
}

let schemaReady: Promise<void> | null = null;
export async function ensureSchema() {
  const pool = getPool();
  if (!pool) return false;
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS findly_items (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        collection_id TEXT,
        status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved','for_sale','sold','archived')),
        title TEXT NOT NULL,
        payload JSONB NOT NULL,
        photo_data_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS findly_items_owner_updated ON findly_items(owner_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS findly_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS findly_members (
        collection_id TEXT NOT NULL REFERENCES findly_collections(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','editor','viewer')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (collection_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS findly_invites (
        token_hash TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES findly_collections(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'editor',
        expires_at TIMESTAMPTZ NOT NULL,
        created_by TEXT NOT NULL
      );
    `).then(() => undefined);
  }
  await schemaReady;
  return true;
}

export async function listItems(ownerId: string) {
  const pool = getPool();
  if (!pool || !(await ensureSchema())) return null;
  const result = await pool.query(
    "SELECT id, owner_id, collection_id, status, payload, created_at FROM findly_items WHERE owner_id = $1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT 300",
    [ownerId],
  );
  return result.rows.map((row) => ({
    ...row.payload,
    id: row.id,
    ownerId: row.owner_id,
    collectionId: row.collection_id,
    status: row.status,
    savedAt: row.created_at,
  }));
}

export async function saveItem(ownerId: string, item: Record<string, unknown>) {
  const pool = getPool();
  if (!pool || !(await ensureSchema())) return null;
  const id = String(item.id || crypto.randomUUID());
  const status = ["saved", "for_sale", "sold", "archived"].includes(String(item.status)) ? String(item.status) : "saved";
  const payload = { ...item, id, ownerId, status };
  const photo = typeof item.photoDataUrl === "string" && item.photoDataUrl.length < 1_500_000 ? item.photoDataUrl : null;
  await pool.query(
    `INSERT INTO findly_items (id, owner_id, collection_id, status, title, payload, photo_data_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, title=EXCLUDED.title, payload=EXCLUDED.payload, photo_data_url=EXCLUDED.photo_data_url, updated_at=NOW()
     WHERE findly_items.owner_id = EXCLUDED.owner_id`,
    [id, ownerId, item.collectionId ? String(item.collectionId) : null, status, String(item.title || "Untitled item"), JSON.stringify(payload), photo],
  );
  return payload;
}

export async function updateItemStatus(ownerId: string, id: string, status: string) {
  const pool = getPool();
  if (!pool || !(await ensureSchema())) return null;
  if (!["saved", "for_sale", "sold", "archived"].includes(status)) throw new Error("Invalid status");
  const result = await pool.query(
    "UPDATE findly_items SET status=$3, payload=jsonb_set(payload, '{status}', to_jsonb($3::text)), updated_at=NOW() WHERE id=$1 AND owner_id=$2 RETURNING id",
    [id, ownerId, status],
  );
  return result.rowCount === 1;
}
