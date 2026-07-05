import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Key = { id: string; label: string; scopes: string[]; environment: string; key: string; active: boolean; call_count: number };
type Hook = { id: string; url: string; events: string[]; active: boolean; secret: string; failures: number; deliveries: number; last_status: number | null };
type Meta = { scopes: string[]; events: string[]; environments: string[]; base_url: string; docs: { method: string; path: string; scope: string; desc: string }[] };
type Tab = "keys" | "webhooks" | "docs";

export default function Developer() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("keys");
  const [meta, setMeta] = useState<Meta | null>(null);

  useFocusEffect(useCallback(() => { api<Meta>("/developer/meta").then(setMeta).catch(() => {}); }, []));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="dev-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Developer</Text>
        <View style={{ width: 28 }} />
      </View>
      <View style={styles.tabRow}>
        {([["keys", "API Keys"], ["webhooks", "Webhooks"], ["docs", "API Docs"]] as [Tab, string][]).map(([k, l]) => (
          <Pressable key={k} testID={`dev-tab-${k}`} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1, paddingHorizontal: spacing.lg }}>
        {tab === "keys" && <Keys meta={meta} insetsBottom={insets.bottom} />}
        {tab === "webhooks" && <Webhooks meta={meta} insetsBottom={insets.bottom} />}
        {tab === "docs" && <Docs meta={meta} insetsBottom={insets.bottom} />}
      </View>
    </View>
  );
}

function Keys({ meta, insetsBottom }: { meta: Meta | null; insetsBottom: number }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>(["projects:read"]);
  const [env, setEnv] = useState("test");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ keys: Key[] }>("/developer/keys"); setKeys(d.keys); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!label.trim()) { Alert.alert("Name it", "Give your key a label."); return; }
    setBusy(true);
    try {
      const r = await api<{ key: Key; warning: string }>("/developer/keys", { method: "POST", body: { label: label.trim(), scopes, environment: env } });
      await Clipboard.setStringAsync(r.key.key);
      Alert.alert("Key created & copied", `${r.key.key}\n\n${r.warning}`);
      setLabel(""); load();
    } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const revoke = async (k: Key) => {
    Alert.alert("Revoke key?", `${k.label} will stop working immediately.`, [{ text: "Cancel", style: "cancel" }, { text: "Revoke", style: "destructive", onPress: async () => { try { await api(`/developer/keys/${k.id}/revoke`, { method: "POST" }); load(); } catch {} } }]);
  };
  const toggleScope = (s: string) => setScopes((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);

  if (loading) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} />;
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insetsBottom + 40 }}>
      <View style={styles.form}>
        <Text style={styles.formTitle}>Create API key</Text>
        <TextInput testID="dev-key-label" style={styles.input} value={label} onChangeText={setLabel} placeholder="Label (e.g. Zapier integration)" placeholderTextColor={colors.onSurfaceTertiary} />
        <Text style={styles.miniLabel}>ENVIRONMENT</Text>
        <View style={styles.chipWrap}>
          {(meta?.environments || ["test", "live"]).map((e) => <Pressable key={e} style={[styles.chip, env === e && styles.chipOn]} onPress={() => setEnv(e)}><Text style={[styles.chipText, env === e && styles.chipTextOn]}>{e}</Text></Pressable>)}
        </View>
        <Text style={styles.miniLabel}>SCOPES</Text>
        <View style={styles.chipWrap}>
          {(meta?.scopes || []).map((s) => <Pressable key={s} style={[styles.chip, scopes.includes(s) && styles.chipOn]} onPress={() => toggleScope(s)}><Text style={[styles.chipText, scopes.includes(s) && styles.chipTextOn]}>{s}</Text></Pressable>)}
        </View>
        <Pressable testID="dev-key-create" style={styles.submitBtn} onPress={create} disabled={busy}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Generate key</Text>}</Pressable>
      </View>

      {keys.map((k) => (
        <View key={k.id} style={[styles.card, !k.active && { opacity: 0.5 }]}>
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle}>{k.label}</Text>
            <View style={[styles.envTag, { backgroundColor: (k.environment === "live" ? colors.success : colors.info) + "22" }]}><Text style={[styles.envText, { color: k.environment === "live" ? colors.success : colors.info }]}>{k.environment}</Text></View>
          </View>
          <Text style={styles.mono}>{k.key}</Text>
          <Text style={styles.meta}>{k.scopes.join(", ")} · {k.call_count} calls</Text>
          {k.active && <Pressable testID={`dev-key-revoke-${k.id}`} style={styles.revokeBtn} onPress={() => revoke(k)}><Text style={styles.revokeText}>Revoke</Text></Pressable>}
        </View>
      ))}
    </ScrollView>
  );
}

function Webhooks({ meta, insetsBottom }: { meta: Meta | null; insetsBottom: number }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ webhooks: Hook[] }>("/developer/webhooks"); setHooks(d.webhooks); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!url.trim().startsWith("http")) { Alert.alert("Invalid URL", "Enter a valid https endpoint."); return; }
    setBusy(true);
    try { await api("/developer/webhooks", { method: "POST", body: { url: url.trim(), events } }); setUrl(""); setEvents([]); load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const test = async (h: Hook) => {
    try { const r = await api<{ ok: boolean; note: string }>(`/developer/webhooks/${h.id}/test`, { method: "POST" }); Alert.alert(r.ok ? "Delivered ✅" : "Not delivered", r.note); load(); } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
  };
  const remove = async (h: Hook) => { try { await api(`/developer/webhooks/${h.id}`, { method: "DELETE" }); load(); } catch {} };
  const toggleEvent = (e: string) => setEvents((p) => p.includes(e) ? p.filter((x) => x !== e) : [...p, e]);

  if (loading) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.brandPrimary} />;
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insetsBottom + 40 }}>
      <View style={styles.form}>
        <Text style={styles.formTitle}>Add webhook</Text>
        <TextInput testID="dev-hook-url" style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="https://your-server.com/webhook" placeholderTextColor={colors.onSurfaceTertiary} />
        <Text style={styles.miniLabel}>EVENTS (BLANK = ALL)</Text>
        <View style={styles.chipWrap}>
          {(meta?.events || []).map((e) => <Pressable key={e} style={[styles.chip, events.includes(e) && styles.chipOn]} onPress={() => toggleEvent(e)}><Text style={[styles.chipText, events.includes(e) && styles.chipTextOn]}>{e}</Text></Pressable>)}
        </View>
        <Pressable testID="dev-hook-create" style={styles.submitBtn} onPress={create} disabled={busy}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Register webhook</Text>}</Pressable>
      </View>

      {hooks.map((h) => (
        <View key={h.id} style={styles.card}>
          <Text style={styles.cardTitle} numberOfLines={1}>{h.url}</Text>
          <Text style={styles.meta}>{h.events.length} events · {h.deliveries} sent · {h.failures} failed{h.last_status ? ` · last ${h.last_status}` : ""}</Text>
          <Text style={styles.monoSm}>{h.secret}</Text>
          <View style={styles.hookActions}>
            <Pressable testID={`dev-hook-test-${h.id}`} style={[styles.smallBtn, styles.smallOk]} onPress={() => test(h)}><MaterialCommunityIcons name="send-outline" size={13} color={colors.onBrandPrimary} /><Text style={styles.smallOkText}>Send test</Text></Pressable>
            <Pressable testID={`dev-hook-del-${h.id}`} style={styles.smallBtn} onPress={() => remove(h)}><MaterialCommunityIcons name="trash-can-outline" size={13} color={colors.error} /><Text style={[styles.smallText, { color: colors.error }]}>Delete</Text></Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Docs({ meta, insetsBottom }: { meta: Meta | null; insetsBottom: number }) {
  const copy = async (t: string) => { await Clipboard.setStringAsync(t); Alert.alert("Copied", t); };
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insetsBottom + 40 }}>
      <Text style={styles.docsIntro}>Authenticate every request with your API key header:</Text>
      <Pressable style={styles.codeBox} onPress={() => copy("X-API-Key: dk_live_xxx")}><Text style={styles.code}>X-API-Key: dk_live_xxx</Text></Pressable>
      <Text style={styles.docsIntro}>Endpoints (base {meta?.base_url || "/api/v1"}):</Text>
      {(meta?.docs || []).map((d, i) => (
        <View key={i} style={styles.docRow}>
          <View style={styles.methodTag}><Text style={styles.methodText}>{d.method}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.docPath}>{d.path}</Text>
            <Text style={styles.docDesc}>{d.desc}{d.scope !== "—" ? ` · scope: ${d.scope}` : ""}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.docsIntro}>Webhooks are signed with HMAC-SHA256 in the X-DIYhomie-Signature header — verify it with your webhook secret.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  tabRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  tabTextOn: { color: colors.onBrandPrimary },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  formTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  miniLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 11 },
  chipTextOn: { color: colors.onBrandPrimary },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  envTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  envText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  mono: { color: colors.brandPrimary, fontFamily: Platform.select({ ios: "Courier", default: "monospace" }), fontSize: type.sm },
  monoSm: { color: colors.onSurfaceTertiary, fontFamily: Platform.select({ ios: "Courier", default: "monospace" }), fontSize: 11 },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  revokeBtn: { alignSelf: "flex-start", borderColor: colors.error, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4, marginTop: spacing.xs },
  revokeText: { color: colors.error, fontFamily: font.bold, fontSize: type.sm },
  hookActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  smallOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  smallOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  smallText: { fontFamily: font.bold, fontSize: type.sm },
  docsIntro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginVertical: spacing.sm },
  codeBox: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md },
  code: { color: colors.brandPrimary, fontFamily: Platform.select({ ios: "Courier", default: "monospace" }), fontSize: type.sm },
  docRow: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  methodTag: { backgroundColor: colors.info + "22", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  methodText: { color: colors.info, fontFamily: font.bold, fontSize: 10 },
  docPath: { color: colors.onSurface, fontFamily: Platform.select({ ios: "Courier", default: "monospace" }), fontSize: type.sm },
  docDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
});
