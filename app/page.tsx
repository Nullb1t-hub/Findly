"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [telegramStatus, setTelegramStatus] = useState<"checking" | "connected" | "not_connected" | "not_configured">("checking");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [telegramPhoto, setTelegramPhoto] = useState("");
  const [notice, setNotice] = useState("");
  const [familyCollections, setFamilyCollections] = useState<FamilyCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState("");
  const [joinToken, setJoinToken] = useState("");
  const [familyBusy, setFamilyBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.(); tg?.expand?.();
    tg?.setHeaderColor?.("#050B19"); tg?.setBackgroundColor?.("#050B19");
    const initData = tg?.initData || "";
    setTelegramInitData(initData);
    const user = tg?.initDataUnsafe?.user;
    if (user) {
      setTelegramName(user.first_name || "Пользователь");
      setTelegramUsername(user.username || "");
      setTelegramPhoto(user.photo_url || "");
    }
    fetch("/api/auth/telegram", { headers: initData ? { "x-telegram-init-data": initData } : {} })
      .then(async response => await response.json())
      .then(data => {
        if (data.authenticated && data.user) {
          setTelegramStatus("connected");
          setTelegramName(data.user.firstName || user?.first_name || "Пользователь");
          setTelegramUsername(data.user.username || user?.username || "");
          setTelegramPhoto(data.user.photoUrl || user?.photo_url || "");
        } else if (!data.configured) setTelegramStatus("not_configured");
        else setTelegramStatus("not_connected");
      })
      .catch(() => setTelegramStatus("not_connected"));
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
  const stopCamera = () => { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setCameraOpen(false); };
  const openCamera = async () => {
    haptic(); setCameraError(""); setCameraOpen(true);
    try { if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable"); const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false }); streamRef.current = stream; if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); } }
    catch { setCameraError("Разреши доступ к камере в настройках Telegram и попробуй ещё раз."); }
  };
  const capturePhoto = () => { const video = videoRef.current; if (!video?.videoWidth || !video.videoHeight) return; const canvas = document.createElement("canvas"); const scale = Math.min(1, 2200 / Math.max(video.videoWidth, video.videoHeight)); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale); const context = canvas.getContext("2d"); if (!context) return; context.drawImage(video, 0, 0, canvas.width, canvas.height); setPhoto(canvas.toDataURL("image/jpeg", .9)); setMimeType("image/jpeg"); setCurrent(null); setError(""); stopCamera(); setMarketOpen(true); haptic("medium"); };

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
      if (!response.ok) throw new Error("Не получилось найти надёжные аналоги. Попробуй ещё раз.");
      setCurrent(data.result as ScanResult);
      haptic("success");
    } catch (e) {
      setError("Не получилось завершить поиск. Попробуй ещё раз.");
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
  const resetScan = () => { setCurrent(null); setPhoto(null); setError(""); setExtra(""); setMarketOpen(false); };
  useEffect(() => () => { streamRef.current?.getTracks().forEach(track => track.stop()); }, []);
  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => setTouchStartX(event.touches[0]?.clientX ?? null);
  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => { if (touchStartX === null) return; const dx = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX; if (Math.abs(dx) > 85) { if (dx < 0) { setTab("collection"); setCurrent(null); } else setTab("scan"); } setTouchStartX(null); };

  return (
    <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="topbar">
        <button className="brand-lockup" onClick={() => { setTab("scan"); setCurrent(null); }} aria-label="Findly home">
          <span className="brand-mark brand-logo"><Image src="/image.png" alt="Findly" width={42} height={42} unoptimized/></span>
          <span><strong>findly</strong></span>
        </button>
        <div className={`profile-pill ${telegramStatus === "connected" ? "profile-connected" : "profile-disconnected"}`} title={telegramStatus === "connected" ? "Telegram подключён" : "Telegram не подключён"}><span className="profile-dot">{telegramPhoto ? <Image src={telegramPhoto} alt="" width={28} height={28} unoptimized/> : telegramStatus === "connected" ? telegramName.slice(0, 1).toUpperCase() : "↗"}</span><span>{telegramStatus === "connected" ? (telegramUsername ? `@${telegramUsername}` : telegramName) : telegramStatus === "checking" ? "Проверяем…" : telegramStatus === "not_configured" ? "Нужна настройка" : "Подключи Telegram"}</span></div>
      </header>

      <section className="page-content">
        {tab === "scan" && !current && (
          <>
            
            <button className={photo ? "scanner-card has-photo" : "scanner-card"} onClick={openCamera}>
              {photo ? <Image className="selected-photo" src={photo} alt="Выбранный предмет" width={1200} height={800} unoptimized/> : <span className="scanner-visual"><span className="scan-ring ring-one"/><span className="scan-ring ring-two"/><span className="scan-core"><svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2l1.3-1.5h4.4L15.5 5h2A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12" r="3.5"/></svg></span><span className="spark spark-a">✳</span><span className="spark spark-b">✧</span></span>}
              <span className="scanner-label">{photo ? "Фото готово" : "Камера"}</span>
              <span className="scan-action">{photo ? "Переснять фото" : "Запустить камеру"} <span>↗</span></span>
            </button>
            {photo && <div className="selected-actions"><button className="button-secondary" onClick={resetScan}>Переснять</button><button className="button-primary" onClick={() => setMarketOpen(true)}>Продолжить <span>→</span></button></div>}
            <button className="camera-launch" onClick={openCamera}><span className="camera-launch-icon">⌾</span><span>{photo ? "Сфотографировать ещё раз" : "Сфотографировать"}</span><span className="camera-launch-arrow">↗</span></button>
            <div className="section-title"><div><span className="eyebrow">МОИ НАХОДКИ</span><h2>Коллекция</h2></div><button className="text-link" onClick={() => setTab("collection")}>Открыть <span>↗</span></button></div>
            {items.length ? <div className="item-grid">{items.filter(x => x.status !== "archived").slice(0, 4).map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)} favorite={favorites.includes(item.id)} onFavorite={() => toggleFavorite(item.id)}/>)}</div> : <div className="empty-mini"><span className="empty-glyph">◇</span><div><strong>Здесь начнутся твои находки</strong><p>Сканируй первый предмет и сохраняй всё, что захочешь.</p></div></div>}
          </>
        )}

        {tab === "scan" && current && (
          <div className="results-view">
            <button className="back-link" onClick={resetScan}>← Новый скан</button>
            <div className="result-cover">{current.photoDataUrl && <Image src={current.photoDataUrl} alt={current.title} width={1200} height={800} unoptimized/>}<div className="cover-shade"/><div className="cover-tag"><span className="status-pulse"/>{current.rarity === "potentially_rare" ? "ВОЗМОЖНО РЕДКИЙ" : current.rarity === "possibly_collectible" ? "КОЛЛЕКЦИОННЫЙ" : "НАЙДЕНО"}</div><div className="cover-title"><span>{current.category}</span><h1>{current.title}</h1>{current.brand && <p>{current.brand}{current.model ? ` · ${current.model}` : ""}</p>}</div></div>
            <div className="price-panel panel">
              <div className="price-top"><div><span className="eyebrow">ОЦЕНКА</span><div className="price-range">{current.price.low != null && current.price.high != null ? <>{money(current.price.low, current.price.currency)} <span>—</span> {money(current.price.high, current.price.currency)}</> : "Недостаточно данных"}</div></div><span className={`confidence confidence-${current.price.confidence}`}>{current.price.confidence === "high" ? "Высокая" : current.price.confidence === "medium" ? "Средняя" : "Низкая"} уверенность</span></div>
              <p className="muted-copy">{current.price.confidenceReason}</p>
              <div className="price-stats"><div><span>Быстрая продажа</span><strong>{money(current.price.quickSale, current.price.currency)}</strong></div><div><span>Цена объявления</span><strong>{money(current.price.suggestedListing, current.price.currency)}</strong></div></div>
            </div>
            <div className="panel details-panel"><div className="panel-heading"><span className="mini-icon">✧</span><div><strong>Описание</strong><small></small></div></div><p>{current.description}</p><div className="detail-chips"><span>{current.condition || "Состояние не определено"}</span>{current.estimatedAge && <span>{current.estimatedAge}</span>}</div>{current.rarityReason && <div className="insight-note"><span>✦</span><p>{current.rarityReason}</p></div>}</div>
            {current.markets?.length > 0 && <div className="panel"><div className="panel-heading"><span className="mini-icon">◎</span><div><strong>Другие рынки</strong><small>Сравни возможности продажи</small></div></div><div className="market-list">{current.markets.map((market, i) => <div className="market-row" key={market.country + i}><div><strong>{market.country}</strong><p>{market.notes}</p></div><b>{market.low != null && market.high != null ? `${money(market.low, market.currency)} – ${money(market.high, market.currency)}` : "Нет надёжной оценки"}</b></div>)}</div></div>}
            {current.listings?.length > 0 && <div className="panel"><div className="panel-heading"><span className="mini-icon">↗</span><div><strong>Похожие объявления</strong><small></small></div></div><div className="listing-list">{current.listings.filter((listing): listing is typeof listing & { url: string } => typeof listing.url === "string" && listing.url.length > 0).map((listing, i) => <a className="listing-row" href={listing.url} target="_blank" rel="noreferrer" key={`${listing.url}-${i}`}><div><strong>{listing.title}</strong><p>{listing.marketplace || "Источник"} · {listing.evidenceType === "sold" ? "Продан" : listing.evidenceType === "active_listing" ? "Объявление" : "Справочный источник"}</p></div><b>{listing.price != null ? money(listing.price, listing.currency || current.price.currency) : "Открыть"} ↗</b></a>)}</div></div>}
            {current.followUpQuestions?.length > 0 && <div className="panel followup-panel"><div className="panel-heading"><span className="mini-icon">＋</span><div><strong>Можно уточнить оценку</strong><small>Дополнительные детали повысят точность</small></div></div>{current.followUpQuestions.map((question, i) => <p className="question-row" key={i}><span>{i + 1}</span>{question}</p>)}</div>}
            <div className="panel listing-draft"><div className="panel-heading"><span className="mini-icon">✎</span><div><strong>Черновик объявления</strong><small>Можно скопировать в Vinted</small></div></div><strong>{current.listingDraft.title}</strong><p>{current.listingDraft.description}</p><div className="hashtags">{current.listingDraft.hashtags?.map(tag => <span key={tag}>{tag}</span>)}</div><button className="button-secondary full-width" onClick={() => { const text = [current.listingDraft.title, current.listingDraft.description, current.listingDraft.hashtags?.join(" ")].filter(Boolean).join("\n\n"); void navigator.clipboard?.writeText(text); setNotice("Текст объявления скопирован"); }}>Копировать объявление ↗</button></div>
            {current.sources?.length > 0 && <div className="source-line">Источники: {current.sources.map((source, i) => <a href={source} target="_blank" rel="noreferrer" key={source}>Источник {i + 1} ↗ </a>)}</div>}
            <div className="save-question"><span className="save-spark">✧</span><h2>{activeCollectionId ? "Добавить в общую коллекцию?" : "Добавить в твою коллекцию?"}</h2><p>Даже если вещь ничего не стоит — решаешь только ты.</p>{familyCollections.length > 0 && <label className="save-target">Куда сохранить<select value={activeCollectionId} onChange={e => setActiveCollectionId(e.target.value)}><option value="">Моя личная коллекция</option>{familyCollections.filter(x => x.role !== "viewer").map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}<div className="save-actions"><button className="button-secondary" onClick={resetScan}>Не сохранять</button><button className="button-primary" onClick={saveCurrent}>Добавить в коллекцию <span>＋</span></button></div></div>
          </div>
        )}

        {tab === "collection" && (
          <div className="collection-view">
            <div className="collection-head"><h1>Коллекции</h1><button className="square-button" onClick={createFamilyCollection} aria-label="Новая коллекция">＋</button></div>
            <div className="collection-summary"><div><span>Сохранено</span><strong>{items.filter(x => x.status !== "archived").length}</strong></div><div><span>На продаже</span><strong>{items.filter(x => x.status === "for_sale").length}</strong></div><div><span>Продано</span><strong>{items.filter(x => x.status === "sold").length}</strong></div></div>
            <div className="collection-toolbar"><div className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти вещь…"/></div><button className="square-button" onClick={() => { setTab("scan"); resetScan(); }} aria-label="Scan item">＋</button></div>
            <div className="family-panel panel">
              <div className="collection-tiles"><button className={`collection-tile ${!activeCollectionId ? "tile-active" : ""}`} onClick={() => setActiveCollectionId("")}><span className="tile-stack"><i/><i/><i/></span><strong>Моя коллекция</strong><small>{items.filter(x => !x.collectionId && x.status !== "archived").length} предметов</small></button>{familyCollections.map(collection => <button className={`collection-tile ${activeCollectionId === collection.id ? "tile-active" : ""}`} key={collection.id} onClick={() => setActiveCollectionId(collection.id)}><span className="tile-stack shared"><i/><i/><i/></span><strong>{collection.name}</strong><small>{collection.item_count || 0} предметов · общая</small><span className="tile-share" onClick={e => { e.stopPropagation(); void createInvite(collection.id); }}>↗</span></button>)}<button className="collection-tile tile-new" onClick={createFamilyCollection} disabled={familyBusy}><span className="tile-plus">＋</span><strong>Новая коллекция</strong><small>Создать и пригласить</small></button></div>
              
              <div className="join-row"><input value={joinToken} onChange={e => setJoinToken(e.target.value)} placeholder="Код приглашения"/><button className="button-primary" onClick={joinFamilyCollection} disabled={familyBusy || joinToken.trim().length < 20}>Войти</button></div>
              {activeCollectionId && <div className="active-collection-note"><span>✓</span> Новые сканы будут сохраняться в выбранную общую коллекцию. <button onClick={() => setActiveCollectionId("")}>Вернуть личную</button></div>}
            </div>
            <div className="filter-tabs">{(["all", "for_sale", "sold"] as const).map(key => <button key={key} className={filter === key ? "filter-active" : ""} onClick={() => setFilter(key)}>{key === "all" ? "Все вещи" : key === "for_sale" ? "На продаже" : "Продано"}</button>)}</div>
            {activeItems.length ? <div className="item-grid">{activeItems.map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)} favorite={favorites.includes(item.id)} onFavorite={() => toggleFavorite(item.id)}/>)}</div> : <div className="empty-state"><span className="empty-glyph">◇</span><h3>{query ? "Ничего не найдено" : "Коллекция пока пуста"}</h3><p>{query ? "Попробуй изменить запрос." : "Первый скан — начало твоей коллекции. Сохраняй вещи, которые хочется оставить."}</p><button className="button-primary" onClick={() => setTab("scan")}>Сканировать предмет ↗</button></div>}
          </div>
        )}

        {tab === "saved" && (
          <div className="collection-view">
            <div className="collection-head"><h1>Избранное</h1></div>
            {savedItems.length ? <div className="item-grid">{savedItems.map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)} favorite onFavorite={() => toggleFavorite(item.id)}/>)}</div> : <div className="empty-state"><span className="empty-glyph">✧</span><h3>Пока без закладок</h3><p>Нажимай на сердечко у интересных вещей, чтобы сохранить их здесь.</p><button className="button-secondary" onClick={() => setTab("collection")}>Открыть коллекцию</button></div>}
          </div>
        )}
      </section>

      {error && <div className="toast toast-error" role="alert"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
      {notice && <div className="toast" role="status"><span>✓</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

      {cameraOpen && <div className="camera-overlay"><video ref={videoRef} className="camera-video" playsInline muted autoPlay/><div className="camera-topline"><button onClick={stopCamera} aria-label="Закрыть камеру">×</button><span>FINDLY</span><button onClick={() => window.Telegram?.WebApp?.expand?.()} aria-label="Развернуть">⛶</button></div>{cameraError && <div className="camera-error">{cameraError}<button onClick={openCamera}>Повторить</button></div>}<div className="camera-bottom"><span>Наведи на предмет</span><button className="shutter" onClick={capturePhoto} aria-label="Сделать фото"><span/></button><small>Нажми, чтобы сфотографировать</small></div></div>}
      {marketOpen && photo && !current && <div className="modal-backdrop market-backdrop"><section className="market-modal" role="dialog" aria-modal="true" aria-label="Регион и валюта"><button className="modal-close" onClick={() => setMarketOpen(false)}>×</button><div className="modal-photo market-photo"><Image src={photo} alt="Предмет" width={1200} height={800} unoptimized/></div><h2>Страна и валюта</h2><div className="field-grid"><label>Страна<select value={country} onChange={e => setCountry(e.target.value)}><option value="Czechia">Чехия</option><option value="Germany">Германия</option><option value="Poland">Польша</option><option value="United States">США</option><option value="United Kingdom">Великобритания</option><option value="Ukraine">Украина</option><option value="France">Франция</option><option value="Worldwide">Весь мир</option></select></label><label>Валюта<select value={currency} onChange={e => setCurrency(e.target.value)}><option value="EUR">EUR · €</option><option value="CZK">CZK · Kč</option><option value="USD">USD · $</option><option value="GBP">GBP · £</option><option value="PLN">PLN · zł</option><option value="UAH">UAH · ₴</option></select></label></div><label className="extra-label">Детали <span>необязательно</span><textarea value={extra} onChange={e => setExtra(e.target.value)} placeholder="Марка, модель, год выпуска…" rows={2}/></label><button className="button-primary full-width analyze-button" onClick={analyze} disabled={loading}>{loading ? <><span className="spinner"/> Ищем аналоги…</> : "Найти стоимость"}<span>→</span></button></section></div>}
      {detail && <div className="modal-backdrop" onClick={() => setDetail(null)}><section className="item-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={detail.title}><button className="modal-close" onClick={() => setDetail(null)} aria-label="Close">×</button><div className="modal-photo">{detail.photoDataUrl ? <Image src={detail.photoDataUrl} alt={detail.title} width={1200} height={800} unoptimized/> : <div className="modal-no-photo">{iconFor(detail.category)}</div>}<span className="modal-category">{detail.category}</span></div><div className="modal-body"><div className="eyebrow">ITEM OVERVIEW</div><h2>{detail.title}</h2>{detail.brand && <p className="modal-brand">{detail.brand} {detail.model || ""}</p>}<div className="modal-price">{detail.price.low != null && detail.price.high != null ? `${money(detail.price.low, detail.price.currency)} – ${money(detail.price.high, detail.price.currency)}` : "Нет надёжной оценки"}</div><p className="modal-description">{detail.description}</p><div className="detail-chips"><span>{detail.condition}</span><span>{detail.status === "sold" ? "Продано" : detail.status === "for_sale" ? "На продаже" : "В коллекции"}</span></div><div className="modal-actions">{detail.status !== "for_sale" && detail.status !== "sold" && <button className="button-primary full-width" onClick={() => changeStatus(detail, "for_sale")}>Отметить как выставленное</button>}{detail.status !== "sold" && <button className="button-secondary full-width" onClick={() => changeStatus(detail, "sold")}>Отметить как проданное ✓</button>}<button className="text-danger full-width" onClick={() => changeStatus(detail, "archived")}>Убрать из коллекции</button></div></div></section></div>}
    </main>
  );
}

function ItemCard({ item, onClick, favorite, onFavorite }: { item: Stored; onClick: () => void; favorite: boolean; onFavorite: () => void }) {
  return <article className="item-card"><button className="item-card-main" onClick={onClick} aria-label={`Открыть ${item.title}`}><div className="item-image">{item.photoDataUrl ? <Image src={item.photoDataUrl} alt={item.title} width={600} height={600} unoptimized/> : <div className="item-placeholder">◇</div>}<span className="item-category">{item.category}</span></div><div className="item-card-copy"><strong>{item.title}</strong>{item.brand && <span className="item-brand">{item.brand}</span>}<div className="item-card-price">{item.price.low != null && item.price.high != null ? <>{money(item.price.low, item.price.currency)} <span>–</span> {money(item.price.high, item.price.currency)}</> : "Цена не определена"}</div><span className={`item-status status-${item.status}`}>{item.status === "sold" ? "Продано" : item.status === "for_sale" ? "На продаже" : "В коллекции"}</span></div></button><button className={`favorite-button ${favorite ? "is-favorite" : ""}`} onClick={onFavorite} aria-label={favorite ? "Убрать из избранного" : "В избранное"}>{favorite ? "♥" : "♡"}</button></article>;
}
