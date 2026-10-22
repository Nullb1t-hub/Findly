import { createHmac, timingSafeEqual } from "node:crypto";
import type { TelegramIdentity } from "./types";

export function verifyTelegramInitData(initData: string, botToken: string, maxAgeSeconds = 60 * 60 * 24): TelegramIdentity | null {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    const authDate = Number(params.get("auth_date"));
    if (!hash || !Number.isFinite(authDate)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (authDate > now + 60 || now - authDate > maxAgeSeconds) return null;

    params.delete("hash");
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    const calculated = createHmac("sha256", secret).update(dataCheckString).digest("hex");
    const a = Buffer.from(calculated, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const rawUser = params.get("user");
    if (!rawUser) return null;
    const user = JSON.parse(rawUser) as { id?: number | string; first_name?: string; username?: string; photo_url?: string };
    if (!user.id) return null;
    return {
      id: String(user.id),
      firstName: user.first_name || "Findly user",
      username: user.username,
      photoUrl: user.photo_url,
      verified: true,
    };
  } catch {
    return null;
  }
}
