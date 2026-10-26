import { useState } from "react";
import { supabase } from "./supabase";

// Email + password, with "Confirm email" turned off in Supabase: no emails are sent, so there are no links to
// expire and nothing breaks when the app runs from the home screen.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const creds = { email: email.trim(), password };
    const { data, error } = mode === "signin"
      ? await supabase.auth.signInWithPassword(creds)
      : await supabase.auth.signUp(creds);
    setBusy(false);
    // On success the auth listener in App switches screens.
    if (error) setError(error.message === "Invalid login credentials"
      ? "Wrong email or password. New here? Tap “Create an account” below."
      : error.message);
    else if (mode === "signup" && !data.session) {
      setError("Account created, but Supabase wants an email confirmation. Turn off “Confirm email” (see README), then sign in.");
    }
  }

  return (
    <form className="empty" onSubmit={submit}>
      <h2>{mode === "signin" ? "Sign in" : "Create an account"}</h2>
      <p>Swipe movies and series on your own phone. Anything you both like becomes a match.</p>
      <input className="field" type="email" required placeholder="you@example.com" autoComplete="email"
        value={email} onChange={e => setEmail(e.target.value)} />
      <input className="field" type="password" required minLength={6} placeholder="Password (6+ characters)"
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        value={password} onChange={e => setPassword(e.target.value)} />
      <button className="primary" disabled={busy}>
        {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      {error && <p className="error">{error}</p>}
      <button type="button" className="linkbtn" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}>
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
    </form>
  );
}
