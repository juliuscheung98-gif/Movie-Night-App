import { useState } from "react";
import { supabase } from "./supabase";

// Passwordless: Supabase emails a sign-in link that comes back to this page.
export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) { setError(error.message); setState("error"); } else setState("sent");
  }

  if (state === "sent") {
    return <div className="empty"><h2>Check your email</h2>
      <p>We sent a sign-in link to {email}. Open it on this device.</p></div>;
  }
  return (
    <form className="empty" onSubmit={send}>
      <h2>Sign in</h2>
      <p>Swipe movies and series on your own phone. Anything you both like becomes a match.</p>
      <input className="field" type="email" required placeholder="you@example.com" autoComplete="email"
        value={email} onChange={e => setEmail(e.target.value)} />
      <button className="primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
      {state === "error" && <p className="error">{error}</p>}
    </form>
  );
}
