import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState } from "@/src/components/ui";

const KIND_META: Record<string, { icon: string; color: string; label: string }> = {
  safety: { icon: "alert-decagram", color: colors.error, label: "Safety" },
  follow_up: { icon: "eye-check-outline", color: colors.warning, label: "Follow-up" },
  project: { icon: "hammer-wrench", color: colors.brandPrimary, label: "Project" },
  maintenance: { icon: "calendar-check-outline", color: colors.success, label: "Maintenance" },
};
const STATE_LABEL: Record<string, string> = {
  needs_attention: "Needs attention", in_progress: "In progress", waiting_verification: "Waiting on verification",
  paused: "Paused", professional_review: "Professional review", monitoring: "Monitoring", completed: "Completed",
};
const FOCUS = ["balanced", "safety", "maintenance", "projects"];

export default function CommandCenter() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<any>("/hi/command/dashboard")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = async (item: any) => {
    if (item.issue_id) {
      try {
        const r = await api<any>(`/hi/command/resume/${item.issue_id}`);
        const b = r.briefing;
        if (b.long_pause) {
          Alert.alert("Quick refresher before you resume", `${b.what_was_happening}\n\n${b.what_changed}\n\nStill required: ${b.still_required}${b.safety_boundary ? `\n\n⚠️ ${b.safety_boundary}` : ""}`,
            [{ text: "Cancel", style: "cancel" }, { text: "Resume", onPress: () => router.push(b.route as any) }]);
          return;
        }
      } catch {}
    }
    router.push(item.route as any);
  };

  const itemAction = async (item: any, action: string) => {
    setBusy(item.key + action);
    try { await api("/hi/command/items/action", { method: "POST", body: { item_key: item.key, action } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || ""); }
    finally { setBusy(""); }
  };

  const setFocus = async (focus: string) => {
    setBusy("focus");
    try { await api("/hi/command/preferences", { method: "PUT", body: { focus } }); await load(); }
    catch {} finally { setBusy(""); }
  };

  const PriorityCard = ({ item, primary }: { item: any; primary?: boolean }) => {
    const m = KIND_META[item.kind] || KIND_META.project;
    return (
      <View testID={`cc-item-${item.key}`} style={[styles.prioCard, primary && styles.prioPrimary, item.kind === "safety" && { borderColor: colors.error }]}>
        <View style={styles.prioHead}>
          <View style={[styles.kindChip, { borderColor: m.color, backgroundColor: m.color + "18" }]}>
            <MaterialCommunityIcons name={m.icon as any} size={13} color={m.color} />
            <Text style={[styles.kindText, { color: m.color }]}>{m.label}</Text>
          </View>
          {primary ? <Text style={styles.doNextTag}>DO NEXT</Text> : null}
        </View>
        <Text style={styles.prioTitle}>{item.title}</Text>
        <Text style={styles.prioDetail}>{item.detail}</Text>
        <Text style={styles.prioWhy}>Why: {item.why}</Text>
        <View style={styles.prioActions}>
          <Pressable testID={`cc-start-${item.key}`} onPress={() => open(item)} style={[styles.btn, styles.btnPrimary]}><Text style={styles.btnPrimaryText}>{item.kind === "safety" ? "Review now" : "Start"}</Text></Pressable>
          {item.can_defer ? (
            <>
              <Pressable testID={`cc-defer-${item.key}`} onPress={() => itemAction(item, "defer")} style={styles.btn}>
                {busy === item.key + "defer" ? <ActivityIndicator size="small" color={colors.onSurfaceSecondary} /> : <Text style={styles.btnText}>Later</Text>}
              </Pressable>
              <Pressable testID={`cc-dismiss-${item.key}`} onPress={() => itemAction(item, "dismiss")} style={styles.btn}><Text style={styles.btnText}>Dismiss</Text></Pressable>
            </>
          ) : null}
        </View>
      </View>
    );
  };

  const s = data?.summary;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="cc-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Command Center</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : !data ? null : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          {/* Home health summary */}
          <View style={styles.sumRow}>
            {[["Urgent", s?.urgent_count, s?.urgent_count ? colors.error : colors.success],
              ["Active", s?.active_projects, colors.brandPrimary],
              ["Maint. due", s?.maintenance_due, colors.warning],
              ["Follow-ups", s?.open_followups, colors.info]].map(([label, val, color]: any) => (
              <View key={label} style={styles.sumCard}>
                <Text style={[styles.sumVal, { color }]}>{val ?? 0}</Text>
                <Text style={styles.sumLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {/* Urgent — every one visible, never hidden behind a single card */}
          {data.urgent?.length > 1 ? data.urgent.map((u: any) => <PriorityCard key={u.key} item={u} primary />) : null}

          {/* Do next */}
          {data.calm ? (
            <View testID="cc-calm" style={styles.calmCard}>
              <MaterialCommunityIcons name="home-heart" size={28} color={colors.success} />
              <Text style={styles.calmText}>{data.calm_message}</Text>
            </View>
          ) : data.urgent?.length <= 1 && data.do_next ? (
            <PriorityCard item={data.do_next} primary />
          ) : null}

          {/* Top priorities */}
          {data.top_priorities?.length ? (
            <>
              <Text style={styles.sectionTitle}>Also worth your attention</Text>
              {data.top_priorities.map((p: any) => <PriorityCard key={p.key} item={p} />)}
            </>
          ) : null}

          {/* Focus personalization */}
          <Text style={styles.sectionTitle}>Focus</Text>
          <View style={styles.focusRow}>
            {FOCUS.map((f) => (
              <Pressable key={f} testID={`cc-focus-${f}`} onPress={() => setFocus(f)} style={[styles.focusChip, data.preferences?.focus === f && styles.focusOn]}>
                <Text style={[styles.focusText, data.preferences?.focus === f && styles.focusTextOn]}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Focus reorders suggestions — safety always stays on top.</Text>

          {/* Portfolio */}
          <Text style={styles.sectionTitle}>Your projects</Text>
          {Object.keys(STATE_LABEL).map((state) => {
            const rows = data.portfolio?.[state] || [];
            if (!rows.length) return null;
            return (
              <View key={state} style={{ gap: spacing.sm }}>
                <Text style={styles.stateTitle}>{STATE_LABEL[state]} ({rows.length})</Text>
                {rows.slice(0, state === "completed" ? 3 : 6).map((p: any) => (
                  <Pressable key={p.issue_id} testID={`cc-proj-${p.issue_id}`} onPress={() => open({ issue_id: p.issue_id, route: p.route })} style={styles.projCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.projTitle} numberOfLines={1}>{p.pinned ? "📌 " : ""}{p.title}</Text>
                      <Text style={styles.projMeta} numberOfLines={1}>{p.current_task ? `Next: ${p.current_task.title}` : (p.phase || "").replace(/_/g, " ").toLowerCase()}</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
                  </Pressable>
                ))}
              </View>
            );
          })}

          {/* Recent activity */}
          {data.recent_activity?.length ? (
            <>
              <Text style={styles.sectionTitle}>Recent home activity</Text>
              {data.recent_activity.map((a: any) => (
                <View key={a.id} style={styles.actRow}>
                  <MaterialCommunityIcons name="history" size={15} color={colors.onSurfaceTertiary} />
                  <Text style={styles.actText} numberOfLines={2}>{a.title}</Text>
                  <Text style={styles.actDate}>{(a.created_at || "").slice(0, 10)}</Text>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerTitle: { fontFamily: font.display, fontSize: type.xl, color: colors.onSurface, letterSpacing: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  sumRow: { flexDirection: "row", gap: spacing.sm },
  sumCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  sumVal: { fontFamily: font.display, fontSize: type.xl },
  sumLabel: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary },
  calmCard: { alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.border },
  calmText: { fontFamily: font.medium, fontSize: type.base, color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  prioCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: colors.border },
  prioPrimary: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  prioHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kindChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  kindText: { fontFamily: font.medium, fontSize: 11 },
  doNextTag: { fontFamily: font.bold, fontSize: 10, color: colors.brandPrimary, letterSpacing: 1 },
  prioTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  prioDetail: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary },
  prioWhy: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  prioActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  btnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnPrimaryText: { fontFamily: font.bold, fontSize: type.sm, color: colors.onBrandPrimary },
  btnText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  sectionTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface, marginTop: spacing.sm },
  focusRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  focusChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  focusOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  focusText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary, textTransform: "capitalize" },
  focusTextOn: { color: colors.onBrandTertiary },
  hint: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  stateTitle: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  projCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  projTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  projMeta: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  actRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  actText: { flex: 1, fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary },
  actDate: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary },
});
