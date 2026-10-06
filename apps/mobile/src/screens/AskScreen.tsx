import { useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, copy, minTarget, radius, space } from "@recall/design-tokens";
import type { AskResponse, Citation } from "@recall/api-client";
import type { Services } from "../services";
import { Button, text } from "../ui/kit";

/** Ask what you remember. answered / ambiguous / insufficient_evidence / unavailable each look different. */
export function AskScreen({ services, initial, onBack, onOpen }: { services: Services; initial: string; onBack: () => void; onOpen: (c: Citation) => void }) {
  const [question, setQuestion] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await services.api.ask(question.trim()));
    } catch {
      setError("Couldn't reach Recall to answer. Your captures are unaffected.");
    } finally {
      setBusy(false);
    }
  };

  const lead = result ? { answered: null, ambiguous: copy.ambiguous, insufficient_evidence: copy.insufficient, unavailable: copy.unavailable }[result.status] : null;
  const byId = new Map((result?.citations ?? []).map((c) => [c.citation_id, c]));
  const list = result ? (result.status === "answered" ? result.citations : result.sources) : [];

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ minHeight: minTarget, justifyContent: "center" }}><Text style={text.body}>‹ Back</Text></Pressable>
        <TextInput accessibilityLabel={copy.askPlaceholder} placeholder={copy.askPlaceholder} placeholderTextColor={color.inkMuted} style={styles.input} value={question} onChangeText={setQuestion} onSubmitEditing={() => void ask()} returnKeyType="search" maxLength={1000} autoFocus={!initial} />
        <Button label={copy.ask} onPress={() => void ask()} disabled={busy || !question.trim()} />
        {busy && <ActivityIndicator style={{ marginTop: space.md }} />}
        {error && <Text accessibilityRole="alert" style={{ color: color.danger, marginTop: space.md }}>{error}</Text>}
        {result && (
          <View style={[styles.answer, result.status !== "answered" && styles.answerMuted]} accessibilityLiveRegion="polite">
            {lead && <Text style={text.body}>{lead}</Text>}
            {(result.status === "answered" || result.status === "ambiguous") && result.sentences.map((s, i) => (
              <Text key={i} style={[text.body, { marginTop: space.xs }]}>
                {s.text} {s.citation_ids.map((cid) => (byId.get(cid)?.page ? `[p.${byId.get(cid)?.page}]` : "[source]")).join(" ")}
              </Text>
            ))}
            {result.limitations.map((l, i) => <Text key={i} style={[text.muted, { marginTop: space.xs }]}>{l}</Text>)}
          </View>
        )}
        <FlatList
          data={list}
          keyExtractor={(c) => c.citation_id}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          style={{ marginTop: space.md }}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open original: ${item.quote}`} onPress={() => onOpen(item)} style={styles.source}>
              <Text style={text.body} numberOfLines={3}>“{item.quote}”</Text>
              <Text style={text.muted}>
                {new Date(item.captured_at).toLocaleDateString()}{item.page ? ` · page ${item.page}` : ""}{item.epistemic_state && item.epistemic_state !== "reported" ? ` · ${item.epistemic_state}` : ""} · Open original ›
              </Text>
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper, paddingHorizontal: space.md },
  input: { minHeight: minTarget + 8, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, marginBottom: space.sm, fontSize: 18, color: color.ink },
  answer: { marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface },
  answerMuted: { backgroundColor: color.paper, borderWidth: 1, borderColor: color.border, borderStyle: "dashed" },
  source: { padding: space.md, borderRadius: radius.md, backgroundColor: color.surface, minHeight: 64 },
});
