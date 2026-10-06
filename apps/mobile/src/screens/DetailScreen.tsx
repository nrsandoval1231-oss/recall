import { useEffect, useState } from "react";
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Crypto from "expo-crypto";
import { color, copy, space } from "@recall/design-tokens";
import type { MemoryDetail, ServerCapture } from "@recall/api-client";
import type { LocalCapture } from "@recall/sync";
import type { Services } from "../services";
import { Button, StatusPill, text } from "../ui/kit";
import type { RecentRow } from "../viewmodel";

const width = Dimensions.get("window").width;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

interface PageView { key: string; ordinal: number; sha256: string; uri: string; headers?: Record<string, string>; sourceId?: string; origin: "device" | "cloud" }

/** Shows the ORIGINAL pages: this device's saved copy when present, otherwise the cloud original via authenticated API. */
export function DetailScreen({ services, row, onBack, initialSourceId }: { services: Services; row: RecentRow; onBack: () => void; initialSourceId?: string | null }) {
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [pages, setPages] = useState<PageView[]>([]);
  const [index, setIndex] = useState(0);
  const [verify, setVerify] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (row.localId) {
          const local: LocalCapture = await services.syncer.store.read(row.localId);
          if (initialSourceId) setIndex(Math.max(0, local.pages.findIndex((p) => p.sourceId === initialSourceId)));
          setPages(local.pages.map((p) => ({ key: p.clientPageId, ordinal: p.ordinal, sha256: p.sha256, uri: services.syncer.store.pageUri(local, p), sourceId: p.sourceId, origin: "device" as const })));
        } else if (row.serverId) {
          const server: ServerCapture = await services.api.getCapture(row.serverId);
          const headers = await services.api.authHeaders();
          if (initialSourceId) setIndex(Math.max(0, server.pages.findIndex((p) => p.source_id === initialSourceId)));
          setPages(server.pages.map((p) => ({ key: p.source_id, ordinal: p.ordinal, sha256: p.server_sha256 ?? p.declared_sha256, uri: services.api.sourceRequest(p.source_id).url, headers, sourceId: p.source_id, origin: "cloud" as const })));
        }
        if (row.memoryId) setMemory(await services.api.getMemory(row.memoryId));
      } catch {
        setError("Couldn't open this capture right now.");
      }
    })();
  }, [row.localId, row.serverId, row.memoryId, services, initialSourceId]);

  const retryReading = async () => {
    if (!row.serverId) return;
    try {
      await services.api.retryProcessing(row.serverId, `retry-${row.serverId}-${Date.now()}`);
      setRetryNote("Queued to be read again.");
    } catch {
      setRetryNote("Couldn't queue a retry right now.");
    }
  };
  const pageReading = memory?.interpretation.pages.find((p) => p.page_id === current?.sourceId);
  const unclear = memory?.interpretation.statements.filter((s) => s.epistemic_state !== "reported" && s.evidence.some((e) => e.page_id === current?.sourceId)) ?? [];

  const current = pages[index] as PageView | undefined;

  /** Download the cloud original and compare its SHA-256 with the stored value. */
  const verifyCloud = async () => {
    if (!current?.sourceId) return setVerify("This page isn't in the cloud yet.");
    setVerify("Checking…");
    try {
      const got = await services.api.fetchSource(current.sourceId);
      const actual = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, got.bytes));
      setVerify(actual === current.sha256 && actual === got.serverSha256 ? "✓ Cloud original matches exactly (SHA-256)." : "✗ Cloud original does NOT match. Do not rely on it.");
    } catch {
      setVerify("Couldn't reach the cloud to verify.");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ minHeight: 48, justifyContent: "center" }}><Text style={text.body}>‹ Back</Text></Pressable>
        <Text style={text.muted}>{pages.length > 0 ? `Page ${index + 1} of ${pages.length}` : ""}</Text>
      </View>
      <Text style={text.heading} numberOfLines={2}>{row.title}</Text>
      <View style={{ marginVertical: space.sm }}><StatusPill status={row.status} /></View>
      {error && <Text accessibilityRole="alert" style={{ color: color.danger }}>{error}</Text>}
      <FlatList
        horizontal
        pagingEnabled
        data={pages}
        keyExtractor={(p) => p.key}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / (width - space.md * 2)))}
        style={{ flexGrow: 0 }}
        renderItem={({ item }) => (
          <Image source={{ uri: item.uri, headers: item.headers }} style={{ width: width - space.md * 2, height: 420 }} contentFit="contain" accessibilityLabel={`Original page ${item.ordinal}`} />
        )}
      />
      {current && (
        <View style={{ marginTop: space.md }}>
          <Text style={text.muted}>Showing the {current.origin === "device" ? "copy saved on this device" : "original stored in the cloud"}.</Text>
          <Text style={text.muted} selectable>SHA-256 {current.sha256.slice(0, 16)}…</Text>
          {row.serverId && <Button kind="secondary" label="Verify cloud original" onPress={verifyCloud} style={{ marginTop: space.sm }} />}
          {verify && <Text style={[text.body, { marginTop: space.sm }]} accessibilityLiveRegion="polite">{verify}</Text>}
          {pages.length === 0 && <Text style={text.muted}>{copy.emptyRecent}</Text>}
        </View>
      )}
      {row.processingRetryAvailable && <Button kind="secondary" label="Try reading again" onPress={() => void retryReading()} style={{ marginTop: space.sm }} />}
      {retryNote && <Text style={text.muted}>{retryNote}</Text>}
      {memory && (
        <View style={{ marginTop: space.md }} accessibilityLabel="Machine reading">
          {memory.interpretation.summary && <Text style={text.body}>{memory.interpretation.summary}</Text>}
          <Text style={[text.muted, { marginTop: space.sm }]}>{memory.labels.transcription}</Text>
          {pageReading && <Text style={[text.body, { marginTop: space.xs }]} selectable>{pageReading.transcription || "(nothing readable)"}</Text>}
          {unclear.map((s) => <Text key={s.local_id} style={[text.muted, { marginTop: space.xs }]}>? {s.text} ({s.epistemic_state})</Text>)}
          {memory.validation_notes.length > 0 && <Text style={[text.muted, { marginTop: space.xs }]}>{memory.validation_notes.length} thing(s) Recall couldn't confirm against the page.</Text>}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper, paddingHorizontal: space.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
