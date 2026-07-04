import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Lead = {
  id: string; name: string; email: string; trade: string; issue: string;
  location: string; urgency: string; status: string; created_at: string;
  pro_name?: string | null; project_summary?: string;
};
type Partner = {
  id: string; name: string; trades: string[]; specialties: string[]; location: string;
  rating: number; reviews_count: number; verified: boolean; active: boolean; leads_count: number; email: string; bio: string;
};

const STATUSES = ["new", "contacted", "matched", "closed"];
const STATUS_COLOR: Record<string, string> = {
  new: colors.brandPrimary, contacted: colors.info, matched: colors.success, closed: colors.onSurfaceTertiary,
};
const URGENCY_COLOR: Record<string, string> = {
  emergency: colors.error, standard: colors.warning, planning: colors.onSurfaceTertiary,
};

export function ProLeadsModule() {
  const [tab, setTab] = useState<"leads" | "partners">("leads");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([
        api<{ items: Lead[] }>("/admin/pro-leads"),
        api<{ items: Partner[] }>("/admin/pros"),
      ]);
      setLeads(l.items); setPartners(p.items);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (id: string, status: string) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    try { await api(`/admin/pro-leads/${id}`, { method: "PATCH", body: { status } }); } catch { load(); }
  };

  const savePartner = async (p: Partner, patch: Partial<Partner>) => {
    const next = { ...p, ...patch };
    setPartners((ps) => ps.map((x) => (x.id === p.id ? next : x)));
    try {
      await api(`/admin/pros/${p.id}`, { method: "PATCH", body: {
        name: next.name, trades: next.trades, specialties: next.specialties, location: next.location,
        bio: next.bio, email: next.email, rating: next.rating, verified: next.verified, active: next.active,
      } });
    } catch { load(); }
  };
  const removePartner = async (id: string) => {
    setPartners((ps) => ps.filter((x) => x.id !== id));
    try { await api(`/admin/pros/${id}`, { method: "DELETE" }); } catch { load(); }
  };

  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  const openCount = leads.filter((l) => l.status === "new").length;
  const pending = partners.filter((p) => !p.verified).length;

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Marketplace</Text>
      <Text style={styles.sub}>{openCount} new leads · {partners.length} pros · {pending} pending approval.</Text>

      <View style={styles.tabs}>
        <Pressable testID="proleads-tab-leads" style={[styles.tab, tab === "leads" && styles.tabActive]} onPress={() => setTab("leads")}>
          <Text style={[styles.tabText, tab === "leads" && styles.tabTextActive]}>Leads</Text>
        </Pressable>
        <Pressable testID="proleads-tab-partners" style={[styles.tab, tab === "partners" && styles.tabActive]} onPress={() => setTab("partners")}>
          <Text style={[styles.tabText, tab === "partners" && styles.tabTextActive]}>Partners</Text>
        </Pressable>
      </View>

      {tab === "leads" ? (
        <>
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
              {!!l.pro_name && <Text style={styles.reqPro}>Requested: {l.pro_name}</Text>}
              {!!l.project_summary && <Text style={styles.summary} numberOfLines={3}>📋 {l.project_summary}</Text>}
              <View style={styles.metaRow}><MaterialCommunityIcons name="account-outline" size={14} color={colors.onSurfaceTertiary} /><Text style={styles.meta}>{l.name} · {l.email}</Text></View>
              {!!l.location && <View style={styles.metaRow}><MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.onSurfaceTertiary} /><Text style={styles.meta}>{l.location}</Text></View>}
              <View style={styles.statusRow}>
                {STATUSES.map((s) => (
                  <Pressable key={s} testID={`proleads-${l.id}-${s}`} style={[styles.statusChip, l.status === s && { backgroundColor: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] }]} onPress={() => setStatus(l.id, s)}>
                    <Text style={[styles.statusChipText, l.status === s && { color: colors.onBrandPrimary }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </>
      ) : (
        partners.length === 0 ? (
          <View style={styles.empty}><MaterialCommunityIcons name="domain" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No partners yet.</Text></View>
        ) : partners.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.pName}>{p.name}</Text>
                  {p.verified && <MaterialCommunityIcons name="check-decagram" size={15} color={colors.info} />}
                </View>
                <Text style={styles.meta}>{p.trades.join(", ")} · {p.location || "—"}</Text>
                <Text style={styles.meta}>{p.leads_count} leads · ⭐ {p.rating?.toFixed(1) ?? "0.0"} · {p.email}</Text>
              </View>
              <Pressable testID={`pro-del-${p.id}`} hitSlop={8} onPress={() => removePartner(p.id)}><MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} /></Pressable>
            </View>
            <View style={styles.pActions}>
              <Pressable testID={`pro-verify-${p.id}`} style={[styles.pBtn, p.verified && styles.pBtnOn]} onPress={() => savePartner(p, { verified: !p.verified })}>
                <MaterialCommunityIcons name="shield-check-outline" size={15} color={p.verified ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                <Text style={[styles.pBtnText, p.verified && { color: colors.onBrandPrimary }]}>{p.verified ? "Verified" : "Verify"}</Text>
              </Pressable>
              <Pressable testID={`pro-active-${p.id}`} style={[styles.pBtn, p.active && styles.pBtnOn]} onPress={() => savePartner(p, { active: !p.active })}>
                <MaterialCommunityIcons name={p.active ? "eye-outline" : "eye-off-outline"} size={15} color={p.active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                <Text style={[styles.pBtnText, p.active && { color: colors.onBrandPrimary }]}>{p.active ? "Listed" : "Hidden"}</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  tabs: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabTextActive: { color: colors.surface },
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
  reqPro: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  summary: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17, backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm, marginVertical: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  statusRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  statusChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  statusChipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  pName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  pActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  pBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  pBtnOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pBtnText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
});
