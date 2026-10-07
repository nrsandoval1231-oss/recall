import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { color, copy, minTarget, radius, space } from "@recall/design-tokens";
import type { Services } from "../services";
import { Button, text } from "../ui/kit";

/** Sign-in is the identity provider's one-time email code. We implement no password or token logic. */
export function SignInScreen({ auth }: { auth: Services["auth"] }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
      <Text style={text.title} accessibilityRole="header">{copy.appName}</Text>
      <Text style={[text.body, { marginTop: space.sm }]}>{copy.tagline}</Text>
      <View style={{ height: space.xl }} />
      {!sent ? (
        <>
          <Text style={text.muted}>Email</Text>
          <TextInput accessibilityLabel="Email address" style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
          <Button label="Email me a code" disabled={busy || !email.includes("@")} onPress={() => run(async () => { await auth.requestEmailCode(email.trim()); setSent(true); })} />
        </>
      ) : (
        <>
          <Text style={text.muted}>{copy.signInCredentialLabel} sent to {email}</Text>
          <TextInput accessibilityLabel={copy.signInCredentialLabel} style={styles.input} value={code} onChangeText={setCode} keyboardType="default" textContentType="oneTimeCode" autoComplete="one-time-code" autoCapitalize="none" autoCorrect={false} />
          <Text style={[text.muted, { marginBottom: space.sm }]}>{copy.signInLinkHint}</Text>
          <Button label={copy.signIn} disabled={busy || code.trim().length < 6} onPress={() => run(() => code.trim().startsWith("https://") ? auth.verifyEmailLink(code.trim()) : auth.verifyEmailCode(email.trim(), code.trim()))} />
          <Button kind="secondary" label="Use a different email" style={{ marginTop: space.sm }} onPress={() => { setSent(false); setCode(""); }} />
        </>
      )}
      {busy && <ActivityIndicator style={{ marginTop: space.md }} />}
      {error && <Text accessibilityRole="alert" style={{ color: color.danger, marginTop: space.md }}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: space.lg, backgroundColor: color.paper },
  input: { minHeight: minTarget, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space.md, marginVertical: space.sm, fontSize: 18, color: color.ink },
});
