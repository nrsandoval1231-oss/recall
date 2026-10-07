import { useState } from "react";
import { copy } from "@recall/design-tokens";
import type { RecallAuth } from "@recall/api-client";

export function SignIn({ auth }: { auth: Pick<RecallAuth, "requestEmailCode" | "verifyEmailCode" | "verifyEmailLink"> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [credentialVisible, setCredentialVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try {
      await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setError(/rate limit|too many|429|quota/i.test(message) ? copy.signInRateLimit : message);
    } finally { setBusy(false); }
  };
  return (
    <main className="signin">
      <h1>{copy.appName}</h1>
      <p>{copy.tagline}</p>
      {!credentialVisible ? (
        <>
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await auth.requestEmailCode(email.trim()); setCredentialVisible(true); }); }}>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <button type="submit" className="primary" disabled={busy}>{copy.requestSignInLink}</button>
          </form>
          <button type="button" onClick={() => setCredentialVisible(true)}>{copy.useExistingSignInCredential}</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => code.trim().startsWith("https://") ? auth.verifyEmailLink(code.trim()) : auth.verifyEmailCode(email.trim(), code.trim())); }}>
          <label>Email (required for a code)<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{copy.signInCredentialLabel}{email ? ` for ${email}` : ""}<input inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
          <p>{copy.signInLinkHint}</p>
          <button type="submit" className="primary" disabled={busy || (!code.trim().startsWith("https://") && (!email.includes("@") || code.trim().length < 6))}>{copy.signIn}</button>
          <button type="button" onClick={() => { setCredentialVisible(false); setCode(""); }}>{copy.useExistingSignInCredential}</button>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
