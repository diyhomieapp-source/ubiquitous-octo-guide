import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Cred = { id: string; type: string; number: string; issuer: string; expires_at: string | null; status: string; pro_name: string; pro_email: string; note: string };

const SC: Record<string, string> = { verified: colors.success, expiring: colors.warning, expired: colors.error, rejected: colors.error, pending: colors.info };
const FILTERS = ["pending", "expiring", "expired", "verified", "rejected"];

export function CredentialsModule() {
  const [rows, setRows] = useState<Cred[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");

  const load = useCallback(async () => {
    try { const d = await api<{ credentials: Cred[]; counts: Record<string, number> }>("/admin/credentials"); setRows(d.credentials); setCounts(d.counts); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decide = async (c: Cred, status: string) => {
    const go = async (note: string) => {
      try { await api(`/admin/credentials/${c.id}`, { method: "PATCH", body: { status, note } }); load(); } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    };
    if (status === "rejected") { Alert.prompt ? Alert.prompt("Reason", "Why is this rejected?", (t) => go(t || "Invalid documentation")) : go("Invalid documentation"); }
    else go("");
  };

  const shown = rows.filter((r) => r.status === filter);
  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Credential Verification</Text>
      <Text style={styles.sub}>{counts.pending || 0} pending · {counts.expiring || 0} expiring · {counts.expired || 0} expired · {counts.verified || 0} verified.</Text>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable key={f} testID={`cred-filter-${f}`} style={[styles.filter, filter === f && styles.filterOn]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>{f.toUpperCase()} {counts[f] ? `(${counts[f]})` : ""}</Text>
          </Pressable>
        ))}
      </View>
      {shown.length === 0 ? (
        <View style={styles.empty}><MaterialCommunityIcons name="certificate-outline" size={28} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>Nothing in this view.</Text></View>
      ) : shown.map((c) => (
        <View key={c.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.name}>{c.type}</Text>
            <View style={[styles.badge, { backgroundColor: (SC[c.status] || colors.onSurfaceTertiary) + "22" }]}><Text style={[styles.badgeText, { color: SC[c.status] || colors.onSurfaceTertiary }]}>{c.status}</Text></View>
          </View>
          <Text style={styles.meta}>{c.pro_name} · {c.pro_email}</Text>
          <Text style={styles.meta}>{c.number ? `#${c.number}` : "no number"}{c.issuer ? ` · ${c.issuer}` : ""}{c.expires_at ? ` · exp ${c.expires_at.slice(0, 10)}` : ""}</Text>
          {c.status !== "verified" && (
            <View style={styles.actions}>
              <Pressable testID={`cred-verify-${c.id}`} style={[styles.btn, styles.btnOk]} onPress={() => decide(c, "verified")}><MaterialCommunityIcons name="check" size={14} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Verify</Text></Pressable>
              <Pressable testID={`cred-reject-${c.id}`} style={styles.btn} onPress={() => decide(c, "rejected")}><MaterialCommunityIcons name="close" size={14} color={colors.error} /><Text style={[styles.btnText, { color: colors.error }]}>Reject</Text></Pressable>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.md },
  filter: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  filterOn: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  filterText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 10 },
  filterTextOn: { color: colors.surface },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  btnText: { fontFamily: font.bold, fontSize: type.sm },
});
