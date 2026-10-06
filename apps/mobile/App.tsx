import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ServerCapture } from "@recall/api-client";
import { loadConfig } from "./src/config";
import { createServices, type Services } from "./src/services";
import { mergeRecent, type RecentRow } from "./src/viewmodel";
import { SignInScreen } from "./src/screens/SignInScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CaptureScreen } from "./src/screens/CaptureScreen";
import { DetailScreen } from "./src/screens/DetailScreen";
import { text } from "./src/ui/kit";

type Route = { name: "home" } | { name: "capture" } | { name: "detail"; row: RecentRow };

export default function App() {
  const loaded = useMemo(() => loadConfig(), []);
  if ("missing" in loaded) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        <Text style={text.heading}>Recall isn't configured</Text>
        <Text style={text.body}>Missing: {loaded.missing.join(", ")}. See docs/DEVELOPMENT.md. Recall will not run in a pretend mode.</Text>
      </SafeAreaView>
    );
  }
  return <Configured config={loaded.config} />;
}

function Configured({ config }: { config: Parameters<typeof createServices>[0] }) {
  const services = useMemo(() => createServices(config), [config]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void services.auth.hasSession().then(setSignedIn);
    return services.auth.onSignedInChange(setSignedIn);
  }, [services]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {signedIn === null ? <View style={{ flex: 1, justifyContent: "center" }}><ActivityIndicator /></View> : signedIn ? <Main services={services} /> : <SignInScreen auth={services.auth} />}
    </SafeAreaProvider>
  );
}

function Main({ services }: { services: Services }) {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [rows, setRows] = useState<RecentRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null); // connectivity only
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null); // sticky: never cleared by a refresh
  const remote = useRef<ServerCapture[]>([]);

  const rebuild = useCallback(async () => {
    const owner = await services.auth.getUserId();
    const local = owner ? await services.syncer.store.list(owner) : [];
    setRows(mergeRecent(local, remote.current, (id) => services.syncer.isActive(id)));
  }, [services]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      remote.current = (await services.api.listCaptures({ limit: 50 })).items;
      setBanner(null);
    } catch {
      setBanner("Offline or can't reach Recall. Showing what's on this device.");
    }
    await rebuild();
    setRefreshing(false);
  }, [services, rebuild]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const report = await services.syncer.store.recover(); // after a force-close: reconcile first
      if (!alive) return;
      if (report.damaged.length > 0 || report.unreadable.length > 0) setRecoveryWarning("Some saved captures could not be read on this device. They have not been deleted.");
      await rebuild();
      void services.api.me().catch(() => undefined); // provisions the workspace on first sign-in
      await services.syncer.syncAllPending();
      await refresh();
    })();
    const unsubscribe = services.syncer.subscribe(() => void rebuild());
    const appState = AppState.addEventListener("change", (s) => { if (s === "active") { void services.syncer.syncAllPending().then(refresh); } });
    const timer = setInterval(() => void services.syncer.syncAllPending().then(refresh), 30_000); // retry while the app is open
    return () => { alive = false; unsubscribe(); appState.remove(); clearInterval(timer); };
  }, [services, rebuild, refresh]);

  if (route.name === "capture") return <CaptureScreen services={services} onCancel={() => setRoute({ name: "home" })} onDone={() => { setRoute({ name: "home" }); void rebuild(); }} />;
  if (route.name === "detail") return <DetailScreen services={services} row={route.row} onBack={() => setRoute({ name: "home" })} />;
  return (
    <HomeScreen
      rows={rows}
      refreshing={refreshing}
      banner={[recoveryWarning, banner].filter(Boolean).join(" ") || null}
      onRefresh={() => void refresh()}
      onScan={() => setRoute({ name: "capture" })}
      onOpen={(row) => setRoute({ name: "detail", row })}
      onRetry={(row) => row.localId && void services.syncer.sync(row.localId).then(refresh)}
      onSignOut={() => void services.auth.signOut()}
    />
  );
}
