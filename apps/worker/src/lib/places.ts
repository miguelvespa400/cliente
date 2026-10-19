// Busca de empresas pela API oficial do Google Places (New) — Text Search.
// Substitui o coletor por navegador (Playwright), que não roda no Workers.
// Custo: SKU "Text Search Enterprise" (telefone/site/nota) — 1.000 chamadas grátis/mês,
// até 20 empresas por chamada. Docs: https://developers.google.com/maps/documentation/places/web-service/text-search

const FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|wa\.me|whatsapp\.com|linktr\.ee|bio\.site|tiktok\.com|linkedin\.com|youtube\.com)$/i;

interface PlaceResult {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text: string };
}

export interface FoundPlace {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  website: string;
  hasWebsite: boolean;
  rating: string;
  reviewCount: number | null;
  category: string;
  referenceUrl: string;
}

const LANG: Record<string, string> = { portuguese: "pt-BR", english: "en", spanish: "es", indonesian: "id" };

export async function searchPlaces(
  apiKey: string,
  query: string,
  max: number,
  language: string,
): Promise<FoundPlace[]> {
  const out: FoundPlace[] = [];
  let pageToken: string | undefined;
  // A API devolve no máximo 20 por página e 3 páginas (60) por busca.
  for (let page = 0; page < 3 && out.length < max; page++) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({
        textQuery: query,
        languageCode: LANG[language] ?? "pt-BR",
        regionCode: "BR",
        pageSize: Math.min(20, max - out.length),
        ...(pageToken && { pageToken }),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json()) as { places?: PlaceResult[]; nextPageToken?: string; error?: { message: string; status: string } };
    if (!res.ok || data.error) throw new Error(placesError(data.error?.status, data.error?.message ?? `HTTP ${res.status}`));

    for (const p of data.places ?? []) {
      const website = p.websiteUri ?? "";
      let own = false;
      try { own = !!website && !SOCIAL.test(new URL(website).hostname); } catch { own = false; }
      out.push({
        placeId: p.id,
        name: p.displayName?.text ?? "(sem nome)",
        address: p.formattedAddress ?? "",
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        phone: p.nationalPhoneNumber ?? "",
        website,
        hasWebsite: own,
        rating: p.rating ? p.rating.toFixed(1) : "N/A",
        reviewCount: p.userRatingCount ?? null,
        category: p.primaryTypeDisplayName?.text ?? "",
        referenceUrl: p.googleMapsUri ?? "",
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, max);
}

/** Chamada mínima (só IDs, SKU mais barato) para validar a chave no botão "Testar". */
export async function testPlacesKey(apiKey: string) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
    body: JSON.stringify({ textQuery: "padaria em São Paulo", pageSize: 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { error?: { message: string; status: string } };
  if (!res.ok || data.error) return { ok: false, error: placesError(data.error?.status, data.error?.message ?? `HTTP ${res.status}`) };
  return { ok: true };
}

function placesError(status: string | undefined, message: string) {
  if (status === "PERMISSION_DENIED") return `Chave do Google sem permissão: ative a "Places API (New)" no Google Cloud e confira as restrições da chave. (${message})`;
  if (status === "INVALID_ARGUMENT" && /api key/i.test(message)) return "Chave do Google inválida.";
  if (status === "RESOURCE_EXHAUSTED") return "Cota do Google Places esgotada neste mês.";
  return `Google Places: ${message}`;
}
