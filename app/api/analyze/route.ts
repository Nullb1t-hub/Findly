import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

const fallback = {
  title: "Предмет требует уточнения",
  category: "Другое",
  description: "AI не смог уверенно определить предмет. Попробуйте более чёткое фото при хорошем освещении.",
  condition: "Не определено",
  rarity: "unknown",
  rarityReason: "Недостаточно данных для оценки редкости.",
  price: { low: null, high: null, currency: "EUR", quickSale: null, suggestedListing: null, confidence: "low", confidenceReason: "Нет подтверждённых аналогов." },
  markets: [],
  listings: [],
  followUpQuestions: ["Сфотографируйте логотип или бирку крупным планом.", "Покажите предмет с другой стороны."],
  listingDraft: { title: "", description: "", hashtags: [] },
  sources: [],
};

function extractJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function POST(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "telegram_not_configured", message: "Не настроена привязка Telegram: добавь TELEGRAM_BOT_TOKEN в Vercel → Settings → Environment Variables и выполни Redeploy. Это токен бота из BotFather, не ссылка на бота." }, { status: 503 });
  }
  if (token) {
    const initData = request.headers.get("x-telegram-init-data") || "";
    if (!verifyTelegramInitData(initData, token)) {
      return NextResponse.json({ error: "telegram_auth_failed" }, { status: 401 });
    }
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ai_not_configured", message: "Добавьте GEMINI_API_KEY в настройки окружения Vercel." }, { status: 503 });
  }

  try {
    const body = await request.json();
    const image = String(body.image || "");
    const mimeType = String(body.mimeType || "image/jpeg");
    const country = String(body.country || "Czechia").slice(0, 80);
    const currency = String(body.currency || "EUR").slice(0, 8);
    const extra = String(body.extra || "").slice(0, 1200);
    if (!image.startsWith("data:image/") || image.length > 7_000_000) {
      return NextResponse.json({ error: "invalid_image", message: "Загрузите изображение размером до 5 МБ." }, { status: 400 });
    }
    const base64 = image.split(",")[1];
    if (!base64) return NextResponse.json({ error: "invalid_image" }, { status: 400 });

    const client = new GoogleGenAI({ apiKey });

    const prompt = `You are Findly, a careful global resale researcher. Analyze the attached photo and research comparable items on the public web using Google Search grounding. User's primary market: ${country}; preferred currency: ${currency}. Additional notes: ${extra || "none"}.
Return only valid JSON with this schema:
{
"title":"short item name in Russian","brand":"known brand or empty","model":"model or empty","category":"category in Russian","description":"specific visual identification and distinguishing details in Russian","condition":"visible condition only; don't infer hidden defects","estimatedAge":"estimate or empty","rarity":"ordinary|possibly_collectible|potentially_rare|unknown","rarityReason":"why, with uncertainty stated",
"price":{"low":number|null,"high":number|null,"currency":"ISO currency code","quickSale":number|null,"suggestedListing":number|null,"confidence":"low|medium|high","confidenceReason":"brief rationale"},
"markets":[{"country":"country","currency":"ISO currency","low":number|null,"high":number|null,"notes":"fees/shipping/demand caveats"}],
"listings":[{"title":"listing title","price":number|null,"currency":"ISO currency","condition":"condition or unknown","marketplace":"site","url":"absolute https URL","evidenceType":"active_listing|sold|reference"}],
"followUpQuestions":["questions if photos/details needed"],
"listingDraft":{"title":"honest sale title","description":"honest concise description; don't invent condition","hashtags":["#tag"]},
"sources":["URLs actually consulted"]
}
Rules: Search the exact brand/model first, then close visual matches. Include only URLs actually found and never invent listings, prices, sales, or sources. Clearly distinguish active asking prices from confirmed sold prices. Do not claim sold prices unless the source explicitly shows a completed sale. If no reliable matches exist, use null prices, low confidence, and explain why. Price the primary market realistically after considering item condition and shipping/fees; international markets are additional opportunities, not assumed better. For additional markets, include only plausible regions and explain shipping, import, platform-access, and fees caveats. If item may be counterfeit or high-risk, say so. If more photos are required, add up to 3 concise follow-up questions. Keep results in Russian.`;

    const contents = [{
      role: "user" as const,
      parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
    }];
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    let raw: Record<string, unknown>;
    try {
      // Grounded search is used first. Avoid forcing JSON MIME mode in the same
      // request because some Gemini model/API combinations reject that pairing.
      const researched = await client.models.generateContent({
        model,
        contents,
        config: { temperature: 0.2, tools: [{ googleSearch: {} }] },
      });
      raw = extractJson(researched.text || "") as Record<string, unknown>;
    } catch (searchError) {
      console.error("[Findly] Gemini grounded search failed; retrying vision-only analysis.", searchError);
      // A second pass keeps image identification working when Search grounding
      // is unavailable. It must not fabricate sources or comparable listings.
      const retryPrompt = prompt + "\n\nThis is a vision-only fallback: do not claim you searched the web. Return empty listings and sources unless URLs are present in the input. If prices cannot be supported, use null values and low confidence.";
      const retry = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: retryPrompt }, { inlineData: { mimeType, data: base64 } }] }],
        config: { responseMimeType: "application/json", temperature: 0.2 },
      });
      raw = extractJson(retry.text || "") as Record<string, unknown>;
      raw.listings = [];
      raw.sources = [];
      raw.price = { ...(typeof raw.price === "object" && raw.price ? raw.price as Record<string, unknown> : {}), confidence: "low", confidenceReason: "Предварительная оценка по фото; поиск актуальных объявлений сейчас недоступен." };
    }
    const safe = {
      ...fallback,
      ...raw,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      photoDataUrl: image,
      price: { ...fallback.price, ...(raw.price || {}) },
      listingDraft: { ...fallback.listingDraft, ...(raw.listingDraft || {}) },
      markets: Array.isArray(raw.markets) ? raw.markets.slice(0, 8) : [],
      listings: Array.isArray(raw.listings) ? raw.listings.filter((x: { url?: string }) => typeof x.url === "string" && x.url.startsWith("https://")).slice(0, 12) : [],
      sources: Array.isArray(raw.sources) ? raw.sources.filter((x: unknown) => typeof x === "string" && /^https:\/\//.test(x as string)).slice(0, 12) : [],
      followUpQuestions: Array.isArray(raw.followUpQuestions) ? raw.followUpQuestions.slice(0, 3) : [],
    };
    return NextResponse.json({ result: safe });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[Findly] Analysis failed:", message);
    return NextResponse.json({ error: "analysis_failed", message: "Не получилось оценить этот предмет. Попробуй ещё раз с более чётким фото.", detail: process.env.NODE_ENV === "development" ? message : undefined }, { status: 502 });
  }
}
