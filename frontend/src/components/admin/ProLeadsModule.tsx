import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Lead = {
  id: string; name: string; email: string; trade: string; issue: string;
  location: string; urgency: string; status: string; created_at: string;
};

const STATUSES = ["new", "contacted", "matched", "closed"];
const STATUS_COLOR: Record<string, string> = {
  new: colors.brandPrimary, contacted: colors.info, matched: colors.success, closed: colors.onSurfaceTertiary,
};
const URGENCY_COLOR: Record<string, string> = {
  emergency: colors.error, standard: colors.warning, planning: colors.onSurfaceTertiary,
};

export function ProLeadsModule() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try { const r = await api<{ items: Lead[] }>("/admin/pro-leads"); setLeads(r.items); }
    catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (id: string, status: string) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    try { await api(`/admin/pro-leads/${id}`, { method: "PATCH", body: { status } }); } catch { load(); }
  };

  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  const openCount = leads.filter((l) => l.status === "new").length;

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Pro Referral Leads</Text>
      <Text style={styles.sub}>{leads.length} total · {openCount} new · escalated jobs above DIY.</Text>

      <View style={styles.filterRow}>
        {["all", ...STATUSES].map((s) => (
          <Pressable key={s} testID={`proleads-filter-${s}`} style={[styles.filter, filter === s && styles.filterActive]} onPress={() => setFilter(s)}>
            <Text style={[styles.filterText, filter === s && styles.filterTextActive]}>{s.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {shown.length === 0 ? (
        <View style={styles.empty}><MaterialCommunityIcons name="account-hard-hat-outline" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No leads here yet.</Text></View>
      ) : shown.map((l) => (
        <View key={l.id} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.tradeBadge}><Text style={styles.tradeText}>{l.trade}</Text></View>
            <View style={[styles.urgency, { backgroundColor: (URGENCY_COLOR[l.urgency] || colors.onSurfaceTertiary) + "22" }]}>
              <Text style={[styles.urgencyText, { color: URGENCY_COLOR[l.urgency] || colors.onSurfaceTertiary }]}>{l.urgency}</Text>
            </View>
          </View>
          <Text style={styles.issue}>{l.issue}</Text>
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="account-outline" size={14} color={colors.onSurfaceTertiary} />
            <Text style={styles.meta}>{l.name} · {l.email}</Text>
          </View>
          {!!l.location && (
            <View style={styles.metaRow}>
              <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.onSurfaceTertiary} />
              <Text style={styles.meta}>{l.location}</Text>
            </View>
          )}
          <View style={styles.statusRow}>
            {STATUSES.map((s) => (
              <Pressable key={s} testID={`proleads-${l.id}-${s}`} style={[styles.statusChip, l.status === s && { backgroundColor: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] }]} onPress={() => setStatus(l.id, s)}>
                <Text style={[styles.statusChipText, l.status === s && { color: colors.onBrandPrimary }]}>{s}</Text>
              </Pressable>
            ))}
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
  tradeBadge: { backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  tradeText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },
  urgency: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  urgencyText: { fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  issue: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginVertical: spacing.xs, lineHeight: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  statusRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  statusChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  statusChipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
});
