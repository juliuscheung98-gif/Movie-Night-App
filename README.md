# Movie Night

Swipe movies and series on Netflix, Prime Video and Disney+ (Germany) with your partner. Each of you judges on your
own phone; anything you both like becomes a match. "Seen it" is shared and hides the title for both of you.

- **Frontend:** Vite + React, installable as a PWA, hosted on Vercel.
- **Backend:** Supabase (email sign-in links, Postgres with Row Level Security, live updates).
- **Catalog:** a nightly GitHub Action pulls titles from TMDB and uploads `catalog.json` to Supabase Storage.

## Setup (about 20 minutes, all free tiers)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com), region **Frankfurt (eu-central-1)**.
2. **SQL Editor** → paste all of `supabase/migrations/0001_init.sql` → Run.
3. **Authentication → URL Configuration:** set *Site URL* to your Vercel address (step 3), e.g.
   `https://movie-night-xyz.vercel.app`. Add `http://localhost:5173` under *Redirect URLs* for local testing.
4. **Project Settings → API:** note the *Project URL*, the *anon public* key and the *service_role* key.

### 2. GitHub secrets (for the nightly catalog)

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
| --- | --- |
| `TMDB_API_KEY` | Your TMDB API key or read access token |
| `SUPABASE_URL` | The Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role key (never put this in the app or in code) |

Then **Actions → Refresh catalog → Run workflow** once. It takes a few minutes and then runs every night at 03:15 UTC.
If the catalog ever shrinks by more than 20% in one night, the job fails instead of uploading, and GitHub emails you.

### 3. Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import this repo (framework: Vite, defaults are fine).
2. Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key is meant to be public).
3. Deploy. Every push to `main` redeploys automatically.

### 4. Use it

Open the site on your phone, sign in with your email, enter your first name and tap **Start a new couple**. Your partner
signs in on their phone and joins with the 6-letter code shown on the Matches tab. On iPhone: Share → *Add to Home
Screen*; on Android: menu → *Install app*.

## Local development

```bash
cp .env.example .env   # fill in the Supabase URL and anon key
npm install
npm run dev
```

## Data and licences

Titles, ratings and posters come from [TMDB](https://www.themoviedb.org); streaming availability comes from JustWatch via
TMDB. Both are free for **non-commercial** use with attribution (shown in the app footer). Charging money or showing ads
needs a commercial licence from TMDB and a data agreement with JustWatch. IMDb and Rotten Tomatoes scores are not used,
as they cannot be republished.

Votes from the old claude.ai version are not carried over: titles now use TMDB ids.
