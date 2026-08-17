import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState, EmptyState } from "@/src/components/ui";

export const CARE_CAT: Record<string, { label: string; color: string; icon: string }> = {
  urgent_review: { label: "Urgent", color: colors.error, icon: "alert-decagram-outline" },
  important_preventive: { label: "Important", color: "#FF6A00", icon: "shield-check-outline" },
  routine_maintenance: { label: "Routine", color: colors.brandPrimary, icon: "wrench-outline" },
  optional_improvement: { label: "Optional", color: colors.onSurfaceTertiary, icon: "star-outline" },
  seasonal_preparation: { label: "Seasonal", color: colors.success, icon: "weather-partly-cloudy" },
  monitoring_follow_up: { label: "Monitor", color: colors.warning, icon: "eye-outline" },
};

export default function CareHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [dash, setDash] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { setDash(await api<any>("/hi/care/dashboard")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const action = async (rec: any, act: string) => {
    if (act === "explain") {
      try {
        const e = await api<any>(`/hi/care/recommendations/action?rec_key=${encodeURIComponent(rec.rec_key)}`, { method: "POST", body: { action: "explain" } });
        Alert.alert(e.title, `${e.why_now}\n\nWhy it matters:\n• ${(e.reason_trace || []).join("\n• ")}${e.consequence_of_delay ? `\n\nIf ignored: ${e.consequence_of_delay}` : ""}${e.safety_boundary ? `\n\n⚠️ ${e.safety_boundary}` : ""}`);
      } catch {}
      return;
    }
    setBusy(rec.rec_key + act);
    try {
      const r = await api<any>(`/hi/care/recommendations/action?rec_key=${encodeURIComponent(rec.rec_key)}`, { method: "POST", body: { action: act } });
      if (act === "start" && r.task) { router.push(`/home-intel/care/task/${r.task.id}` as any); return; }
      await load();
    } catch (e: any) { Alert.alert("Couldn't update", e?.message || ""); } finally { setBusy(""); }
  };

  const Card = ({ rec, primary }: { rec: any; primary?: boolean }) => {
    const c = CARE_CAT[rec.priority_category] || CARE_CAT.routine_maintenance;
    return (
      <View testID={`care-rec-${rec.rec_key}`} style={[styles.card, primary && styles.cardPrimary]}>
        <View style={styles.cardTop}>
          <View style={[styles.catChip, { backgroundColor: c.color + "22", borderColor: c.color }]}>
            <MaterialCommunityIcons name={c.icon as any} size={13} color={c.color} />
            <Text style={[styles.catText, { color: c.color }]}>{c.label}</Text>
          </View>
          <Text style={styles.effort}>{rec.estimated_effort}</Text>
        </View>
        <Text style={styles.cardTitle}>{rec.title}</Text>
        <Text style={styles.cardWhy}>{rec.why_now}</Text>
        {rec.safety_boundary ? <View style={styles.safeRow}><MaterialCommunityIcons name="alert-outline" size={13} color={colors.warning} /><Text style={styles.safeText}>{rec.safety_boundary}</Text></View> : null}
        <View style={styles.actions}>
          <Pressable testID={`care-start-${rec.rec_key}`} onPress={() => action(rec, "start")} style={[styles.btn, styles.btnPrimary]}><Text style={styles.btnPrimaryText}>{rec.subject?.type === "safety" || rec.priority_category === "seasonal_preparation" ? "Start" : "Do it"}</Text></Pressable>
          <Pressable testID={`care-why-${rec.rec_key}`} onPress={() => action(rec, "explain")} style={styles.btn}><Text style={styles.btnText}>Why?</Text></Pressable>
          <Pressable testID={`care-defer-${rec.rec_key}`} onPress={() => action(rec, "defer")} style={styles.btn}><Text style={styles.btnText}>Later</Text></Pressable>
          <Pressable testID={`care-dismiss-${rec.rec_key}`} onPress={() => action(rec, "dismiss")} style={styles.btn}><Text style={styles.btnText}>Not for me</Text></Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="care-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Home Care</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : dash?.empty ? (
        <EmptyState icon="home-heart" title="Nothing urgent right now" message="As DIYhomie learns your home and assets, it'll surface the few maintenance tasks that actually matter — never a generic checklist." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          <Text style={styles.intro}>Here's what matters most for your home right now — not a generic checklist.</Text>
          {dash?.top_actions?.length ? (
            <>
              <Text style={styles.sectionTitle}>Do these first</Text>
              {dash.top_actions.map((rec: any) => <Card key={rec.rec_key} rec={rec} primary />)}
            </>
          ) : null}
          {dash?.monitoring?.length ? (
            <>
              <Text style={styles.sectionTitle}>Monitoring from past projects</Text>
              {dash.monitoring.map((rec: any) => <Card key={rec.rec_key} rec={rec} />)}
            </>
          ) : null}
          {dash?.upcoming_seasonal?.length ? (
            <>
              <Text style={styles.sectionTitle}>Seasonal prep</Text>
              {dash.upcoming_seasonal.map((rec: any) => <Card key={rec.rec_key} rec={rec} />)}
            </>
          ) : null}
          {dash?.deferred?.length ? <Text style={styles.deferred}>{dash.deferred.length} task(s) deferred for later</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  sectionTitle: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardPrimary: { borderColor: colors.brandSecondary },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  catChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  catText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  effort: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11 },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, lineHeight: 20 },
  cardWhy: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  safeRow: { flexDirection: "row", gap: 4, alignItems: "flex-start" },
  safeText: { flex: 1, color: colors.warning, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  btn: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  btnText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 12 },
  btnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnPrimaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 12 },
  deferred: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
});
