import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function RecommendationsModule() {
  const [dash, setDash] = useState<any>(null);
  const [conversions, setConversions] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([api<any>("/hi/admin/rec/dashboard"), api<any>("/hi/admin/rec/conversions")]);
      setDash(d); setConversions(c);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (p: any) => {
    setBusy(true);
    try { await api(`/hi/admin/rec/partners/${p.id}/${p.status === "active" ? "pause" : "activate"}`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const w = dash.weights;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Product Partners</Text>
        <Pressable testID="rec-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Partners" value={dash.partners.length} />
        <Stat label="Active" value={dash.partners.filter((p: any) => p.status === "active").length} />
        <Stat label="Mismatches" value={dash.reported_mismatches} accent={dash.reported_mismatches > 0} />
        <Stat label="Commission $" value={conversions?.total_commission_approved ?? 0} />
      </View>

      <Text style={styles.section}>Ranking weights (safety-first)</Text>
      <View style={styles.weights}>
        {Object.entries(w).map(([k, v]) => (
          <View key={k} style={styles.wRow}><Text style={styles.wKey}>{k.replace(/_/g, " ")}</Text><Text style={styles.wVal}>{v as number}</Text></View>
        ))}
      </View>
      <Text style={styles.note}>Affiliate weight can never exceed safety weight — enforced server-side.</Text>

      <Text style={styles.section}>Partners</Text>
      {dash.partners.map((p: any) => (
        <View key={p.id} testID={`rec-partner-${p.id}`} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pName}>{p.name}</Text>
              <Text style={styles.pMeta}>{p.partner_type} · reliability {p.reliability_score} · {p.has_commission ? "commission" : "no commission"}</Text>
            </View>
            <View style={[styles.statusTag, { borderColor: p.status === "active" ? colors.success : colors.onSurfaceTertiary }]}>
              <Text style={[styles.statusText, { color: p.status === "active" ? colors.success : colors.onSurfaceTertiary }]}>{p.status}</Text>
            </View>
          </View>
          <Text style={styles.pStats}>{p.catalog_items} items · {p.clicks} clicks · {p.conversions} conversions · {p.reversals} reversed</Text>
          {p.has_commission && !p.disclosure_text && <Text style={styles.warnText}>Missing disclosure — cannot activate.</Text>}
          <Pressable testID={`rec-toggle-${p.id}`} disabled={busy} style={[styles.toggleBtn, { borderColor: p.status === "active" ? colors.error : colors.success }]} onPress={() => toggle(p)}>
            <Text style={[styles.toggleText, { color: p.status === "active" ? colors.error : colors.success }]}>{p.status === "active" ? "Pause partner" : "Activate partner"}</Text>
          </Pressable>
        </View>
      ))}

      <Text style={styles.section}>Conversions ({(conversions?.conversions || []).length})</Text>
      {(conversions?.conversions || []).length === 0 ? <Text style={styles.note}>No partner-confirmed conversions yet. Purchases are only recorded when a partner confirms.</Text> :
        (conversions.conversions).slice(0, 10).map((c: any) => (
          <View key={c.id} style={styles.convRow}>
            <MaterialCommunityIcons name="cash-check" size={15} color={c.status === "reversed" ? colors.error : colors.success} />
            <Text style={styles.convText} numberOfLines={1}>{c.conversion_type} · {c.status} · {c.currency} {c.commission_amount ?? 0} · {c.partner_transaction_reference}</Text>
          </View>
        ))}

      <Text style={styles.note}>DIYhomie never processes retail payments. It hands off to partners and records conversions only from approved partner confirmations.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  weights: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  wRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  wKey: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  wVal: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  pMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  statusTag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  pStats: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.xs },
  warnText: { color: colors.warning, fontFamily: font.medium, fontSize: type.xs, marginTop: 4 },
  toggleBtn: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center", marginTop: spacing.sm },
  toggleText: { fontFamily: font.bold, fontSize: type.sm },
  convRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  convText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.xs, textTransform: "capitalize" },
});
