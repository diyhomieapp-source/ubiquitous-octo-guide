import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Pro = {
  id: string; user_id: string; name: string; email: string; trades: string[]; specialties: string[];
  location: string; bio: string; license_number: string; insurance: string; phone: string;
  status: string; rating: number; reviews_count: number; jobs_completed: number;
  charges_enabled: boolean; payouts_enabled: boolean; created_at: string;
};

const STATUS_COLOR: Record<string, string> = {
  pending: colors.warning, verified: colors.success, banned: colors.error,
};

export function ProAccountsModule() {
  const [rows, setRows] = useState<Pro[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try { setRows(await api<Pro[]>("/admin/pro-accounts")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (uid: string, action: "verify" | "ban") => {
    try { await api(`/admin/pro-accounts/${uid}/${action}`, { method: "POST" }); load(); } catch {}
  };

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const pending = rows.filter((r) => r.status === "pending").length;

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Pro Accounts</Text>
      <Text style={styles.sub}>{rows.length} pros · {pending} awaiting verification.</Text>
      <View style={styles.filterRow}>
        {["all", "pending", "verified", "banned"].map((s) => (
          <Pressable key={s} testID={`proacct-filter-${s}`} style={[styles.filter, filter === s && styles.filterActive]} onPress={() => setFilter(s)}>
            <Text style={[styles.filterText, filter === s && styles.filterTextActive]}>{s.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {shown.length === 0 ? (
        <View style={styles.empty}><MaterialCommunityIcons name="account-hard-hat-outline" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No pro accounts here.</Text></View>
      ) : shown.map((p) => (
        <View key={p.user_id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.pName}>{p.name}</Text>
                <View style={[styles.badge, { backgroundColor: (STATUS_COLOR[p.status] || colors.onSurfaceTertiary) + "22" }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLOR[p.status] || colors.onSurfaceTertiary }]}>{p.status}</Text>
                </View>
              </View>
              <Text style={styles.meta}>{p.trades.join(", ") || "—"} · {p.location || "—"}</Text>
              <Text style={styles.meta}>{p.email}{p.phone ? ` · ${p.phone}` : ""}</Text>
            </View>
          </View>
          {!!p.bio && <Text style={styles.bio} numberOfLines={3}>{p.bio}</Text>}
          <View style={styles.credRow}>
            <View style={styles.cred}><MaterialCommunityIcons name="card-account-details-outline" size={13} color={colors.onSurfaceTertiary} /><Text style={styles.credText}>Lic: {p.license_number || "—"}</Text></View>
            <View style={styles.cred}><MaterialCommunityIcons name="shield-outline" size={13} color={colors.onSurfaceTertiary} /><Text style={styles.credText}>Ins: {p.insurance || "—"}</Text></View>
          </View>
          <Text style={styles.meta}>⭐ {p.rating?.toFixed(1) ?? "0.0"} ({p.reviews_count}) · {p.jobs_completed} jobs · payouts {p.payouts_enabled ? "✅" : "—"}</Text>
          <View style={styles.actions}>
            {p.status !== "verified" && (
              <Pressable testID={`proacct-verify-${p.user_id}`} style={[styles.btn, styles.btnOk]} onPress={() => act(p.user_id, "verify")}>
                <MaterialCommunityIcons name="shield-check" size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Verify</Text>
              </Pressable>
            )}
            {p.status !== "banned" && (
              <Pressable testID={`proacct-ban-${p.user_id}`} style={styles.btn} onPress={() => act(p.user_id, "ban")}>
                <MaterialCommunityIcons name="account-cancel-outline" size={15} color={colors.error} /><Text style={[styles.btnText, { color: colors.error }]}>Ban</Text>
              </Pressable>
            )}
          </View>
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
  filterActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  filterText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  filterTextActive: { color: colors.surface },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  bio: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17, marginVertical: 2 },
  credRow: { flexDirection: "row", gap: spacing.md, marginVertical: 2 },
  cred: { flexDirection: "row", alignItems: "center", gap: 3 },
  credText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  btnText: { fontFamily: font.bold, fontSize: type.sm },
});
