import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./supabase";
import Login from "./Login";
import Pair from "./Pair";
import Picker from "./Picker";

export interface Member { user_id: string; couple_id: string; name: string }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<Member | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  async function loadMember() {
    if (!uid) { setMember(null); return; }
    const { data } = await supabase.from("members").select("user_id, couple_id, name").eq("user_id", uid).maybeSingle();
    setMember(data);
  }
  useEffect(() => { loadMember(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!configured) {
    return <Shell><div className="empty"><h2>Not set up yet</h2>
      <p>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).</p></div></Shell>;
  }
  if (session === undefined || (session && member === undefined)) return <Shell><p className="section-note">Loading…</p></Shell>;
  if (!session) return <Shell><Login /></Shell>;
  if (!member) return <Shell><Pair onDone={loadMember} /></Shell>;
  return <Picker me={member} />;
}

export function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="app">
      <header>
        <h1><span className="bulbs">● ● ● ● ●</span>Movie Night</h1>
        {right}
      </header>
      {children}
    </div>
  );
}
