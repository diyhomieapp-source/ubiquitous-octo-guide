import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Cred = { id: string; type: string; number: string; issuer: string; specialty: string; expires_at: string | null; status: string; has_doc: boolean; note: string };
type Compliance = { overall: string; licensed: boolean; insured: boolean; verified_count: number; total: number };

const SC: Record<string, string> = { verified: colors.success, expiring: colors.warning, expired: colors.error, rejected: colors.error, pending: colors.info, under_review: colors.info };
const OVERALL: Record<string, { label: string; color: string; icon: string }> = {
  compliant: { label: "Compliant", color: colors.success, icon: "shield-check" },
  expiring_soon: { label: "Expiring soon", color: colors.warning, icon: "shield-alert" },
  action_required: { label: "Action required", color: colors.error, icon: "shield-off" },
  under_review: { label: "Under review", color: colors.info, icon: "shield-sync" },
  not_submitted: { label: "Not submitted", color: colors.onSurfaceTertiary, icon: "shield-outline" },
};

export default function Credentials() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [creds, setCreds] = useState<Cred[]>([]);
  const [comp, setComp] = useState<Compliance | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ credentials: Cred[]; compliance: Compliance; types: string[] }>("/pro/credentials"); setCreds(d.credentials); setComp(d.compliance); setTypes(d.types); }
    catch (e: any) { if (e?.status === 403) { Alert.alert("Pro account needed", "Apply as a pro first.", [{ text: "OK", onPress: () => router.back() }]); } }
    finally { setLoading(false); }
  }, [router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = async (id: string) => {
    try { await api(`/pro/credentials/${id}`, { method: "DELETE" }); load(); } catch {}
  };

  const ov = comp ? OVERALL[comp.overall] || OVERALL.not_submitted : OVERALL.not_submitted;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cred-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Credentials</Text>
        <Pressable testID="cred-add" hitSlop={10} onPress={() => setAdding((a) => !a)}><MaterialCommunityIcons name={adding ? "close" : "plus"} size={24} color={colors.onSurface} /></Pressable>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
          {comp && (
            <View style={[styles.statusCard, { borderColor: ov.color }]}>
              <MaterialCommunityIcons name={ov.icon as any} size={28} color={ov.color} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusLabel, { color: ov.color }]}>{ov.label}</Text>
                <Text style={styles.statusSub}>{comp.verified_count}/{comp.total} verified · {comp.licensed ? "Licensed" : "No license"} · {comp.insured ? "Insured" : "No insurance"}</Text>
              </View>
            </View>
          )}
          <Text style={styles.note}>Verified credentials unlock your “Verified Pro” badge and make you visible to clients who filter for licensed pros.</Text>

          {adding && <AddForm types={types} onAdded={() => { setAdding(false); load(); }} />}

          {creds.length === 0 && !adding ? (
            <View style={styles.empty}><MaterialCommunityIcons name="file-certificate-outline" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No credentials yet. Tap + to add your license or insurance.</Text></View>
          ) : creds.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.cardTop}>
                <MaterialCommunityIcons name="certificate-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.cardTitle}>{c.type}</Text>
                <View style={[styles.badge, { backgroundColor: (SC[c.status] || colors.onSurfaceTertiary) + "22" }]}>
                  <Text style={[styles.badgeText, { color: SC[c.status] || colors.onSurfaceTertiary }]}>{c.status}</Text>
                </View>
              </View>
              {!!c.number && <Text style={styles.meta}>#{c.number}{c.issuer ? ` · ${c.issuer}` : ""}</Text>}
              {!!c.expires_at && <Text style={styles.meta}>Expires {c.expires_at.slice(0, 10)}</Text>}
              {!!c.note && <Text style={styles.reject}>{c.note}</Text>}
              <Pressable testID={`cred-del-${c.id}`} style={styles.delBtn} onPress={() => remove(c.id)}><MaterialCommunityIcons name="trash-can-outline" size={14} color={colors.onSurfaceTertiary} /><Text style={styles.delText}>Remove</Text></Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function AddForm({ types, onAdded }: { types: string[]; onAdded: () => void }) {
  const [type, setType] = useState(types[0] || "Contractor License");
  const [number, setNumber] = useState("");
  const [issuer, setIssuer] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const iso = expires.trim() ? new Date(expires.trim()).toISOString() : null;
      await api("/pro/credentials", { method: "POST", body: { type, number: number.trim(), issuer: issuer.trim(), expires_at: iso } });
      onAdded();
    } catch (e: any) { Alert.alert("Couldn't add", e?.message || "Check the date format (YYYY-MM-DD)."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Add credential</Text>
      <View style={styles.chipWrap}>
        {types.map((t) => <Pressable key={t} style={[styles.chip, type === t && styles.chipOn]} onPress={() => setType(t)}><Text style={[styles.chipText, type === t && styles.chipTextOn]}>{t}</Text></Pressable>)}
      </View>
      <TextInput testID="cred-number" style={styles.input} value={number} onChangeText={setNumber} placeholder="License / policy number" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput style={styles.input} value={issuer} onChangeText={setIssuer} placeholder="Issuer (e.g. TX TDLR, State Farm)" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput testID="cred-expires" style={styles.input} value={expires} onChangeText={setExpires} placeholder="Expiry date (YYYY-MM-DD)" placeholderTextColor={colors.onSurfaceTertiary} autoCapitalize="none" />
      <Pressable testID="cred-submit" style={styles.submitBtn} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Submit for verification</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  statusCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md },
  statusLabel: { fontFamily: font.display, fontSize: 20 },
  statusSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginVertical: spacing.md },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  reject: { color: colors.error, fontFamily: font.regular, fontSize: type.sm },
  delBtn: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", marginTop: spacing.xs },
  delText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  formTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
