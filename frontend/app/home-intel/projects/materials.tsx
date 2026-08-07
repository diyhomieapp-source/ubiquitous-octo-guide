import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Mat = { id: string; name: string; category: string; quantity: string; unit: string; why: string; user_status: string };
const GROUPS: { key: string; label: string }[] = [
  { key: "material", label: "Materials" }, { key: "tool", label: "Tools" },
  { key: "safety_equipment", label: "Safety Equipment" }, { key: "optional_upgrade", label: "Optional Upgrades" },
];
const STATUSES: { key: string; label: string }[] = [
  { key: "have_it", label: "Have It" }, { key: "need_it", label: "Need It" }, { key: "unsure", label: "Unsure" },
];
const STATUS_COLOR: Record<string, string> = { have_it: colors.success, need_it: colors.warning, unsure: colors.onSurfaceTertiary };

export default function ShoppingList() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [grouped, setGrouped] = useState<Record<string, Mat[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api<{ grouped: Record<string, Mat[]> }>(`/hi/projects/${id}/materials`); setGrouped(d.grouped); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (mid: string, status: string) => {
    // optimistic
    setGrouped((g) => {
      const next: Record<string, Mat[]> = {};
      for (const k of Object.keys(g)) next[k] = g[k].map((m) => m.id === mid ? { ...m, user_status: status } : m);
      return next;
    });
    try { await api(`/hi/projects/materials/${mid}`, { method: "PUT", body: { user_status: status } }); } catch { load(); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Shopping List" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Shopping List" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {GROUPS.map((g) => {
          const items = grouped[g.key] || [];
          if (items.length === 0) return null;
          return (
            <View key={g.key}>
              <Text style={styles.group}>{g.label}</Text>
              {items.map((m) => (
                <View key={m.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.name}>{m.name}</Text>
                    {!!(m.quantity || m.unit) && <Text style={styles.qty}>{m.quantity} {m.unit}</Text>}
                  </View>
                  {!!m.why && <Text style={styles.why}>{m.why}</Text>}
                  <View style={styles.statusRow}>
                    {STATUSES.map((s) => (
                      <Pressable key={s.key} testID={`mat-${m.id}-${s.key}`} style={[styles.statusBtn, m.user_status === s.key && { borderColor: STATUS_COLOR[s.key], backgroundColor: STATUS_COLOR[s.key] + "22" }]} onPress={() => setStatus(m.id, s.key)}>
                        <Text style={[styles.statusText, m.user_status === s.key && { color: STATUS_COLOR[s.key] }]}>{s.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          );
        })}
        <Text style={styles.note}>Tip: mark what you already have to shorten your shopping trip.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  group: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, flex: 1 },
  qty: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  why: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  statusRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  statusBtn: { flex: 1, alignItems: "center", borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 6 },
  statusText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg },
});
