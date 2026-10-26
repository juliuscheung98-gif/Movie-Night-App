import { useState } from "react";
import { supabase } from "./supabase";

// First visit after sign-in: one partner creates a couple and shares the code, the other joins with it.
export default function Pair({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    if (!name.trim()) { setError("Enter your first name first."); return; }
    setBusy(true); setError("");
    const { error } = await fn();
    setBusy(false);
    if (error) setError(error.message); else onDone();
  }

  return (
    <div className="empty">
      <h2>Pair up</h2>
      <p>Your first name, so your partner sees who liked what.</p>
      <input className="field" placeholder="First name" value={name} onChange={e => setName(e.target.value)} autoComplete="given-name" />
      <button className="primary" disabled={busy}
        onClick={() => run(() => supabase.rpc("create_couple", { display_name: name.trim() }))}>
        Start a new couple
      </button>
      <p>Or join your partner with their 6-letter code:</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <input className="field code" placeholder="ABC123" maxLength={6} value={code}
          onChange={e => setCode(e.target.value.toUpperCase())} />
        <button className="primary" disabled={busy || code.length !== 6}
          onClick={() => run(() => supabase.rpc("join_couple", { code, display_name: name.trim() }))}>
          Join
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="linkbtn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}
