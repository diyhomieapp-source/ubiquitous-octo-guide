import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch, TextInput, Modal } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, setToken } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type PendingAction = { action: string; label: string; run: (token: string) => Promise<void> } | null;

export default function PrivacyScreen() {
  const router = useRouter();
  const [ov, setOv] = useState<any>(null);
  const [consents, setConsents] = useState<any[]>([]);
  const [shares, setShares] = useState<any[]>([]);
  const [homes, setHomes] = useState<any[]>([]);
  const [dataMap, setDataMap] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [selCats, setSelCats] = useState<string[]>([]);
  const [exportCats, setExportCats] = useState<string[]>([]);

  // reauth modal
  const [pending, setPending] = useState<PendingAction>(null);
  const [pw, setPw] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, c, s, dm, ec, hh] = await Promise.all([
        api<any>("/hi/privacy/overview"), api<any>("/hi/privacy/consents"), api<any>("/hi/privacy/shares"),
        api<any>("/hi/privacy/data-map"), api<any>("/hi/privacy/export/categories"), api<any>("/hi/account/overview").catch(() => ({ properties: [] })),
      ]);
      setOv(o); setConsents(c.consents || []); setShares(s.shares || []); setDataMap(dm.data_map || []);
      setExportCats(ec.categories || []); setSelCats(ec.categories || []); setHomes(hh.properties || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (fn: () => Promise<any>, silent = false) => {
    setBusy(true);
    try { const r = await fn(); if (!silent) await load(); return r; }
    catch (e: any) { Alert.alert("Action failed", e?.message || "Try again."); throw e; }
    finally { setBusy(false); }
  };

  const toggleConsent = (c: any, v: boolean) =>
    act(() => api("/hi/privacy/consents", { method: "PUT", body: { consent_type: c.type, status: v ? "granted" : "withdrawn" } }));
  const toggleAi = (key: string, v: boolean) =>
    act(() => api("/hi/privacy/ai-controls", { method: "PUT", body: { [key]: v } }));
  const revokeShare = (sid: string) =>
    act(() => api(`/hi/privacy/shares/${sid}/revoke`, { method: "POST" }));

  // ---- reauth-gated actions ----
  const requestReauth = (action: string, label: string, run: (token: string) => Promise<void>) => { setPw(""); setPending({ action, label, run }); };

  const confirmReauth = async () => {
    if (!pending || !pw.trim()) return;
    setBusy(true);
    try {
      const r = await api<any>("/hi/privacy/reauth", { method: "POST", body: { current_password: pw, action: pending.action } });
      const token = r.reauth_token;
      const run = pending.run;
      setPending(null); setPw("");
      await run(token);
      await load();
    } catch (e: any) {
      Alert.alert("Couldn't confirm", e?.message || "Check your password and try again.");
    } finally { setBusy(false); }
  };

  const doExport = () => requestReauth("data_export", "Export my data", async (token) => {
    const r = await api<any>("/hi/privacy/export", { method: "POST", body: { categories: selCats }, headers: { "X-Reauth-Token": token } });
    const ex = r.export;
    const kb = Math.max(1, Math.round((ex.size_bytes || 0) / 1024));
    // fetch the actual payload and (web) trigger a file download
    try {
      const dl = await api<any>(`/hi/privacy/export/${ex.id}/download?token=${encodeURIComponent(ex.download_token)}`);
      if (typeof document !== "undefined") {
        const blob = new Blob([JSON.stringify(dl.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `diyhomie-export-${ex.id.slice(0, 8)}.json`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch {}
    Alert.alert("Export ready", `${ex.categories.length} categories · ~${kb} KB. Your download link expires soon and only works for you.`);
  });

  const doDeleteAccount = () => requestReauth("account_delete", "Delete my account", async (token) => {
    const r = await api<any>("/hi/privacy/account/deletion", { method: "POST", body: { reason: null }, headers: { "X-Reauth-Token": token } });
    Alert.alert("Deletion scheduled", r.note);
  });

  const cancelDeletion = () => act(async () => {
    const r = await api<any>("/hi/privacy/account/deletion/cancel", { method: "POST" });
    Alert.alert("Cancelled", r.note);
  });

  const deleteProperty = (home: any) => {
    Alert.alert("Delete this home?", `"${home.name || "Home"}" and its rooms, assets, projects, measurements & documents will be deleted. Collaborator access and shared links are revoked. Export first if you want a copy.`,
      [{ text: "Cancel", style: "cancel" },
       { text: "Delete", style: "destructive", onPress: () => requestReauth("property_delete", `Delete "${home.name || "Home"}"`, async (token) => {
          const r = await api<any>(`/hi/privacy/properties/${home.id}/deletion`, { method: "POST", headers: { "X-Reauth-Token": token } });
          Alert.alert("Home deleted", r.note);
        }) }]);
  };

  if (loading || !ov) return <View style={styles.root}><ScreenHeader title="Privacy & Data" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const pendingDeletion = ov.account_state === "deletion_pending";

  return (
    <View style={styles.root}>
      <ScreenHeader title="Privacy & Data" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>

        {pendingDeletion && (
          <View style={styles.warnCard}>
            <MaterialCommunityIcons name="alert-outline" size={22} color="#EB5757" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>Account deletion scheduled</Text>
              <Text style={styles.warnBody}>Effective {String(ov.deletion?.deletion_effective_at || "").slice(0, 10)}. You can still cancel.</Text>
              <Pressable testID="privacy-cancel-deletion" disabled={busy} style={styles.warnBtn} onPress={cancelDeletion}><Text style={styles.warnBtnText}>Cancel deletion</Text></Pressable>
            </View>
          </View>
        )}

        <Text style={styles.intro}>Your home information is private by default. You control what's shared, what AI uses, and you can export or delete your data anytime.</Text>

        {/* Consents */}
        <Text style={styles.section}>Your consent</Text>
        <View style={styles.card}>
          {consents.map((c, i) => (
            <View key={c.type} style={[styles.rowBetween, i > 0 && styles.rowDivider]}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Text style={styles.k}>{c.type.replace(/_/g, " ")}{c.required ? " (required)" : ""}</Text>
                <Text style={styles.hint}>{c.purpose}</Text>
              </View>
              <Switch testID={`privacy-consent-${c.type}`} value={c.status === "granted"} disabled={busy || c.required} onValueChange={(v) => toggleConsent(c, v)} trackColor={{ true: colors.brandPrimary }} />
            </View>
          ))}
        </View>

        {/* AI & analytics */}
        <Text style={styles.section}>AI & analytics</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}><Text style={styles.k}>Usage analytics</Text><Text style={styles.hint}>Optional. Helps us keep the app reliable.</Text></View>
            <Switch testID="privacy-analytics" value={!!ov.ai_prefs?.analytics_opt_in} disabled={busy} onValueChange={(v) => toggleAi("analytics_opt_in", v)} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <View style={[styles.rowBetween, styles.rowDivider]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}><Text style={styles.k}>Improve AI models</Text><Text style={styles.hint}>Optional. Allow anonymized data to improve AI. Off by default.</Text></View>
            <Switch testID="privacy-ai-training" value={!!ov.ai_prefs?.ai_training_opt_in} disabled={busy} onValueChange={(v) => toggleAi("ai_training_opt_in", v)} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <View style={[styles.rowBetween, styles.rowDivider]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}><Text style={styles.k}>Homie can use My Home data</Text><Text style={styles.hint}>Lets Homie tailor answers to your home. Off = Homie asks instead of assuming.</Text></View>
            <Switch testID="privacy-ai-home" value={ov.ai_prefs?.allow_home_context !== false} disabled={busy} onValueChange={(v) => toggleAi("allow_home_context", v)} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <View style={[styles.rowBetween, styles.rowDivider]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}><Text style={styles.k}>Homie can use project photos</Text><Text style={styles.hint}>Used only when you ask Homie to look at a photo.</Text></View>
            <Switch testID="privacy-ai-photos" value={ov.ai_prefs?.allow_project_photos !== false} disabled={busy} onValueChange={(v) => toggleAi("allow_project_photos", v)} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <View style={[styles.rowBetween, styles.rowDivider]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}><Text style={styles.k}>Homie can read my documents</Text><Text style={styles.hint}>Used only when you explicitly ask Homie to analyze a document.</Text></View>
            <Switch testID="privacy-ai-docs" value={ov.ai_prefs?.allow_documents !== false} disabled={busy} onValueChange={(v) => toggleAi("allow_documents", v)} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <View style={[styles.rowBetween, styles.rowDivider]}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}><Text style={styles.k}>AI personalization</Text><Text style={styles.hint}>Adapts guidance to your skill level and preferences.</Text></View>
            <Switch testID="privacy-ai-personalization" value={ov.ai_prefs?.ai_personalization !== false} disabled={busy} onValueChange={(v) => toggleAi("ai_personalization", v)} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <Text style={styles.note}>Safety and essential guidance always work and are never affected by these optional toggles.</Text>
        </View>

        {/* Sessions */}
        <Text style={styles.section}>Sessions</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={styles.k}>Sign out of other devices</Text>
              <Text style={styles.hint}>Ends every session except this one. Use this if you signed in on a shared device.</Text>
            </View>
            <Pressable
              testID="privacy-logout-all"
              disabled={busy}
              onPress={() => act(async () => {
                const r = await api<any>("/auth/logout-all", { method: "POST" });
                if (r?.access_token) await setToken(r.access_token);
                Alert.alert("Done", r?.message || "Signed out everywhere else.");
              }, true)}
              style={styles.smallBtn}
            >
              <Text style={styles.smallBtnText}>Sign out</Text>
            </Pressable>
          </View>
        </View>

        {/* Sharing registry */}
        <Text style={styles.section}>What you're sharing ({shares.length})</Text>
        {shares.length === 0 ? <Text style={styles.empty}>You're not sharing anything right now.</Text> :
          shares.map((s) => (
            <View key={s.id} style={styles.shareRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.k}>{s.recipient}</Text>
                <Text style={styles.hint}>{s.kind.replace(/_/g, " ")} · {s.scope}{s.download ? " · downloadable" : ""}</Text>
              </View>
              <Pressable testID={`privacy-revoke-${s.id}`} disabled={busy} style={styles.smallBtn} onPress={() => revokeShare(s.id)}><Text style={styles.smallBtnText}>Revoke</Text></Pressable>
            </View>
          ))}

        {/* Export */}
        <Text style={styles.section}>Export your data</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>Choose what to include. You'll confirm your password. The download link expires and only works for you — it never includes secrets or other people's data.</Text>
          <View style={styles.chipRow}>
            {exportCats.map((cat) => {
              const on = selCats.includes(cat);
              return <Pressable key={cat} testID={`privacy-cat-${cat}`} style={[styles.chip, on && styles.chipOn]} onPress={() => setSelCats((p) => on ? p.filter((x) => x !== cat) : [...p, cat])}><Text style={[styles.chipText, on && styles.chipTextOn]}>{cat}</Text></Pressable>;
            })}
          </View>
          <Pressable testID="privacy-export" disabled={busy || selCats.length === 0} style={[styles.primaryBtn, (busy || selCats.length === 0) && { opacity: 0.5 }]} onPress={doExport}><Text style={styles.primaryText}>Request export</Text></Pressable>
        </View>

        {/* Data map */}
        <Pressable style={styles.section} onPress={() => setShowMap((v) => !v)}><Text style={styles.sectionText}>What we store {showMap ? "▲" : "▼"}</Text></Pressable>
        {showMap && (
          <View style={styles.card}>
            {dataMap.map((d, i) => (
              <View key={d.category} style={[i > 0 && styles.rowDivider, { paddingVertical: 6 }]}>
                <Text style={styles.k}>{d.label} <Text style={styles.classTag}>Class {d.data_class}</Text></Text>
                <Text style={styles.hint}>Purpose: {d.purpose}</Text>
                <Text style={styles.hint}>Kept: {d.retention} · {d.deletion}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Homes */}
        {homes.length > 0 && (
          <>
            <Text style={styles.section}>Your homes</Text>
            {homes.map((h) => (
              <View key={h.id} style={styles.shareRow}>
                <View style={{ flex: 1 }}><Text style={styles.k}>{h.name || "My Home"}{h.is_active ? " · active" : ""}</Text></View>
                <Pressable testID={`privacy-del-home-${h.id}`} disabled={busy} style={[styles.smallBtn, { borderColor: "#EB5757" }]} onPress={() => deleteProperty(h)}><Text style={[styles.smallBtnText, { color: "#EB5757" }]}>Delete</Text></Pressable>
              </View>
            ))}
          </>
        )}

        {/* Danger zone */}
        <Text style={[styles.section, { color: "#EB5757" }]}>Danger zone</Text>
        <View style={[styles.card, { borderColor: "#EB575755" }]}>
          <Text style={styles.hint}>Deleting your account revokes all access and shares immediately, then permanently deletes your private data after a {ov.recovery_days}-day recovery window. Some records are kept only where legally required.</Text>
          {!pendingDeletion ? (
            <Pressable testID="privacy-delete-account" disabled={busy} style={styles.dangerBtn} onPress={doDeleteAccount}><Text style={styles.dangerText}>Delete my account</Text></Pressable>
          ) : <Text style={[styles.note, { color: "#EB5757" }]}>Deletion is scheduled. Cancel it above to keep your account.</Text>}
        </View>
      </ScrollView>

      {/* Reauth modal */}
      <Modal visible={!!pending} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <View style={styles.modalWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Confirm it's you</Text>
          <Text style={styles.hint}>Enter your password to continue: {pending?.label}</Text>
          <TextInput testID="privacy-reauth-pw" value={pw} onChangeText={setPw} placeholder="Current password" placeholderTextColor={colors.onSurfaceTertiary} secureTextEntry style={styles.input} autoFocus />
          <View style={styles.sheetBtns}>
            <Pressable style={[styles.sheetBtn, styles.cancel]} onPress={() => setPending(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
            <Pressable testID="privacy-reauth-confirm" disabled={busy || !pw.trim()} style={[styles.sheetBtn, styles.go, (busy || !pw.trim()) && { opacity: 0.5 }]} onPress={confirmReauth}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.goText}>Confirm</Text>}</Pressable>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginBottom: spacing.sm },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  rowDivider: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: 6, paddingTop: 10 },
  k: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, lineHeight: 16 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  classTag: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 9 },
  shareRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  primaryText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  smallBtn: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  smallBtnText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.xs },
  dangerBtn: { borderColor: "#EB5757", borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  dangerText: { color: "#EB5757", fontFamily: font.bold, fontSize: type.base },
  warnCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: "#EB575712", borderColor: "#EB575755", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  warnTitle: { color: "#EB5757", fontFamily: font.bold, fontSize: type.base },
  warnBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  warnBtn: { alignSelf: "flex-start", marginTop: spacing.sm, borderColor: "#EB5757", borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  warnBtnText: { color: "#EB5757", fontFamily: font.bold, fontSize: type.xs },
  modalWrap: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.xs },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.md },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  sheetBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  cancel: { borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  go: { backgroundColor: colors.brandPrimary },
  goText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
});
