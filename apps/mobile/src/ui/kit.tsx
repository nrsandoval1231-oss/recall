import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { color, font, minTarget, radius, space, statusPresentation, toneColor, type CaptureStatusKey } from "@recall/design-tokens";

export function Button({ label, onPress, kind = "primary", disabled, style, hint }: { label: string; onPress: () => void; kind?: "primary" | "secondary" | "danger"; disabled?: boolean; style?: ViewStyle; hint?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, kind === "primary" && styles.primary, kind === "secondary" && styles.secondary, kind === "danger" && styles.danger, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.8 }, style]}
    >
      <Text style={[styles.buttonText, kind === "secondary" && { color: color.ink }, kind === "danger" && { color: color.danger }]}>{label}</Text>
    </Pressable>
  );
}

/** Status is always words + a glyph, never color alone. */
export function StatusPill({ status, label }: { status: CaptureStatusKey; label?: string }) {
  const p = statusPresentation[status];
  const tint = toneColor[p.tone];
  return (
    <View style={[styles.pill, { borderColor: tint }]} accessible accessibilityLabel={`Status: ${label ?? p.label}`}>
      <Text style={{ color: tint, fontSize: font.small, fontWeight: "700" }}>{p.glyph} {label ?? p.label}</Text>
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export const text = StyleSheet.create({
  title: { fontSize: font.title, fontWeight: "700", color: color.ink },
  heading: { fontSize: font.heading, fontWeight: "700", color: color.ink },
  body: { fontSize: font.body, color: color.ink },
  muted: { fontSize: font.small, color: color.inkMuted },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper, paddingHorizontal: space.md },
  button: { minHeight: minTarget + 8, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  danger: { backgroundColor: color.paper, borderWidth: 1, borderColor: color.danger },
  buttonText: { color: color.accentText, fontSize: font.body, fontWeight: "700" },
  pill: { alignSelf: "flex-start", borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: space.sm + 2, paddingVertical: space.xs + 1 },
});
