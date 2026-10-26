import { catalogUrl } from "./supabase";

export type Provider = "n" | "p" | "d";
export type Kind = "m" | "s";

export interface Title {
  id: string;        // "m" or "s" + TMDB id
  type: Kind;
  title: string;
  year: string;
  provs: Provider[];
  genres: string;    // TMDB genre names, comma separated
  rating: number;    // TMDB user rating, 0-10
  votes: number;
  pop: number;
  poster: string;    // TMDB poster path, e.g. "/abc.jpg"
  overview: string;
  rank: number;      // precomputed quality score for the queue
}

export interface Catalog {
  date: string;
  region: string;
  titles: Title[];
  byId: Map<string, Title>;
}

export const PROV: Record<Provider, { name: string; color: string }> = {
  n: { name: "Netflix", color: "#E50914" },
  p: { name: "Prime Video", color: "#1A73C8" },
  d: { name: "Disney+", color: "#1B3FA0" },
};

export const GENRES: { key: string; name: string; re: RegExp | null }[] = [
  { key: "all", name: "All genres", re: null },
  { key: "comedy", name: "Comedy", re: /comedy/i },
  { key: "thriller", name: "Thriller & Crime", re: /thriller|crime|mystery/i },
  { key: "action", name: "Action & Adventure", re: /action|adventure|war|western/i },
  { key: "drama", name: "Drama", re: /drama|history|music|soap/i },
  { key: "romance", name: "Romance", re: /romance/i },
  { key: "scifi", name: "Sci-Fi & Fantasy", re: /science fiction|sci-fi|fantasy/i },
  { key: "horror", name: "Horror", re: /horror/i },
  { key: "family", name: "Animation & Family", re: /animation|family|kids/i },
  { key: "docs", name: "Documentary & Reality", re: /documentary|reality|talk|news/i },
];

type Row = [string, Kind, string, string, string, number[], number, number, number, string, string];

export async function loadCatalog(): Promise<Catalog> {
  const r = await fetch(catalogUrl);
  if (!r.ok) throw new Error(`Catalog ${r.status}`);
  const raw: { date: string; region: string; genres: Record<string, string>; t: Row[] } = await r.json();
  const titles = raw.t.map(([id, type, title, year, provs, g, rating, votes, pop, poster, overview]): Title => ({
    id, type, title, year, provs: provs.split("") as Provider[],
    genres: g.map(x => raw.genres[x]).filter(Boolean).join(", "),
    rating, votes, pop, poster, overview,
    // Bayesian average so a 9.0 from 3 votes doesn't beat an 8.2 from 20,000, plus a nudge for well-known titles.
    rank: (votes * rating + 150 * 6.2) / (votes + 150) + 0.3 * Math.log10(votes + 1) + 0.1 * Math.log10(pop + 1),
  }));
  return { date: raw.date, region: raw.region, titles, byId: new Map(titles.map(t => [t.id, t])) };
}

export function posterUrl(t: Title, size: "w185" | "w342" | "w500" = "w342") {
  return t.poster ? `https://image.tmdb.org/t/p/${size}${t.poster}` : "";
}

export function hash(s: string) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Coloured fallback when TMDB has no poster.
export function posterBg(t: Title) {
  const h = hash(t.id), a = h % 360, b = (a + 40 + (h >> 9) % 80) % 360;
  return `linear-gradient(${(h >> 3) % 360}deg, hsl(${a} 55% 32%), hsl(${b} 60% 22%))`;
}
