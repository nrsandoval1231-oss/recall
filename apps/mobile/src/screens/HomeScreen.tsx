import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, copy, radius, space } from "@recall/design-tokens";
import type { RecentRow } from "../viewmodel";
import { Button, StatusPill, text } from "../ui/kit";
import { Pressable } from "react-native";

export function HomeScreen({ rows, refreshing, onRefresh, onScan, onOpen, onRetry, onSignOut, banner }: {
  rows: RecentRow[]; refreshing: boolean; onRefresh: () => void; onScan: () => void; onOpen: (row: RecentRow) => void; onRetry: (row: RecentRow) => void; onSignOut: () => void; banner: string | null;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={text.title} accessibilityRole="header">{copy.appName}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.signOut} onPress={onSignOut} hitSlop={12} style={{ minHeight: 48, justifyContent: "center" }}>
          <Text style={text.muted}>{copy.signOut}</Text>
        </Pressable>
      </View>
      <Text style={[text.body, { marginBottom: space.lg }]}>{copy.tagline}</Text>
      <Button label={copy.scan} onPress={onScan} hint="Photograph or import pages" style={{ minHeight: 72 }} />
      {banner && <Text accessibilityRole="alert" style={[text.muted, { marginTop: space.md }]}>{banner}</Text>}
      <Text style={[text.heading, { marginTop: space.xl, marginBottom: space.sm }]} accessibilityRole="header">{copy.recent}</Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={text.muted}>{copy.emptyRecent}</Text>}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${copy.pagesLabel(item.pages)}, ${item.statusLabel}`} onPress={() => onOpen(item)} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={text.body} numberOfLines={1}>{item.title}</Text>
              <Text style={text.muted}>{copy.pagesLabel(item.pages)} · {new Date(item.capturedAt).toLocaleString()}</Text>
              <View style={{ height: space.xs }} />
              <StatusPill status={item.status} />
              <Text style={[text.muted, { marginTop: space.xs }]}>{item.statusDetail}</Text>
            </View>
            {item.retryable && <Button kind="secondary" label="Retry" onPress={() => onRetry(item)} style={{ marginLeft: space.sm }} />}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper, paddingHorizontal: space.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.sm },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, minHeight: 72 },
});
