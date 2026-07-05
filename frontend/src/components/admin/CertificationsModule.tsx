import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Cert = { id: string; user_name: string; title: string; room: string; status: string; issued_at: string; share_token: string | null; pro_validated: boolean; code_compliant: boolean };
type Analytics = { total: number; active: number; revoked: number; shared: number; pro_validated: number; verified_users: number; tiers: Record<string, number>; by_room: { room: string; count: number }[] };

export function CertificationsModule() {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200" });
    if (q.trim()) params.set("q", q.trim());
    try { const r = await api<{ certificates: Cert[] }>(`/admin/certifications?${params.toString()}`); setCerts(r.certificates); } catch {}
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAnalytics(await api<Analytics>("/admin/certifications/analytics")); await loadList(); }
    catch {} finally { setLoading(false); }
  }, [loadList]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const revoke = (c: Cert) => {
    Alert.alert("Revoke certificate?", `"${c.title}" for ${c.user_name} will be marked invalid.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => {
        try { await api(`/admin/certifications/${c.id}/revoke`, { method: "POST", body: { reason: "Admin review" } }); load(); }
        catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } } },
    ]);
  };
  const act = async (c: Cert, action: "reinstate" | "validate") => {
    try { await api(`/admin/certifications/${c.id}/${action}`, { method: "POST" }); load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
  };

  if (loading || !analytics) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const maxRoom = Math.max(1, ...analytics.by_room.map((r) => r.count));

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>Verified & Certification</Text>
      <Text style={styles.sub}>Issued credentials, verified-user tiers & revocation controls.</Text>

      <View style={styles.statRow}>
        <Stat label="Issued" value={String(analytics.total)} />
        <Stat label="Active" value={String(analytics.active)} />
        <Stat label="Revoked" value={String(analytics.revoked)} accent={analytics.revoked > 0} />
        <Stat label="Shared" value={String(analytics.shared)} />
        <Stat label="Verified users" value={String(analytics.verified_users)} />
      </View>

      <Text style={styles.section}>Verified tiers</Text>
      <View style={styles.statRow}>
        <Stat label="Verified" value={String(analytics.tiers.verified || 0)} />
        <Stat label="Advanced" value={String(analytics.tiers.advanced || 0)} />
        <Stat label="Master" value={String(analytics.tiers.master || 0)} />
        <Stat label="Pro-validated" value={String(analytics.pro_validated)} />
      </View>

      <Text style={styles.section}>Certificates by area</Text>
      {analytics.by_room.map((r) => (
        <View key={r.room} style={styles.barRow}>
          <Text style={styles.barLabel}>{r.room}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(r.count / maxRoom * 100)}%` }]} /></View>
          <Text style={styles.barCount}>{r.count}</Text>
        </View>
      ))}

      <Text style={styles.section}>All certificates</Text>
      <View style={styles.searchRow}>
        <TextInput testID="cert-admin-search" style={styles.search} value={q} onChangeText={setQ} placeholder="Search title or holder…" placeholderTextColor={colors.onSurfaceTertiary} onSubmitEditing={loadList} />
        <Pressable testID="cert-admin-search-btn" style={styles.searchBtn} onPress={loadList}><MaterialCommunityIcons name="magnify" size={20} color={colors.onBrandPrimary} /></Pressable>
      </View>
      {certs.map((c) => (
        <View key={c.id} testID="cert-admin-row" style={styles.certRow}>
          <MaterialCommunityIcons name={c.status === "revoked" ? "shield-off-outline" : c.pro_validated ? "shield-star" : "certificate"} size={20} color={c.status === "revoked" ? colors.error : colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.certTitle} numberOfLines={1}>{c.title}</Text>
            <Text style={styles.certMeta}>{c.user_name} · {(c.room || "home")} · {(c.issued_at || "").slice(0, 10)}{c.status === "revoked" ? " · REVOKED" : ""}</Text>
          </View>
          {c.status === "active" ? (
            <>
              {!c.pro_validated && <Pressable testID={`cert-validate-${c.id}`} style={styles.miniBtn} onPress={() => act(c, "validate")}><Text style={styles.miniText}>Validate</Text></Pressable>}
              <Pressable testID={`cert-revoke-${c.id}`} style={[styles.miniBtn, styles.dangerBtn]} onPress={() => revoke(c)}><Text style={[styles.miniText, { color: colors.error }]}>Revoke</Text></Pressable>
            </>
          ) : (
            <Pressable testID={`cert-reinstate-${c.id}`} style={styles.miniBtn} onPress={() => act(c, "reinstate")}><Text style={styles.miniText}>Reinstate</Text></Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={[styles.stat, accent && { borderColor: colors.error }]}><Text style={[styles.statVal, accent && { color: colors.error }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 66, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  barLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, width: 90, textTransform: "capitalize" },
  track: { flex: 1, height: 16, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  fill: { height: 16, borderRadius: radius.sm, backgroundColor: colors.brandPrimary },
  barCount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, width: 40, textAlign: "right" },
  searchRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  search: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  searchBtn: { width: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.sm },
  certRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  certTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  certMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  miniBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5, marginLeft: 4 },
  dangerBtn: { borderColor: colors.error },
  miniText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
});
