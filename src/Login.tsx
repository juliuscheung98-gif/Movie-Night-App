import { useState } from "react";
import { supabase } from "./supabase";

// Supabase puts a failed sign-in link's reason in the URL hash, e.g. #error_code=otp_expired.
function linkError() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.get("error")) return "";
  history.replaceState(null, "", location.pathname);
  return p.get("error_code") === "otp_expired"
    ? "That sign-in link was already used or has expired. Request a new one, or type the code from the email."
    : p.get("error_description") || "Sign-in failed. Try again.";
}

// Passwordless: Supabase emails a code (and a link). Typing the code works even when the app runs from the home
// screen, where tapping the link would open the browser instead.
export default function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [error, setError] = useState(linkError);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending"); setError("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin } });
    if (error) { setError(error.message); setState("idle"); } else setState("sent");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setState("verifying"); setError("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    // On success the auth listener in App switches screens.
    if (error) { setError(error.message); setState("sent"); }
  }

  if (state === "sent" || state === "verifying") {
    return (
      <form className="empty" onSubmit={verify}>
        <h2>Check your email</h2>
        <p>We sent a code to {email}. Type it here.</p>
        <input className="field code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={8}
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} />
        <button className="primary" disabled={state === "verifying" || code.length < 6}>
          {state === "verifying" ? "Checking…" : "Sign in"}</button>
        {error && <p className="error">{error}</p>}
        <button type="button" className="linkbtn" onClick={() => { setState("idle"); setCode(""); setError(""); }}>Use another email</button>
      </form>
    );
  }
  return (
    <form className="empty" onSubmit={send}>
      <h2>Sign in</h2>
      <p>Swipe movies and series on your own phone. Anything you both like becomes a match.</p>
      <input className="field" type="email" required placeholder="you@example.com" autoComplete="email"
        value={email} onChange={e => setEmail(e.target.value)} />
      <button className="primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in code"}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
