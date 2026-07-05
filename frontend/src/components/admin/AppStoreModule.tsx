import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Integration = { id: string; slug: string; name: string; category: string; pricing: string; status: string; version: number; installs: number };
type Analytics = { total: number; published: number; active_installs: number; paid_installs: number; by_integration: { name: string; installs: number; pricing: string }[] };

export function AppStoreModule() {
  const [items, setItems] = useState<Integration[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, a] = await Promise.all([api<{ integrations: Integration[] }>("/admin/appstore"), api<Analytics>("/admin/appstore/analytics")]);
      setItems(l.integrations); setAnalytics(a);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: string) => {
    try { await api(`/admin/appstore/${id}/toggle`, { method: "POST" }); load(); } catch {}
  };

  if (loading || !analytics) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Integration App Store</Text>
      <Text style={styles.sub}>Add-on catalog, install analytics & zero-code publish.</Text>

      <View style={styles.statRow}>
        <Stat label="Add-ons" value={String(analytics.total)} />
        <Stat label="Published" value={String(analytics.published)} />
        <Stat label="Installs" value={String(analytics.active_installs)} />
        <Stat label="Paid installs" value={String(analytics.paid_installs)} />
      </View>

      <Text style={styles.section}>Catalog</Text>
      {items.map((i) => (
        <View key={i.id} testID="store-admin-row" style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{i.name}</Text>
            <Text style={styles.meta}>{i.category} · {i.pricing} · v{i.version} · {i.installs} installs · {i.status}</Text>
          </View>
          <Pressable testID={`store-toggle-${i.id}`} style={styles.miniBtn} onPress={() => toggle(i.id)}>
            <Text style={styles.miniText}>{i.status === "published" ? "Unpublish" : "Publish"}</Text>
          </Pressable>
        </View>
      ))}

      {analytics.by_integration.length > 0 && (
        <>
          <Text style={styles.section}>Top installed</Text>
          {analytics.by_integration.map((b, idx) => (
            <View key={idx} style={styles.funnelRow}><Text style={styles.funnelLabel} numberOfLines={1}>{b.name} ({b.pricing})</Text><Text style={styles.funnelCount}>{b.installs}</Text></View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 74, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  miniBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  miniText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
  funnelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, borderBottomColor: colors.border, borderBottomWidth: 1 },
  funnelLabel: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  funnelCount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginLeft: spacing.sm },
});
