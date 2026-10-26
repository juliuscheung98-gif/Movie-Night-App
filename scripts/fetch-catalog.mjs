// Fetches every movie and series included (flatrate) with Netflix, Prime Video or Disney+ in one region from TMDB
// and uploads it as catalog.json to the public "catalog" bucket in Supabase Storage, where the app loads it.
// Runs nightly in GitHub Actions. Needs TMDB_API_KEY (v3 key or v4 read token); without SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY it only writes public/catalog.json, for local development.
//
//   TMDB_API_KEY=... node scripts/fetch-catalog.mjs
//
// The catalog is not committed to git: it changes every night and would bloat the repo.

// TMDB's discover endpoint stops at page 500 and skips titles when paging by popularity, so each provider is
// fetched per release-date range sorted by title, and a range with more than 10,000 results is split in half.

import { writeFile } from "node:fs/promises";

const KEY = process.env.TMDB_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REGION = process.env.TMDB_REGION || "DE";
const LANGUAGE = process.env.TMDB_LANGUAGE || "en-US";
const OUT = new URL("../public/catalog.json", import.meta.url);
// Short codes keep the JSON small; the app maps them back to names and colours.
const PROVIDERS = { n: 8, p: 9, d: 337 };
const MAX_DROP = 0.2; // refuse to publish if the catalog shrinks by more than 20%: likely a TMDB hiccup, not reality

if (!KEY) { console.error("TMDB_API_KEY is not set"); process.exit(1); }
const auth = KEY.length > 40 ? { headers: { Authorization: `Bearer ${KEY}` } } : null;

let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= 8) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

async function tmdb(path, params = {}) {
  const url = new URL("https://api.themoviedb.org/3" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!auth) url.searchParams.set("api_key", KEY);
  for (let attempt = 0; ; attempt++) {
    const r = await limited(() => fetch(url, auth || undefined));
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && attempt < 5) {
      await new Promise(res => setTimeout(res, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`TMDB ${r.status} for ${path}: ${await r.text()}`);
  }
}

const day = d => d.toISOString().slice(0, 10);

async function discoverRange(kind, providerId, from, to) {
  const dateKey = kind === "movie" ? "primary_release_date" : "first_air_date";
  const base = {
    watch_region: REGION, with_watch_providers: String(providerId), with_watch_monetization_types: "flatrate",
    language: LANGUAGE, sort_by: "original_title.asc", include_adult: "false",
    [`${dateKey}.gte`]: day(from), [`${dateKey}.lte`]: day(to),
  };
  const first = await tmdb(`/discover/${kind}`, { ...base, page: 1 });
  if (first.total_results > 10000 && to - from > 86400000) {
    const mid = new Date((from.getTime() + to.getTime()) / 2);
    const [a, b] = await Promise.all([
      discoverRange(kind, providerId, from, mid),
      discoverRange(kind, providerId, new Date(mid.getTime() + 86400000), to),
    ]);
    return a.concat(b);
  }
  const pages = Math.min(first.total_pages, 500);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => tmdb(`/discover/${kind}`, { ...base, page: i + 2 })));
  return [first, ...rest].flatMap(p => p.results);
}

async function main() {
  const titles = new Map();
  const genres = {};
  for (const kind of ["movie", "tv"]) {
    for (const g of (await tmdb(`/genre/${kind}/list`, { language: LANGUAGE })).genres) genres[g.id] = g.name;
  }

  // Yearly ranges from 1980, one range for everything older.
  const now = new Date();
  const ranges = [[new Date("1874-01-01"), new Date("1979-12-31")]];
  for (let y = 1980; y <= now.getUTCFullYear() + 1; y++) ranges.push([new Date(`${y}-01-01`), new Date(`${y}-12-31`)]);

  for (const kind of ["movie", "tv"]) {
    for (const [code, providerId] of Object.entries(PROVIDERS)) {
      const results = (await Promise.all(ranges.map(([a, b]) => discoverRange(kind, providerId, a, b)))).flat();
      for (const r of results) {
        const id = (kind === "movie" ? "m" : "s") + r.id;
        const t = titles.get(id);
        if (t) { if (!t.provs.includes(code)) t.provs += code; continue; }
        const date = kind === "movie" ? r.release_date : r.first_air_date;
        titles.set(id, {
          id, type: kind === "movie" ? "m" : "s", title: kind === "movie" ? r.title : r.name,
          year: (date || "").slice(0, 4), provs: code, genres: r.genre_ids || [],
          rating: Math.round((r.vote_average || 0) * 10) / 10, votes: r.vote_count || 0,
          pop: Math.round(r.popularity || 0), poster: r.poster_path || "", overview: r.overview || "",
        });
      }
      console.log(`${kind} ${code}: ${titles.size} titles so far`);
    }
  }

  const rows = [...titles.values()]
    .sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id))
    .map(t => [t.id, t.type, t.title, t.year, t.provs, t.genres, t.rating, t.votes, t.pop, t.poster, t.overview]);

  const body = JSON.stringify({ region: REGION, date: day(now), genres, t: rows });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    await writeFile(OUT, body);
    console.log(`Wrote ${rows.length} titles to public/catalog.json.`);
    return;
  }

  let previous = 0;
  const old = await fetch(`${SUPABASE_URL}/storage/v1/object/public/catalog/catalog.json`, { cache: "no-store" });
  if (old.ok) previous = (await old.json()).t.length;
  if (previous && rows.length < previous * (1 - MAX_DROP)) {
    console.error(`Catalog shrank from ${previous} to ${rows.length} titles; not uploading. Run again or check TMDB.`);
    process.exit(1);
  }
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/catalog/catalog.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY,
      "Content-Type": "application/json", "x-upsert": "true", "cache-control": "max-age=3600",
    },
    body,
  });
  if (!up.ok) throw new Error(`Upload failed: ${up.status} ${await up.text()}`);
  console.log(`Uploaded ${rows.length} titles (was ${previous}).`);
}

main().catch(e => { console.error(e); process.exit(1); });
