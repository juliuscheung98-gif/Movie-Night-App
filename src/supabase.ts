import { createClient } from "@supabase/supabase-js";

// Keep only https://<project>.supabase.co: a URL copied with /rest/v1 or a trailing slash makes Supabase answer
// "Invalid path specified in request URL".
function projectUrl(raw: string | undefined) {
  try { return raw ? new URL(raw.trim()).origin : undefined; } catch { return undefined; }
}

const url = projectUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const configured = Boolean(url && key);
export const supabase = createClient(url || "http://localhost", key || "missing");
export const catalogUrl = url ? `${url}/storage/v1/object/public/catalog/catalog.json` : "/catalog.json";
