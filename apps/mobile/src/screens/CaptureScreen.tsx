import { useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import { color, copy, minTarget, radius, space } from "@recall/design-tokens";
import { addPages, movePage, removePage, retakePage, SaveError, MAX_PAGES, type DraftPage } from "@recall/sync";
import type { Services } from "../services";
import { Button, text } from "../ui/kit";

/** Draft pages are in memory only: nothing is "saved" until the user taps Save and the bytes are copied into app storage. */
export function CaptureScreen({ services, onDone, onCancel }: { services: Services; onDone: () => void; onCancel: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [draft, setDraft] = useState<DraftPage[]>([]);
  const [retakeId, setRetakeId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const add = (pages: DraftPage[]) => {
    const result = addPages(draft, pages);
    setDraft(result.draft);
    if (result.rejected > 0) setMessage(`Only ${MAX_PAGES} pages fit in one capture. ${result.rejected} not added.`);
  };

  const shoot = async () => {
    try {
      // quality 1: the camera's own JPEG, no further compression by us.
      const picture = await camera.current?.takePictureAsync({ quality: 1, exif: false });
      if (!picture) return;
      const page: DraftPage = { id: Crypto.randomUUID(), uri: picture.uri, originalFilename: null };
      if (retakeId) {
        setDraft((d) => retakePage(d, retakeId, page));
        setRetakeId(null);
      } else add([page]);
      setMessage(null);
    } catch {
      setMessage("The camera couldn't take that photo. Try again.");
    }
  };

  const importPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PAGES - draft.length,
      exif: false,
      // keep the asset as-is (may be HEIC); no transcoding of the user's original.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (result.canceled) return;
    add(result.assets.map((a) => ({ id: Crypto.randomUUID(), uri: a.uri, originalFilename: a.fileName ?? null })));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await services.syncer.store.save({ pages: draft, contextHint: hint, ownerUserId: (await services.auth.getUserId()) ?? "", deviceId: services.deviceId(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      // Only now is it durable. Upload runs in the background; its status is shown honestly on Home.
      void services.syncer.syncAllPending();
      onDone();
    } catch (e) {
      setMessage(e instanceof SaveError ? e.message : "Couldn't save on this device. Nothing was lost; try again.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (draft.length === 0) return onCancel();
    Alert.alert("Discard these photos?", "They haven't been saved yet.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onCancel },
    ]);
  };

  if (!permission) return <SafeAreaView style={styles.safe} />;
  const cameraReady = permission.granted;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={cancel} style={styles.hit}><Text style={text.body}>Cancel</Text></Pressable>
          <Text style={text.heading} accessibilityRole="header">{draft.length === 0 ? copy.scan : copy.pagesLabel(draft.length)}</Text>
          <View style={styles.hit} />
        </View>

        {cameraReady ? (
          <View style={styles.cameraBox}>
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" accessibilityLabel="Camera preview" />
            {retakeId && <Text style={styles.retakeBanner}>Retaking a page — take the new photo</Text>}
          </View>
        ) : (
          <View style={[styles.cameraBox, styles.permission]}>
            <Text style={text.body}>{permission.canAskAgain ? "Recall needs the camera to photograph pages." : "Camera access is off. You can turn it on in Settings, or import photos instead."}</Text>
            {permission.canAskAgain && <Button label="Allow camera" onPress={requestPermission} style={{ marginTop: space.md }} />}
          </View>
        )}

        <View style={styles.controls}>
          <Button kind="secondary" label="Import" onPress={importPhotos} disabled={draft.length >= MAX_PAGES} />
          <Pressable accessibilityRole="button" accessibilityLabel={retakeId ? "Take replacement photo" : "Take photo"} disabled={!cameraReady || (draft.length >= MAX_PAGES && !retakeId)} onPress={shoot} style={[styles.shutter, (!cameraReady || (draft.length >= MAX_PAGES && !retakeId)) && { opacity: 0.4 }]}>
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={{ width: 96 }} />
        </View>

        {draft.length > 0 && (
          <FlatList
            horizontal
            data={draft}
            keyExtractor={(p) => p.id}
            style={{ flexGrow: 0, marginVertical: space.sm }}
            contentContainerStyle={{ gap: space.sm }}
            renderItem={({ item, index }) => (
              <View style={[styles.thumbWrap, retakeId === item.id && { borderColor: color.accent, borderWidth: 3 }]}>
                <Image source={{ uri: item.uri }} style={styles.thumb} accessibilityLabel={`Page ${index + 1}`} contentFit="cover" />
                <View style={styles.thumbBar}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move page ${index + 1} earlier`} onPress={() => setDraft((d) => movePage(d, item.id, -1))} style={styles.mini}><Text style={styles.miniText}>◀</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${copy.retake} page ${index + 1}`} onPress={() => setRetakeId((r) => (r === item.id ? null : item.id))} style={styles.mini}><Text style={styles.miniText}>↻</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${copy.remove} page ${index + 1}`} onPress={() => { setDraft((d) => removePage(d, item.id)); if (retakeId === item.id) setRetakeId(null); }} style={styles.mini}><Text style={styles.miniText}>✕</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Move page ${index + 1} later`} onPress={() => setDraft((d) => movePage(d, item.id, 1))} style={styles.mini}><Text style={styles.miniText}>▶</Text></Pressable>
                </View>
                <Text style={styles.index}>{index + 1}</Text>
              </View>
            )}
          />
        )}

        {message && <Text accessibilityRole="alert" style={{ color: color.danger, marginBottom: space.sm }}>{message}</Text>}
        <TextInput accessibilityLabel={copy.contextHint} placeholder={copy.contextHint} placeholderTextColor={color.inkMuted} style={styles.input} value={hint} onChangeText={setHint} maxLength={2000} returnKeyType="done" />
        <Button label={copy.save} onPress={save} disabled={draft.length === 0 || saving} style={{ marginBottom: space.sm }} hint="Saves the pages on this device, then uploads them" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper, paddingHorizontal: space.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52 },
  hit: { minWidth: 72, minHeight: minTarget, justifyContent: "center" },
  cameraBox: { flex: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#000" },
  permission: { backgroundColor: color.surface, alignItems: "center", justifyContent: "center", padding: space.lg },
  retakeBanner: { position: "absolute", top: space.sm, alignSelf: "center", backgroundColor: color.accent, color: color.accentText, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.lg, overflow: "hidden" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space.sm },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: color.ink, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.ink },
  thumbWrap: { width: 104, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, overflow: "hidden", backgroundColor: color.surface },
  thumb: { width: 104, height: 104 },
  thumbBar: { flexDirection: "row", justifyContent: "space-between" },
  mini: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center" },
  miniText: { fontSize: 16, color: color.ink },
  index: { position: "absolute", top: 4, left: 6, backgroundColor: color.ink, color: color.paper, paddingHorizontal: 6, borderRadius: 8, overflow: "hidden", fontWeight: "700" },
  input: { minHeight: minTarget, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space.md, marginBottom: space.sm, fontSize: 17, color: color.ink },
});
