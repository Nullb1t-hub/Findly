export type MarketListing = {
  title: string;
  price?: number;
  currency?: string;
  condition?: string;
  marketplace?: string;
  url?: string;
  evidenceType?: "active_listing" | "sold" | "reference";
};

export type PriceEstimate = {
  low: number | null;
  high: number | null;
  currency: string;
  quickSale: number | null;
  suggestedListing: number | null;
  confidence: "low" | "medium" | "high";
  confidenceReason: string;
};

export type ScanResult = {
  id: string;
  title: string;
  brand?: string;
  model?: string;
  category: string;
  description: string;
  condition: string;
  estimatedAge?: string;
  rarity: "ordinary" | "possibly_collectible" | "potentially_rare" | "unknown";
  rarityReason: string;
  price: PriceEstimate;
  markets: Array<{ country: string; currency: string; low: number | null; high: number | null; notes: string }>;
  listings: MarketListing[];
  followUpQuestions: string[];
  listingDraft: { title: string; description: string; hashtags: string[] };
  sources: string[];
  createdAt: string;
  photoDataUrl?: string;
};

export type CollectionItem = ScanResult & {
  ownerId: string;
  collectionId?: string;
  status: "saved" | "for_sale" | "sold" | "archived";
  savedAt: string;
};

export type TelegramIdentity = {
  id: string;
  firstName: string;
  username?: string;
  photoUrl?: string;
  verified: boolean;
};
