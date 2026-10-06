import { useState } from "react";
import { copy } from "@recall/design-tokens";
import type { RecallAuth } from "@recall/api-client";

export function SignIn({ auth }: { auth: Pick<RecallAuth, "requestEmailCode" | "verifyEmailCode"> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <main className="signin">
      <h1>{copy.appName}</h1>
      <p>{copy.tagline}</p>
      {!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await auth.requestEmailCode(email.trim()); setSent(true); }); }}>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <button type="submit" className="primary" disabled={busy}>Email me a code</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => auth.verifyEmailCode(email.trim(), code.trim())); }}>
          <label>Code sent to {email}<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
          <button type="submit" className="primary" disabled={busy}>{copy.signIn}</button>
          <button type="button" onClick={() => { setSent(false); setCode(""); }}>Use a different email</button>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
