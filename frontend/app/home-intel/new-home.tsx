import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Item = { key: string; label: string; auto: boolean; route: string | null; done: boolean };

const HINTS: Record<string, string> = {
  add_address: "So Homie knows your climate, codes & local context.",
  locate_water_shutoff: "Usually near the water meter, basement wall or crawl space. Know it before you need it.",
  locate_electrical_panel: "Garage, basement or utility closet. Check that circuits are labeled.",
  test_smoke_co: "Press the test button on each alarm. Replace batteries if the chirp is weak.",
  document_hvac: "Snap the model plate on your furnace/AC so Homie can track filters & service.",
  add_appliances: "Water heater, fridge, washer — Homie tracks age, manuals & recalls.",
  upload_inspection: "Homie turns inspection findings into a prioritized project list.",
  maintenance_calendar: "Seasonal tasks matched to your home — never miss a filter or gutter again.",
};

export default function NewHomeownerPathway() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: Item[]; progress: number }>("/hi/start/new-homeowner");
      setItems(d.items); setProgress(d.progress);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (it: Item) => {
    const next = !it.done;
    setItems((prev) => prev.map((p) => (p.key === it.key ? { ...p, done: next } : p)));
    try { await api("/hi/start/new-homeowner/toggle", { method: "POST", body: { key: it.key, done: next } }); load(); } catch { load(); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Your New Home" />
      {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
          <Text style={styles.h1}>Welcome home 🏡</Text>
          <Text style={styles.sub}>No rush — these first steps help you know your home and stay safe. Homie will guide each one.</Text>

          <View style={styles.progressCard}>
            <Text style={styles.progressText}>{progress}% set up</Text>
            <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
          </View>

          {items.map((it) => (
            <View key={it.key} testID={`nh-item-${it.key}`} style={styles.row}>
              <Pressable testID={`nh-toggle-${it.key}`} onPress={() => toggle(it)} hitSlop={8} style={styles.checkTap}>
                <MaterialCommunityIcons name={it.done ? "check-circle" : "checkbox-blank-circle-outline"} size={24} color={it.done ? colors.success : colors.onSurfaceTertiary} />
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => (it.route ? router.push(it.route as any) : toggle(it))}>
                <Text style={[styles.rowTitle, it.done && styles.rowDone]}>{it.label}</Text>
                <Text style={styles.rowHint}>{HINTS[it.key]}</Text>
              </Pressable>
              {it.route && <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />}
            </View>
          ))}

          <Pressable testID="nh-ask-homie" style={styles.askCard} onPress={() => router.push("/home-intel/start")}>
            <MaterialCommunityIcons name="chat-question-outline" size={22} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.askTitle}>Not sure where to start?</Text>
              <Text style={styles.askSub}>Tell Homie about your home and get a first priority list.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.brandPrimary} />
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  h1: { fontFamily: font.display, fontSize: type["3xl"], color: colors.onSurface },
  sub: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceTertiary, marginTop: spacing.xs },
  progressCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.md },
  progressText: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  track: { height: 8, backgroundColor: colors.surfaceTertiary, borderRadius: 4, marginTop: spacing.sm },
  fill: { height: 8, backgroundColor: colors.brandPrimary, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm, minHeight: 64 },
  checkTap: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: font.medium, fontSize: type.lg, color: colors.onSurface },
  rowDone: { color: colors.onSurfaceTertiary, textDecorationLine: "line-through" },
  rowHint: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  askCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.xl },
  askTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  askSub: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
