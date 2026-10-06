import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, copy, minTarget, space } from "@recall/design-tokens";
import type { AiSettings } from "@recall/api-client";
import type { Services } from "../services";
import { Button, text } from "../ui/kit";

export function SettingsScreen({ services, onBack, onSignOut }: { services: Services; onBack: () => void; onSignOut: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { services.api.getAiSettings().then(setSettings, () => setError("Couldn't load settings.")); }, [services]);
  const toggle = async (enabled: boolean) => {
    if (!settings) return;
    try {
      setSettings(await services.api.setAiEnabled(enabled, settings.version));
    } catch {
      setError("Couldn't change the setting. Nothing was changed.");
    }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ minHeight: minTarget, justifyContent: "center" }}><Text style={text.body}>‹ Back</Text></Pressable>
      <Text style={text.title} accessibilityRole="header">{copy.settings}</Text>
      {error && <Text accessibilityRole="alert" style={{ color: color.danger }}>{error}</Text>}
      {settings && (
        <View style={{ marginTop: space.lg }}>
          <Text style={text.heading}>{copy.aiToggle}</Text>
          {!settings.ai_configured ? (
            <Text style={[text.body, { marginTop: space.sm }]}>AI reading isn't set up on this Recall server yet. Your originals are stored and viewable either way.</Text>
          ) : (
            <>
              <Text style={[text.body, { marginTop: space.sm }]}>{settings.explanation}</Text>
              {settings.consent_outdated && <Text style={[text.muted, { marginTop: space.sm }]}>What Recall sends has changed since you agreed. Please review and turn it on again.</Text>}
              <View style={styles.row}>
                <Text style={text.body}>{settings.enabled ? "On" : "Off"}</Text>
                <Switch accessibilityLabel={copy.aiToggle} value={settings.enabled} onValueChange={(v) => void toggle(v)} />
              </View>
            </>
          )}
        </View>
      )}
      <Button kind="secondary" label={copy.signOut} onPress={onSignOut} style={{ marginTop: space.xl }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper, paddingHorizontal: space.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: minTarget, marginTop: space.md },
});
