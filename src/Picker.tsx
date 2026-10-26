import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";
import { GENRES, PROV, hash, loadCatalog, posterBg, posterUrl } from "./catalog";
import type { Catalog, Kind, Provider, Title } from "./catalog";
import { Shell } from "./App";
import type { Member } from "./App";

type Vote = "like" | "dislike";
interface VoteRow { user_id: string; title_id: string; vote: Vote; at: string }
interface SeenRow { title_id: string; by_user: string | null; at: string }
type Tab = "pick" | "matches" | "seen";
interface Undo { id: string; kind: Vote | "seen"; prev: Vote | null }

function lsGet<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

// PostgREST returns at most 1000 rows per request, so read in pages.
async function selectAll<T>(table: string, cols: string, coupleId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).eq("couple_id", coupleId).range(from, from + 999);
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export default function Picker({ me }: { me: Member }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [members, setMembers] = useState<Member[]>([me]);
  const [inviteCode, setInviteCode] = useState("");
  const [votes, setVotes] = useState<Map<string, VoteRow>>(new Map()); // key: user_id + "|" + title_id
  const [seen, setSeen] = useState<Map<string, SeenRow>>(new Map());
  const [tab, setTab] = useState<Tab>("pick");
  const [type, setType] = useState<Kind>(() => lsGet("mn.type", "m"));
  const [provs, setProvs] = useState<Provider[]>(() => lsGet("mn.provs", ["n", "p", "d"]));
  const [genre, setGenre] = useState<string>(() => lsGet("mn.genre", "all"));
  const [history, setHistory] = useState<Undo[]>([]);
  const [toast, setToast] = useState<{ msg: string; match?: boolean } | null>(null);
  const toastTimer = useRef<number>(0);

  function showToast(msg: string, match = false) {
    setToast({ msg, match });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => { loadCatalog().then(setCatalog, () => setCatalogError(true)); }, []);

  // Initial data, then live updates from the partner's phone.
  useEffect(() => {
    const cid = me.couple_id;
    const key = (r: { user_id: string; title_id: string }) => r.user_id + "|" + r.title_id;
    (async () => {
      const [m, v, s, c] = await Promise.all([
        supabase.from("members").select("user_id, couple_id, name").eq("couple_id", cid),
        selectAll<VoteRow>("votes", "user_id, title_id, vote, at", cid),
        selectAll<SeenRow>("seen", "title_id, by_user, at", cid),
        supabase.from("couples").select("invite_code").eq("id", cid).single(),
      ]);
      if (m.data) setMembers(m.data);
      setVotes(new Map(v.map(r => [key(r), r])));
      setSeen(new Map(s.map(r => [r.title_id, r])));
      if (c.data) setInviteCode(c.data.invite_code);
    })().catch(() => showToast("Couldn't load your picks. Check your connection."));

    const ch = supabase.channel("couple-" + cid)
      .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `couple_id=eq.${cid}` }, p => {
        setVotes(prev => {
          const next = new Map(prev);
          if (p.eventType === "DELETE") next.delete(key(p.old as VoteRow));
          else next.set(key(p.new as VoteRow), p.new as VoteRow);
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "seen", filter: `couple_id=eq.${cid}` }, p => {
        setSeen(prev => {
          const next = new Map(prev);
          if (p.eventType === "DELETE") next.delete((p.old as SeenRow).title_id);
          else next.set((p.new as SeenRow).title_id, p.new as SeenRow);
          return next;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "members", filter: `couple_id=eq.${cid}` }, p => {
        setMembers(prev => prev.some(x => x.user_id === (p.new as Member).user_id) ? prev : [...prev, p.new as Member]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me.couple_id]);

  const partner = members.find(m => m.user_id !== me.user_id);
  const partnerName = partner?.name || "Your partner";
  const myVote = (id: string) => votes.get(me.user_id + "|" + id)?.vote ?? null;
  const partnerLikes = (id: string) => !!partner && votes.get(partner.user_id + "|" + id)?.vote === "like";

  const genreRe = GENRES.find(g => g.key === genre)?.re ?? null;
  const filterOk = (t: Title) => t.type === type && t.provs.some(p => provs.includes(p)) && (!genreRe || genreRe.test(t.genres));

  const queue = useMemo(() => {
    if (!catalog) return [];
    // Titles the partner already liked come first, so matches show up sooner. The rest go best-rated first,
    // with a small per-person shuffle so you don't both see exactly the same order.
    return catalog.titles
      .filter(t => filterOk(t) && !seen.has(t.id) && !myVote(t.id))
      .map(t => ({ t, pl: partnerLikes(t.id), r: t.rank + hash(me.user_id + t.id) / 4294967296 * 0.9 }))
      .sort((a, b) => Number(b.pl) - Number(a.pl) || b.r - a.r)
      .map(x => x.t);
  }, [catalog, votes, seen, type, provs, genre, partner]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    if (!catalog || !partner) return [];
    return [...votes.values()]
      .filter(v => v.user_id === me.user_id && v.vote === "like" && partnerLikes(v.title_id) && !seen.has(v.title_id))
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(v => catalog.byId.get(v.title_id))
      .filter((t): t is Title => !!t);
  }, [catalog, votes, seen, partner]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optimistic: update the screen first, roll back if the write fails.
  async function setMyVote(id: string, vote: Vote | null) {
    const k = me.user_id + "|" + id;
    const before = votes.get(k);
    setVotes(prev => {
      const next = new Map(prev);
      if (vote) next.set(k, { user_id: me.user_id, title_id: id, vote, at: new Date().toISOString() }); else next.delete(k);
      return next;
    });
    const { error } = vote
      ? await supabase.from("votes").upsert({ user_id: me.user_id, couple_id: me.couple_id, title_id: id, vote, at: new Date().toISOString() })
      : await supabase.from("votes").delete().eq("user_id", me.user_id).eq("title_id", id);
    if (error) {
      setVotes(prev => { const next = new Map(prev); if (before) next.set(k, before); else next.delete(k); return next; });
      showToast("Couldn't save that. Check your connection.");
    }
  }

  async function markSeen(id: string, on: boolean) {
    const before = seen.get(id);
    setSeen(prev => {
      const next = new Map(prev);
      if (on) next.set(id, { title_id: id, by_user: me.user_id, at: new Date().toISOString() }); else next.delete(id);
      return next;
    });
    const { error } = on
      ? await supabase.from("seen").upsert({ couple_id: me.couple_id, title_id: id, by_user: me.user_id })
      : await supabase.from("seen").delete().eq("couple_id", me.couple_id).eq("title_id", id);
    if (error) {
      setSeen(prev => { const next = new Map(prev); if (before) next.set(id, before); else next.delete(id); return next; });
      showToast("Couldn't save that. Check your connection.");
    }
  }

  function verdict(kind: Vote | "seen", t: Title) {
    setHistory(h => [...h.slice(-29), { id: t.id, kind, prev: myVote(t.id) }]);
    if (kind === "seen") { markSeen(t.id, true); showToast("Marked as seen. It won't come back."); return; }
    setMyVote(t.id, kind);
    if (kind === "like" && partnerLikes(t.id)) showToast("It's a match! " + t.title, true);
  }

  function undo() {
    const h = history[history.length - 1]; if (!h) return;
    setHistory(history.slice(0, -1));
    if (h.kind === "seen") markSeen(h.id, false); else setMyVote(h.id, h.prev);
  }

  const current = tab === "pick" ? queue[0] : undefined;
  useEffect(() => {
    // Preload the next few posters so the card is ready when it shows.
    for (const t of queue.slice(1, 5)) if (t.poster) new Image().src = posterUrl(t);
  }, [queue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current || (e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key === "ArrowRight") verdict("like", current);
      else if (e.key === "ArrowLeft") verdict("dislike", current);
      else if (e.key === "ArrowDown") { e.preventDefault(); verdict("seen", current); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "z") undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function toggleProv(p: Provider) {
    const on = provs.includes(p);
    if (on && provs.length === 1) { showToast("Keep at least one service on."); return; }
    const next = on ? provs.filter(x => x !== p) : [...provs, p];
    setProvs(next); lsSet("mn.provs", next);
  }

  const seenList = catalog
    ? [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map(s => catalog.byId.get(s.title_id)).filter((t): t is Title => !!t)
    : [];
  const visibleMatches = matches.filter(filterOk);

  // "Pick for tonight": a short shuffle through the matches, then one stays. Uses the current filters,
  // so switching to Series or one service narrows the draw.
  const [tonight, setTonight] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const rollTimer = useRef<number>(0);
  useEffect(() => () => clearInterval(rollTimer.current), []);
  function pickTonight() {
    const pool = visibleMatches.length > 1 ? visibleMatches.filter(t => t.id !== tonight) : visibleMatches;
    if (!pool.length) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ticks = reduced || pool.length === 1 ? 0 : 10;
    setRolling(ticks > 0);
    clearInterval(rollTimer.current);
    const land = () => { setTonight(pool[Math.floor(Math.random() * pool.length)].id); setRolling(false); };
    if (!ticks) { land(); return; }
    rollTimer.current = window.setInterval(() => {
      setTonight(pool[Math.floor(Math.random() * pool.length)].id);
      if (--ticks <= 0) { clearInterval(rollTimer.current); land(); }
    }, 80);
  }
  const tonightTitle = tonight ? visibleMatches.find(t => t.id === tonight) : undefined;

  const who = (
    <div className="who">
      <span>{partner ? `${me.name || "You"} & ${partnerName}` : "Just you so far"}</span>
      <button className="linkbtn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );

  return (
    <Shell right={who}>
      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "pick"} onClick={() => setTab("pick")}>Pick</button>
        <button role="tab" aria-selected={tab === "matches"} onClick={() => setTab("matches")}>
          Matches <span className={"count" + (matches.length ? "" : " zero")}>{matches.length}</span></button>
        <button role="tab" aria-selected={tab === "seen"} onClick={() => setTab("seen")}>
          Seen <span className={"count" + (seenList.length ? "" : " zero")}>{seenList.length}</span></button>
      </nav>

      <div className="filters">
        <div className="row">
          <div className="seg" role="group" aria-label="Type">
            <button aria-pressed={type === "m"} onClick={() => { setType("m"); lsSet("mn.type", "m"); }}>Movies</button>
            <button aria-pressed={type === "s"} onClick={() => { setType("s"); lsSet("mn.type", "s"); }}>Series</button>
          </div>
        </div>
        <div className="row">
          {(Object.keys(PROV) as Provider[]).map(p => (
            <button key={p} className="chip" style={{ "--pc": PROV[p].color } as React.CSSProperties}
              aria-pressed={provs.includes(p)} onClick={() => toggleProv(p)}>
              <span className="dot" />{PROV[p].name}
            </button>
          ))}
        </div>
        <div className="genres" role="group" aria-label="Genre">
          {GENRES.map(g => (
            <button key={g.key} className="gchip" aria-pressed={genre === g.key}
              onClick={() => { setGenre(g.key); lsSet("mn.genre", g.key); }}>{g.name}</button>
          ))}
        </div>
      </div>

      <main>
        {tab === "pick" && (
          catalogError ? <Empty title="Catalog missing" text="The title list hasn't been loaded yet. Run the catalog job once (see README)." />
          : !catalog ? <Empty title="Loading titles" text="Fetching everything on Netflix, Prime Video and Disney+." />
          : !current ? <Empty title="That's the lot" text={`You've judged every ${genre !== "all" ? GENRES.find(g => g.key === genre)!.name.toLowerCase() + " " : ""}${type === "m" ? "movie" : "series"} on these services. Try another filter.`} />
          : <>
              <Card key={current.id} t={current} partnerLiked={partnerLikes(current.id) ? partnerName : null} onVerdict={k => verdict(k, current)} />
              <div className="under">
                <span>{queue.length.toLocaleString("en")} left to judge</span>
                <button className="linkbtn" onClick={undo} disabled={!history.length}>Undo</button>
              </div>
            </>
        )}

        {tab === "matches" && (
          !partner ? <Empty title="Waiting for your partner"
              text={`Matches appear when you both like the same title. Your partner signs in on their own phone and joins with code ${inviteCode || "…"}.`} />
          : !visibleMatches.length ? <Empty title="No matches yet"
              text={matches.length ? `You have ${matches.length} match${matches.length > 1 ? "es" : ""} under other filters.` : "Keep liking titles. Anything you both like lands here."} />
          : <>
              {tonightTitle ? (
                <div className={"tonight" + (rolling ? " rolling" : "")} aria-live="polite">
                  <span className="tonight-label">{rolling ? "Picking…" : "Tonight's pick"}</span>
                  <div className="tonight-body">
                    {tonightTitle.poster
                      ? <img className="tonight-cover" src={posterUrl(tonightTitle, "w185")} alt="" />
                      : <div className="tonight-cover" style={{ background: posterBg(tonightTitle) }} />}
                    <div className="tonight-text">
                      <h2>{tonightTitle.title}</h2>
                      <div className="s">{[tonightTitle.year, tonightTitle.provs.map(p => PROV[p].name).join(", ")].filter(Boolean).join(" · ")}</div>
                      {!rolling && <p>{tonightTitle.overview}</p>}
                    </div>
                  </div>
                  {!rolling && (
                    <div className="row">
                      {visibleMatches.length > 1 && <button className="primary ghost" onClick={pickTonight}>Pick again</button>}
                      <button className="primary" onClick={() => { const id = tonightTitle.id; setTonight(null); markSeen(id, true).then(() => showToast("Enjoy! Moved to Seen.")); }}>We watched it</button>
                    </div>
                  )}
                </div>
              ) : (
                <button className="primary pick-btn" onClick={pickTonight}>🎲 Pick one for tonight</button>
              )}
              <p className="section-note">You both liked these. Tap Watched after movie night and it moves to Seen.</p>
              <div className="list">{visibleMatches.map(t => (
                <Item key={t.id} t={t} sub={[t.year, t.provs.map(p => PROV[p].name).join(", "), t.votes >= 10 ? "TMDB " + t.rating.toFixed(1) : ""].filter(Boolean).join(" · ")}>
                  <button className="go" onClick={() => markSeen(t.id, true).then(() => showToast("Moved to Seen."))}>Watched</button>
                </Item>))}
              </div>
            </>
        )}

        {tab === "seen" && (
          !seenList.length ? <Empty title="Nothing seen yet" text="Hit “Seen it” on any title and it lands here for both of you, and never shows up again." />
          : <>
              <p className="section-note">{seenList.length} title{seenList.length > 1 ? "s" : ""} you've seen, shared between you. Put one back if you tapped it by mistake.</p>
              <div className="list">{seenList.map(t => (
                <Item key={t.id} t={t} sub={`${t.type === "m" ? "Movie" : "Series"} · ${t.year} · ${t.provs.map(p => PROV[p].name).join(", ")}`}>
                  <button onClick={() => markSeen(t.id, false)}>Put back</button>
                </Item>))}
              </div>
            </>
        )}
      </main>

      <footer>
        {catalog && `${catalog.titles.length.toLocaleString("en")} titles on Netflix, Prime Video and Disney+ in Germany, updated ${catalog.date}. `}
        Data and posters from TMDB; streaming availability by JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
      {toast && <div className={"toast" + (toast.match ? " match-burst" : "")}>{toast.msg}</div>}
    </Shell>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><h2>{title}</h2><p>{text}</p></div>;
}

const ICON = {
  nope: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  seen: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /><path d="M9.5 12l1.8 1.8L15 10" /></svg>,
  like: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z" /></svg>,
};

function Card({ t, partnerLiked, onVerdict }: { t: Title; partnerLiked: string | null; onVerdict: (k: Vote | "seen") => void }) {
  const art = posterUrl(t);
  const tmdbLink = `https://www.themoviedb.org/${t.type === "s" ? "tv" : "movie"}/${t.id.slice(1)}`;
  return (
    <article className="card enter">
      <div className={"poster" + (art ? " has-art" : "")} style={{ "--poster": posterBg(t) } as React.CSSProperties}>
        {art && <div className="art-bg" style={{ backgroundImage: `url(${art})` }} aria-hidden="true" />}
        {art && <img className="cover" src={art} alt={"Poster for " + t.title} />}
        <div className="ptext">
          <div className="badges">{t.provs.map(p => (
            <span key={p} className="pbadge" style={{ "--pc": PROV[p].color } as React.CSSProperties}>{PROV[p].name}</span>))}
          </div>
          {partnerLiked && <div className="partner-liked">{partnerLiked} liked this</div>}
          <h2 className="ptitle">{t.title}</h2>
          <div className="meta">{[t.year, t.genres].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="scores">
        <a className="score tmdb" href={tmdbLink} target="_blank" rel="noopener">
          <span className="lbl">TMDB</span>
          {t.votes >= 10 ? <><b>{t.rating.toFixed(1)}</b>/10 <span className="votes">{t.votes.toLocaleString("en")} votes</span></>
            : <span className="na">few ratings</span>}
        </a>
      </div>
      <p className="blurb">{t.overview || "No description yet."}</p>
      <div className="verdict">
        <button className="b-nope" onClick={() => onVerdict("dislike")}>{ICON.nope}Don't like<kbd>←</kbd></button>
        <button className="b-seen" onClick={() => onVerdict("seen")}>{ICON.seen}Seen it<kbd>↓</kbd></button>
        <button className="b-like" onClick={() => onVerdict("like")}>{ICON.like}Like<kbd>→</kbd></button>
      </div>
    </article>
  );
}

function Item({ t, sub, children }: { t: Title; sub: string; children: React.ReactNode }) {
  const art = posterUrl(t, "w185");
  return (
    <div className="item">
      {art ? <img className="thumb art" src={art} alt="" loading="lazy" />
        : <div className="thumb" style={{ "--poster": posterBg(t) } as React.CSSProperties}>{t.title.replace(/^the /i, "").charAt(0)}</div>}
      <div className="info"><div className="t">{t.title}</div><div className="s">{sub}</div></div>
      {children}
    </div>
  );
}
