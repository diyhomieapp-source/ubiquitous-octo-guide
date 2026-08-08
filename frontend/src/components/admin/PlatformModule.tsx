import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function PlatformModule() {
  const [tab, setTab] = useState<"domains" | "standards" | "events">("domains");
  const [domains, setDomains] = useState<any[]>([]);
  const [rule, setRule] = useState("");
  const [standards, setStandards] = useState<any>(null);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s, e] = await Promise.all([
        api<any>("/hi/admin/platform/domains"),
        api<any>("/hi/admin/platform/api-standards"),
        api<any>("/hi/admin/platform/events"),
      ]);
      setDomains(d.domains || []); setRule(d.ownership_rule || "");
      setStandards(s.standards || null); setEventTypes(s.event_types || []);
      setEvents(e.events || []); setCounts(e.counts_by_type || {});
    } catch (err: any) { Alert.alert("Load failed", err?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading || !standards) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Platform Architecture</Text>
        <Pressable testID="plat-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>
      <Text style={styles.note}>{rule}</Text>

      <View style={styles.tabs}>{(["domains", "standards", "events"] as const).map((t) => (
        <Pressable key={t} testID={`plat-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
          <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text>
        </Pressable>
      ))}</View>

      {tab === "domains" && domains.map((d) => (
        <View key={d.domain} style={styles.card}>
          <Text style={styles.rTitle}>{d.domain}</Text>
          <Text style={styles.rMeta}>Owns: {(d.owns || []).join(", ")}</Text>
          {d.references?.length ? <Text style={styles.rMeta}>References: {d.references.join(", ")}</Text> : null}
        </View>
      ))}

      {tab === "standards" && (
        <>
          <View style={styles.card}>
            <Text style={styles.rTitle}>Required contract fields</Text>
            <Text style={styles.rMeta}>{(standards.required_fields || []).join(" · ")}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.rTitle}>Error codes</Text>
            <Text style={styles.rMeta}>{(standards.error_codes || []).join(" · ")}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.rTitle}>Extraction candidates</Text>
            <Text style={styles.rMeta}>{(standards.extraction_candidates || []).join(" · ")}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.rTitle}>Domain event types ({eventTypes.length})</Text>
            <Text style={styles.rMeta}>{eventTypes.join(" · ")}</Text>
          </View>
        </>
      )}

      {tab === "events" && (
        Object.keys(counts).length === 0 && events.length === 0
          ? <Text style={styles.note}>No domain events recorded yet. Engines emit events via emit_event().</Text>
          : (
            <>
              {Object.keys(counts).length ? (
                <View style={styles.card}>
                  <Text style={styles.rTitle}>Counts by type</Text>
                  {Object.entries(counts).map(([k, v]) => <Text key={k} style={styles.rMeta}>{k}: {v}</Text>)}
                </View>
              ) : null}
              {events.map((e) => (
                <View key={e.event_id} style={styles.card}>
                  <Text style={styles.rTitle}>{e.event_type}</Text>
                  <Text style={styles.rMeta}>{e.domain} · {e.entity_id} · {e.actor_type}</Text>
                  <Text style={styles.rMeta}>{e.occurred_at}</Text>
                </View>
              ))}
            </>
          )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  tabTextOn: { color: colors.brandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
