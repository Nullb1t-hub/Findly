"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ScanResult, CollectionItem } from "@/lib/types";

declare global {
  interface Window {
    Telegram?: { WebApp?: {
      initData?: string;
      initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string; photo_url?: string } };
      ready?: () => void;
      expand?: () => void;
      setHeaderColor?: (color: string) => void;
      setBackgroundColor?: (color: string) => void;
      HapticFeedback?: { impactOccurred?: (style: string) => void; notificationOccurred?: (type: string) => void };
    } };
  }
}

type Tab = "scan" | "collection" | "saved";
type Stored = CollectionItem & { photoDataUrl?: string };
type FamilyCollection = { id: string; name: string; owner_id?: string; role: string; item_count?: number };

const STORAGE_KEY = "findly.collection.v1";
const FAVORITES_KEY = "findly.favorites.v1";
const money = (value: number | null | undefined, currency = "EUR") => {
  if (value == null || !Number.isFinite(value)) return "Нет данных";
  try { return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${Math.round(value)} ${currency}`; }
};
const readLocal = (): Stored[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as Stored[]; } catch { return []; }
};
const iconFor = (category: string) => {
  const c = category.toLowerCase();
  if (/одеж|куртк|обув|футбол|брюк|плать/.test(c)) return "◈";
  if (/игруш|фигур|коллекц|карта/.test(c)) return "✧";
  if (/электр|телефон|компьют|аудио/.test(c)) return "⌁";
  if (/часы|украш|ювелир/.test(c)) return "✳";
  return "◇";
};

export default function Home() {
  const [tab, setTab] = useState<Tab>("scan");
  const [items, setItems] = useState<Stored[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [current, setCurrent] = useState<ScanResult | null>(null);
  const [detail, setDetail] = useState<Stored | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("image/jpeg");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState("");
  const [country, setCountry] = useState("Czechia");
  const [currency, setCurrency] = useState("EUR");
  const [filter, setFilter] = useState<"all" | "for_sale" | "sold">("all");
  const [query, setQuery] = useState("");
  const [telegramName, setTelegramName] = useState("Гость");
  const [telegramInitData, setTelegramInitData] = useState("");
  const [notice, setNotice] = useState("");
  const [familyCollections, setFamilyCollections] = useState<FamilyCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState("");
  const [joinToken, setJoinToken] = useState("");
  const [familyBusy, setFamilyBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.(); tg?.expand?.();
    tg?.setHeaderColor?.("#15161b"); tg?.setBackgroundColor?.("#15161b");
    const initData = tg?.initData || "";
    setTelegramInitData(initData);
    const user = tg?.initDataUnsafe?.user;
    if (user) setTelegramName(user.first_name || "Пользователь");
    setItems(readLocal());
    try { setFavorites(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]") as string[]); } catch { /* empty */ }
    if (initData) {
      fetch("/api/collection", { headers: { "x-telegram-init-data": initData } })
        .then(async response => response.ok ? response.json() : null)
        .then(data => {
          if (Array.isArray(data?.items)) {
            setItems(local => {
              const merged = new Map<string, Stored>();
              for (const item of local) merged.set(item.id, item);
              for (const item of data.items as Stored[]) merged.set(item.id, item);
              return [...merged.values()].sort((a, b) => new Date(b.savedAt || b.createdAt).getTime() - new Date(a.savedAt || a.createdAt).getTime());
            });
          }
        })
        .catch(() => { /* local collection remains available */ });
      fetch("/api/family", { headers: { "x-telegram-init-data": initData } })
        .then(async response => response.ok ? response.json() : null)
        .then(data => {
          if (Array.isArray(data?.collections)) setFamilyCollections(data.collections as FamilyCollection[]);
        })
        .catch(() => { /* family sharing is optional until cloud services are configured */ });
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {
      setNotice("Память телефона заполнена. Удали часть фотографий или сохрани их отдельно.");
    }
  }, [items]);
  useEffect(() => {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* ignore */ }
  }, [favorites]);

  const activeItems = useMemo(() => items.filter(item => item.status !== "archived" && (filter === "all" || item.status === filter) && (`${item.title} ${item.brand || ""} ${item.category}`).toLowerCase().includes(query.toLowerCase())), [items, filter, query]);
  const savedItems = useMemo(() => items.filter(item => favorites.includes(item.id) && item.status !== "archived"), [items, favorites]);

  const haptic = (style = "light") => window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
  const choosePhoto = () => { haptic(); fileRef.current?.click(); };
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Выбери изображение."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Фото должно быть до 5 МБ."); return; }
    setError(""); setCurrent(null); setDetail(null); setNotice("");
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result)); setMimeType(file.type || "image/jpeg");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const analyze = async () => {
    if (!photo || loading) return;
    setLoading(true); setError(""); setNotice(""); haptic("medium");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(telegramInitData ? { "x-telegram-init-data": telegramInitData } : {}) },
        body: JSON.stringify({ image: photo, mimeType, country, currency, extra }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || (data.error === "ai_not_configured" ? "AI пока не подключён. Добавь GEMINI_API_KEY в Vercel → Settings → Environment Variables." : "Не удалось проанализировать фото."));
      setCurrent(data.result as ScanResult);
      haptic("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка анализа. Попробуй ещё раз.");
    } finally { setLoading(false); }
  };

  const saveCurrent = async () => {
    if (!current) return;
    const item: Stored = { ...current, ownerId: telegramInitData ? "telegram-user" : "local-user", collectionId: activeCollectionId || undefined, status: "saved", savedAt: new Date().toISOString() };
    setItems(old => [item, ...old.filter(x => x.id !== item.id)]);
    setCurrent(null); setPhoto(null); setExtra(""); setTab("collection"); setNotice(activeCollectionId ? "Добавлено в общую коллекцию" : "Добавлено в твою коллекцию"); haptic("success");
    if (telegramInitData) {
      try {
        const res = await fetch("/api/collection", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-init-data": telegramInitData }, body: JSON.stringify({ item }) });
        if (!res.ok) setNotice("Сохранено на этом устройстве. Для облачной синхронизации проверь подключение базы данных.");
      } catch { setNotice("Сохранено на этом устройстве. Облачная синхронизация пока недоступна."); }
    }
  };

  const changeStatus = async (item: Stored, status: Stored["status"]) => {
    setItems(old => old.map(x => x.id === item.id ? { ...x, status } : x));
    setDetail(null);
    setNotice(status === "sold" ? "Отмечено как проданное" : status === "archived" ? "Убрано из активной коллекции" : "Статус обновлён");
    if (telegramInitData) {
      try { await fetch("/api/collection", { method: "PATCH", headers: { "Content-Type": "application/json", "x-telegram-init-data": telegramInitData }, body: JSON.stringify({ id: item.id, status }) }); } catch { /* local state remains */ }
    }
  };

  const toggleFavorite = (id: string) => setFavorites(old => old.includes(id) ? old.filter(x => x !== id) : [id, ...old]);
  const familyAction = async (body: Record<string, string>) => {
    if (!telegramInitData) { setNotice("Открой Findly через Telegram, чтобы создавать общие коллекции."); return null; }
    setFamilyBusy(true);
    try {
      const response = await fetch("/api/family", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-init-data": telegramInitData }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "database_not_configured" ? "Для общих коллекций нужно подключить базу данных." : data.error === "invite_expired" ? "Код приглашения истёк или уже использован." : "Не удалось выполнить действие.");
      const list = await fetch("/api/family", { headers: { "x-telegram-init-data": telegramInitData } });
      if (list.ok) { const refreshed = await list.json(); setFamilyCollections(refreshed.collections || []); }
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка семейной коллекции.");
      return null;
    } finally { setFamilyBusy(false); }
  };
  const createFamilyCollection = async () => {
    const name = window.prompt("Название общей коллекции", "Семейные находки");
    if (!name?.trim()) return;
    const data = await familyAction({ action: "create", name: name.trim() });
    if (data?.collection?.id) { setActiveCollectionId(data.collection.id); setNotice("Общая коллекция создана"); }
  };
  const createInvite = async (collectionId: string) => {
    const data = await familyAction({ action: "invite", collectionId });
    if (data?.token) {
      try { await navigator.clipboard.writeText(data.token); setNotice("Код приглашения скопирован. Отправь его человеку, которого хочешь пригласить."); }
      catch { setNotice("Код приглашения: " + data.token); }
    }
  };
  const joinFamilyCollection = async () => {
    const data = await familyAction({ action: "join", token: joinToken.trim() });
    if (data?.collection) { setJoinToken(""); setNotice("Ты присоединился к общей коллекции"); }
  };
  const resetScan = () => { setCurrent(null); setPhoto(null); setError(""); setExtra(""); };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-lockup" onClick={() => { setTab("scan"); setCurrent(null); }} aria-label="Findly home">
          <span className="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3.5a7 7 0 1 0 4.2 12.6l4.3 4.4 1.4-1.4-4.4-4.3a7 7 0 0 0-5.5-11.3Z"/><path d="M7.5 10.5h6M10.5 7.5v6"/></svg></span>
          <span><strong>findly</strong><small>DISCOVER THE VALUE</small></span>
        </button>
        <div className="profile-pill"><span className="profile-dot">{telegramName.slice(0, 1).toUpperCase()}</span><span>{telegramName}</span></div>
      </header>

      <section className="page-content">
        {tab === "scan" && !current && (
          <>
            <div className="hero-copy">
              <div className="eyebrow"><span className="status-pulse" /> AI OBJECT INTELLIGENCE</div>
              <h1>У каждой вещи<br/><span>есть своя история.</span></h1>
              <p>Узнай, что у тебя в руках, сколько это может стоить и где выгоднее продать.</p>
            </div>
            <button className={photo ? "scanner-card has-photo" : "scanner-card"} onClick={choosePhoto}>
              {photo ? <img className="selected-photo" src={photo} alt="Выбранный предмет"/> : <span className="scanner-visual"><span className="scan-ring ring-one"/><span className="scan-ring ring-two"/><span className="scan-core"><svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2l1.3-1.5h4.4L15.5 5h2A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12" r="3.5"/></svg></span><span className="spark spark-a">✳</span><span className="spark spark-b">✧</span></span>}
              <span className="scanner-label">{photo ? "Фото готово к анализу" : "Сканировать предмет"}</span>
              <span className="scanner-sub">{photo ? "Нажми, чтобы выбрать другое фото" : "Одежда · техника · коллекции · всё что угодно"}</span>
              <span className="scan-action">{photo ? "Изменить фото" : "Выбрать фото"} <span>↗</span></span>
            </button>
            {photo && <div className="selected-actions"><button className="button-secondary" onClick={resetScan}>Сбросить</button><button className="button-primary" onClick={analyze} disabled={loading}>{loading ? <><span className="spinner"/> Исследуем предмет…</> : "Определить стоимость"} <span>→</span></button></div>}
            <input ref={fileRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={onFile}/>
            <div className="market-settings panel">
              <div className="panel-heading"><span className="mini-icon">◎</span><div><strong>Где будем искать?</strong><small>Сначала твой рынок, затем — мир</small></div></div>
              <div className="field-grid">
                <label>Основная страна<select value={country} onChange={e => setCountry(e.target.value)}><option value="Czechia">Чехия</option><option value="Germany">Германия</option><option value="Poland">Польша</option><option value="United States">США</option><option value="United Kingdom">Великобритания</option><option value="Ukraine">Украина</option><option value="France">Франция</option><option value="Worldwide">Весь мир</option></select></label>
                <label>Валюта<select value={currency} onChange={e => setCurrency(e.target.value)}><option value="EUR">EUR · €</option><option value="CZK">CZK · Kč</option><option value="USD">USD · $</option><option value="GBP">GBP · £</option><option value="PLN">PLN · zł</option><option value="UAH">UAH · ₴</option></select></label>
              </div>
              <label className="extra-label">Что ты уже знаешь? <span>необязательно</span><textarea value={extra} onChange={e => setExtra(e.target.value)} placeholder="Например: куплено в 2005 году, есть коробка…" rows={2}/></label>
            </div>
            <div className="section-title"><div><span className="eyebrow">YOUR SPACE</span><h2>Твоя коллекция</h2></div><button className="text-link" onClick={() => setTab("collection")}>Все вещи <span>↗</span></button></div>
            {items.length ? <div className="item-grid">{items.filter(x => x.status !== "archived").slice(0, 4).map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)} favorite={favorites.includes(item.id)} onFavorite={() => toggleFavorite(item.id)}/>)}</div> : <div className="empty-mini"><span className="empty-glyph">◇</span><div><strong>Здесь начнутся твои находки</strong><p>Сканируй первый предмет и сохраняй всё, что захочешь.</p></div></div>}
          </>
        )}

        {tab === "scan" && current && (
          <div className="results-view">
            <button className="back-link" onClick={resetScan}>← Новый скан</button>
            <div className="result-cover">{current.photoDataUrl && <img src={current.photoDataUrl} alt={current.title}/>}<div className="cover-shade"/><div className="cover-tag"><span className="status-pulse"/>{current.rarity === "potentially_rare" ? "ВОЗМОЖНО РЕДКИЙ" : current.rarity === "possibly_collectible" ? "КОЛЛЕКЦИОННЫЙ" : "AI ANALYSIS"}</div><div className="cover-title"><span>{current.category}</span><h1>{current.title}</h1>{current.brand && <p>{current.brand}{current.model ? ` · ${current.model}` : ""}</p>}</div></div>
            <div className="price-panel panel">
              <div className="price-top"><div><span className="eyebrow">ОЦЕНКА ДЛЯ ТВОЕГО РЫНКА</span><div className="price-range">{current.price.low != null && current.price.high != null ? <>{money(current.price.low, current.price.currency)} <span>—</span> {money(current.price.high, current.price.currency)}</> : "Недостаточно данных"}</div></div><span className={`confidence confidence-${current.price.confidence}`}>{current.price.confidence === "high" ? "Высокая" : current.price.confidence === "medium" ? "Средняя" : "Низкая"} уверенность</span></div>
              <p className="muted-copy">{current.price.confidenceReason}</p>
              <div className="price-stats"><div><span>Быстрая продажа</span><strong>{money(current.price.quickSale, current.price.currency)}</strong></div><div><span>Цена объявления</span><strong>{money(current.price.suggestedListing, current.price.currency)}</strong></div></div>
            </div>
            <div className="panel details-panel"><div className="panel-heading"><span className="mini-icon">✧</span><div><strong>Что удалось определить</strong><small>На основе фото и доступных источников</small></div></div><p>{current.description}</p><div className="detail-chips"><span>{current.condition || "Состояние не определено"}</span>{current.estimatedAge && <span>{current.estimatedAge}</span>}</div>{current.rarityReason && <div className="insight-note"><span>✦</span><p>{current.rarityReason}</p></div>}</div>
            {current.markets?.length > 0 && <div className="panel"><div className="panel-heading"><span className="mini-icon">◎</span><div><strong>Другие рынки</strong><small>Сравни возможности продажи</small></div></div><div className="market-list">{current.markets.map((market, i) => <div className="market-row" key={market.country + i}><div><strong>{market.country}</strong><p>{market.notes}</p></div><b>{market.low != null && market.high != null ? `${money(market.low, market.currency)} – ${money(market.high, market.currency)}` : "Нет надёжной оценки"}</b></div>)}</div></div>}
            {current.listings?.length > 0 && <div className="panel"><div className="panel-heading"><span className="mini-icon">↗</span><div><strong>Найденные аналоги</strong><small>Проверяй состояние и точность совпадения</small></div></div><div className="listing-list">{current.listings.map((listing, i) => <a className="listing-row" href={listing.url} target="_blank" rel="noreferrer" key={listing.url + i}><div><strong>{listing.title}</strong><p>{listing.marketplace || "Источник"} · {listing.evidenceType === "sold" ? "Продан" : listing.evidenceType === "active_listing" ? "Объявление" : "Справочный источник"}</p></div><b>{listing.price != null ? money(listing.price, listing.currency || current.price.currency) : "Открыть"} ↗</b></a>)}</div></div>}
            {current.followUpQuestions?.length > 0 && <div className="panel followup-panel"><div className="panel-heading"><span className="mini-icon">＋</span><div><strong>Можно уточнить оценку</strong><small>Дополнительные детали повысят точность</small></div></div>{current.followUpQuestions.map((question, i) => <p className="question-row" key={i}><span>{i + 1}</span>{question}</p>)}</div>}
            <div className="panel listing-draft"><div className="panel-heading"><span className="mini-icon">✎</span><div><strong>Черновик объявления</strong><small>Можно скопировать в Vinted</small></div></div><strong>{current.listingDraft.title}</strong><p>{current.listingDraft.description}</p><div className="hashtags">{current.listingDraft.hashtags?.map(tag => <span key={tag}>{tag}</span>)}</div><button className="button-secondary full-width" onClick={() => { const text = [current.listingDraft.title, current.listingDraft.description, current.listingDraft.hashtags?.join(" ")].filter(Boolean).join("\n\n"); void navigator.clipboard?.writeText(text); setNotice("Текст объявления скопирован"); }}>Копировать объявление ↗</button></div>
            {current.sources?.length > 0 && <div className="source-line">Источники: {current.sources.map((source, i) => <a href={source} target="_blank" rel="noreferrer" key={source}>Источник {i + 1} ↗ </a>)}</div>}
            <div className="save-question"><span className="save-spark">✧</span><h2>{activeCollectionId ? "Добавить в общую коллекцию?" : "Добавить в твою коллекцию?"}</h2><p>Даже если вещь ничего не стоит — решаешь только ты.</p>{familyCollections.length > 0 && <label className="save-target">Куда сохранить<select value={activeCollectionId} onChange={e => setActiveCollectionId(e.target.value)}><option value="">Моя личная коллекция</option>{familyCollections.filter(x => x.role !== "viewer").map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}<div className="save-actions"><button className="button-secondary" onClick={resetScan}>Не сохранять</button><button className="button-primary" onClick={saveCurrent}>Добавить в коллекцию <span>＋</span></button></div></div>
          </div>
        )}

        {tab === "collection" && (
          <div className="collection-view">
            <div className="hero-copy compact"><div className="eyebrow"><span className="status-pulse"/> YOUR PERSONAL VAULT</div><h1>Твоя <span>коллекция.</span></h1><p>Всё, что ты нашёл, оценил и решил сохранить.</p></div>
            <div className="collection-summary"><div><span>Сохранено</span><strong>{items.filter(x => x.status !== "archived").length}</strong></div><div><span>На продаже</span><strong>{items.filter(x => x.status === "for_sale").length}</strong></div><div><span>Продано</span><strong>{items.filter(x => x.status === "sold").length}</strong></div></div>
            <div className="collection-toolbar"><div className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти вещь…"/></div><button className="square-button" onClick={() => { setTab("scan"); resetScan(); }} aria-label="Scan item">＋</button></div>
            <div className="family-panel panel">
              <div className="panel-heading"><span className="mini-icon">⌘</span><div><strong>Общие коллекции</strong><small>Собирай находки с семьёй и друзьями</small></div></div>
              <button className="button-secondary full-width" onClick={createFamilyCollection} disabled={familyBusy}>＋ Создать общую коллекцию</button>
              {familyCollections.map(collection => <div className="family-row" key={collection.id}><button className="family-select" onClick={() => setActiveCollectionId(collection.id)}><span className="family-glyph">◇</span><span><strong>{collection.name}</strong><small>{collection.item_count || 0} вещей · {collection.role === "owner" ? "владелец" : collection.role === "viewer" ? "просмотр" : "участник"}</small></span></button><button className="family-invite" onClick={() => createInvite(collection.id)} disabled={familyBusy} aria-label="Пригласить участника">↗</button></div>)}
              <div className="join-row"><input value={joinToken} onChange={e => setJoinToken(e.target.value)} placeholder="Код приглашения"/><button className="button-primary" onClick={joinFamilyCollection} disabled={familyBusy || joinToken.trim().length < 20}>Войти</button></div>
              {activeCollectionId && <div className="active-collection-note"><span>✓</span> Новые сканы будут сохраняться в выбранную общую коллекцию. <button onClick={() => setActiveCollectionId("")}>Вернуть личную</button></div>}
            </div>
            <div className="filter-tabs">{(["all", "for_sale", "sold"] as const).map(key => <button key={key} className={filter === key ? "filter-active" : ""} onClick={() => setFilter(key)}>{key === "all" ? "Все вещи" : key === "for_sale" ? "На продаже" : "Продано"}</button>)}</div>
            {activeItems.length ? <div className="item-grid">{activeItems.map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)} favorite={favorites.includes(item.id)} onFavorite={() => toggleFavorite(item.id)}/>)}</div> : <div className="empty-state"><span className="empty-glyph">◇</span><h3>{query ? "Ничего не найдено" : "Коллекция пока пуста"}</h3><p>{query ? "Попробуй изменить запрос." : "Первый скан — начало твоей коллекции. Сохраняй вещи, которые хочется оставить."}</p><button className="button-primary" onClick={() => setTab("scan")}>Сканировать предмет ↗</button></div>}
          </div>
        )}

        {tab === "saved" && (
          <div className="collection-view">
            <div className="hero-copy compact"><div className="eyebrow"><span className="status-pulse"/> BOOKMARKED FINDS</div><h1>Твои <span>избранные.</span></h1><p>Вещи, к которым хочется вернуться.</p></div>
            {savedItems.length ? <div className="item-grid">{savedItems.map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)} favorite onFavorite={() => toggleFavorite(item.id)}/>)}</div> : <div className="empty-state"><span className="empty-glyph">✧</span><h3>Пока без закладок</h3><p>Нажимай на сердечко у интересных вещей, чтобы сохранить их здесь.</p><button className="button-secondary" onClick={() => setTab("collection")}>Открыть коллекцию</button></div>}
          </div>
        )}
      </section>

      {error && <div className="toast toast-error" role="alert"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
      {notice && <div className="toast" role="status"><span>✓</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

      <nav className="bottom-nav" aria-label="Главная навигация">
        <button className={tab === "scan" ? "nav-active" : ""} onClick={() => { setTab("scan"); setCurrent(null); }}><span className="nav-icon"><svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2l1.3-1.5h4.4L15.5 5h2A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12" r="3.5"/></svg></span><span>Сканировать</span></button>
        <button className={tab === "collection" ? "nav-active" : ""} onClick={() => setTab("collection")}><span className="nav-icon"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="7" rx="1.5"/><rect x="14" y="4" width="6" height="7" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg></span><span>Коллекция</span></button>
        <button className={tab === "saved" ? "nav-active" : ""} onClick={() => setTab("saved")}><span className="nav-icon"><svg viewBox="0 0 24 24"><path d="M20.8 8.8c0 5-8.8 10.1-8.8 10.1S3.2 13.8 3.2 8.8a4.4 4.4 0 0 1 8.8-.3 4.4 4.4 0 0 1 8.8.3Z"/></svg></span><span>Избранное</span></button>
      </nav>

      {detail && <div className="modal-backdrop" onClick={() => setDetail(null)}><section className="item-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={detail.title}><button className="modal-close" onClick={() => setDetail(null)} aria-label="Close">×</button><div className="modal-photo">{detail.photoDataUrl ? <img src={detail.photoDataUrl} alt={detail.title}/> : <div className="modal-no-photo">{iconFor(detail.category)}</div>}<span className="modal-category">{detail.category}</span></div><div className="modal-body"><div className="eyebrow">ITEM OVERVIEW</div><h2>{detail.title}</h2>{detail.brand && <p className="modal-brand">{detail.brand} {detail.model || ""}</p>}<div className="modal-price">{detail.price.low != null && detail.price.high != null ? `${money(detail.price.low, detail.price.currency)} – ${money(detail.price.high, detail.price.currency)}` : "Нет надёжной оценки"}</div><p className="modal-description">{detail.description}</p><div className="detail-chips"><span>{detail.condition}</span><span>{detail.status === "sold" ? "Продано" : detail.status === "for_sale" ? "На продаже" : "В коллекции"}</span></div><div className="modal-actions">{detail.status !== "for_sale" && detail.status !== "sold" && <button className="button-primary full-width" onClick={() => changeStatus(detail, "for_sale")}>Отметить как выставленное</button>}{detail.status !== "sold" && <button className="button-secondary full-width" onClick={() => changeStatus(detail, "sold")}>Отметить как проданное ✓</button>}<button className="text-danger full-width" onClick={() => changeStatus(detail, "archived")}>Убрать из коллекции</button></div></div></section></div>}
    </main>
  );
}

function ItemCard({ item, onClick, favorite, onFavorite }: { item: Stored; onClick: () => void; favorite: boolean; onFavorite: () => void }) {
  return <article className="item-card"><button className="item-card-main" onClick={onClick} aria-label={`Открыть ${item.title}`}><div className="item-image">{item.photoDataUrl ? <img src={item.photoDataUrl} alt={item.title}/> : <div className="item-placeholder">◇</div>}<span className="item-category">{item.category}</span></div><div className="item-card-copy"><strong>{item.title}</strong>{item.brand && <span className="item-brand">{item.brand}</span>}<div className="item-card-price">{item.price.low != null && item.price.high != null ? <>{money(item.price.low, item.price.currency)} <span>–</span> {money(item.price.high, item.price.currency)}</> : "Цена не определена"}</div><span className={`item-status status-${item.status}`}>{item.status === "sold" ? "Продано" : item.status === "for_sale" ? "На продаже" : "В коллекции"}</span></div></button><button className={`favorite-button ${favorite ? "is-favorite" : ""}`} onClick={onFavorite} aria-label={favorite ? "Убрать из избранного" : "В избранное"}>{favorite ? "♥" : "♡"}</button></article>;
}
