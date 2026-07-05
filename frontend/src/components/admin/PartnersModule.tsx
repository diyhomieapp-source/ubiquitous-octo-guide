import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Key = { id: string; label: string; environment: string; key: string; active: boolean; call_count: number; owner: string };
type Hook = { id: string; url: string; events: string[]; deliveries: number; failures: number; last_status: number | null; owner: string };
type Data = { keys: Key[]; webhooks: Hook[]; totals: { keys: number; active_keys: number; webhooks: number; api_calls: number; webhook_deliveries: number } };

export function PartnersModule() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setD(await api<Data>("/admin/partners")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !d) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const t = d.totals;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Partner Platform</Text>
      <Text style={styles.sub}>API keys, webhooks & usage across all integrators.</Text>
      <View style={styles.statRow}>
        <Stat value={`${t.active_keys}/${t.keys}`} label="Active keys" />
        <Stat value={String(t.api_calls)} label="API calls" />
        <Stat value={String(t.webhooks)} label="Webhooks" />
        <Stat value={String(t.webhook_deliveries)} label="Deliveries" />
      </View>

      <Text style={styles.section}>API keys</Text>
      {d.keys.length === 0 ? <Text style={styles.empty}>No keys issued yet.</Text> : d.keys.map((k) => (
        <View key={k.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.name}>{k.label}</Text>
            <View style={[styles.tag, { backgroundColor: (k.active ? colors.success : colors.error) + "22" }]}><Text style={[styles.tagText, { color: k.active ? colors.success : colors.error }]}>{k.active ? k.environment : "revoked"}</Text></View>
          </View>
          <Text style={styles.mono}>{k.key}</Text>
          <Text style={styles.meta}>{k.owner} · {k.call_count} calls</Text>
        </View>
      ))}

      <Text style={styles.section}>Webhooks</Text>
      {d.webhooks.length === 0 ? <Text style={styles.empty}>No webhooks registered yet.</Text> : d.webhooks.map((h) => (
        <View key={h.id} style={styles.card}>
          <Text style={styles.name} numberOfLines={1}>{h.url}</Text>
          <Text style={styles.meta}>{h.owner} · {h.events.length} events · {h.deliveries} sent · {h.failures} failed{h.last_status ? ` · last ${h.last_status}` : ""}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  statRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  statValue: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, gap: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  mono: { color: colors.brandPrimary, fontFamily: Platform.select({ ios: "Courier", default: "monospace" }), fontSize: type.sm },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
});
