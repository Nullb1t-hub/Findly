import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { verifyTelegramInitData } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 30;

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

    const prompt = `You are Findly, a careful visual item-identification and resale research assistant. Analyze the attached photo and identify the most likely exact item. User market: ${country}; preferred currency: ${currency}. Additional notes: ${extra || "none"}.
You MUST use Google Search to research current listings and prices for the identified item, prioritizing the user market. Search exact brand/model plus used/second-hand/sold-price terms and reputable local marketplaces. Do not confuse visually similar models.
Return only valid JSON with this schema:
{"title":"short item name in Russian","brand":"known brand or empty","model":"model or empty","category":"category in Russian","description":"specific visual identification and distinguishing details in Russian","condition":"visible condition only","estimatedAge":"estimate or empty","rarity":"ordinary|possibly_collectible|potentially_rare|unknown","rarityReason":"why, with uncertainty stated","price":{"low":number|null,"high":number|null,"currency":"ISO currency code","quickSale":number|null,"suggestedListing":number|null,"confidence":"low|medium|high","confidenceReason":"brief rationale and number of price examples found"},"markets":[{"country":"country","currency":"ISO currency","low":number|null,"high":number|null,"notes":"what the examples represent"}],"listings":[{"title":"real listing/page title","price":number|null,"currency":"ISO currency","condition":"condition or unknown","marketplace":"site","url":"absolute https URL from search results","evidenceType":"active_listing|sold|reference"}],"followUpQuestions":["questions if photos/details needed"],"listingDraft":{"title":"honest sale title","description":"honest concise description; do not invent condition","hashtags":["#tag"]},"sources":["absolute https URLs actually returned by Google Search"]}
Rules: Use search evidence for prices; never invent a listing, sale price, source, brand, or model number. Include up to 6 best relevant sources with actual URLs and observed prices. Prefer sold prices when available; label active listings as active, not sold. Do not mix currencies. If no reliable exact match or price evidence is found, use null for unsupported price fields and low confidence. If results are only general marketplace search pages, include them as references, not actual listings. Clearly separate estimates from verified listing prices. Keep results in Russian.`;

    const client = new GoogleGenAI({ apiKey });
    const configuredModel = process.env.GEMINI_MODEL?.trim();
    const model = !configuredModel || configuredModel === "gemini-2.5-flash" ? "gemini-3.8-flash" : configuredModel;

    // One grounded request: image identification and current web research together.
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });
    const raw = extractJson(response.text || "") as Record<string, unknown>;
    const candidate = response.candidates?.[0] as unknown as { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } } | undefined;
    const groundedSources = (candidate?.groundingMetadata?.groundingChunks || [])
      .map(chunk => chunk.web)
      .filter((web): web is { uri?: string; title?: string } => !!web?.uri && /^https:\/\//i.test(web.uri))
      .map(web => web.uri as string);
    const rawListings = Array.isArray(raw.listings) ? raw.listings.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && typeof item.url === "string" && /^https:\/\//i.test(item.url)).slice(0, 8) : [];
    const actualPricedListings = rawListings.filter(item => typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0 && item.evidenceType !== "reference");
    const titleForSearch = String(raw.title || "предмет").slice(0, 120);
    const searchLinks = [
      { title: "Искать «" + titleForSearch + "» на Vinted", marketplace: "Vinted · поиск", url: "https://www.google.com/search?q=" + encodeURIComponent("site:vinted.cz " + titleForSearch) },
      { title: "Искать «" + titleForSearch + "» на Aukro", marketplace: "Aukro · поиск", url: "https://www.google.com/search?q=" + encodeURIComponent("site:aukro.cz " + titleForSearch) },
      { title: "Искать «" + titleForSearch + "» на Bazoš", marketplace: "Bazoš · поиск", url: "https://www.google.com/search?q=" + encodeURIComponent("site:bazos.cz " + titleForSearch) },
      { title: "Искать «" + titleForSearch + "» на eBay", marketplace: "eBay · поиск", url: "https://www.google.com/search?q=" + encodeURIComponent("site:ebay.com " + titleForSearch) },
    ];
    const modelSources = Array.isArray(raw.sources) ? raw.sources.filter((x): x is string => typeof x === "string" && /^https:\/\//i.test(x)) : [];
    raw.sources = [...new Set([...groundedSources, ...modelSources])].slice(0, 12);
    const fallbackSearchLinks = searchLinks.map(link => ({ title: link.title, price: null, currency, condition: "Открой поиск, чтобы сравнить варианты", marketplace: link.marketplace, url: link.url, evidenceType: "reference" }));
    raw.listings = actualPricedListings.length ? rawListings : [...rawListings, ...fallbackSearchLinks.filter(link => !rawListings.some(item => item.url === link.url))].slice(0, 8);
    if (!actualPricedListings.length) {
      const price = typeof raw.price === "object" && raw.price ? raw.price as Record<string, unknown> : {};
      raw.price = { ...price, low: null, high: null, quickSale: null, suggestedListing: null, confidence: "low", confidenceReason: "Не удалось подтвердить цену конкретными объявлениями с указанной стоимостью. Ссылки ниже открывают поиск по площадкам." };
    } else {
      const price = typeof raw.price === "object" && raw.price ? raw.price as Record<string, unknown> : {};
      raw.price = { ...price, confidence: price.confidence === "high" ? "medium" : (price.confidence || "medium") };
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
    const message = error instanceof Error ? error.message : String(error || "unknown");
    const err = error as { status?: number; code?: string; message?: string };
    const status = Number(err?.status || 0);
    const rawCode = String(err?.code || "");
    console.error("[Findly] Analysis failed:", { status, code: rawCode, message });
    let userMessage = "Сервис оценки временно не ответил. Подожди немного и попробуй ещё раз.";
    let errorCode = "analysis_failed";
    if (status === 429 || /quota|resource.?exhausted|rate.?limit/i.test(message)) {
      userMessage = "У Gemini закончился лимит запросов или временно слишком много запросов. Проверь лимиты Google AI Studio и попробуй позже.";
      errorCode = "gemini_quota";
    } else if (status === 401 || status === 403 || /api.?key|permission.?denied|unauthorized/i.test(message)) {
      userMessage = "Gemini не принимает API-ключ. Проверь GEMINI_API_KEY в Vercel и доступ ключа к Gemini API.";
      errorCode = "gemini_key";
    } else if (/model.*not found|not found.*model|unsupported model/i.test(message)) {
      userMessage = "Указанная модель Gemini недоступна. Удали GEMINI_MODEL из Vercel или укажи поддерживаемую модель.";
      errorCode = "gemini_model";
    } else if (/json|parse|unexpected token|model did not return/i.test(message)) {
      userMessage = "Gemini вернул ответ в неожиданном формате. Попробуй ещё раз.";
      errorCode = "gemini_response_format";
    }
    return NextResponse.json({ error: errorCode, message: userMessage, requestId: crypto.randomUUID() }, { status: 502 });
  }
}
