import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState, EmptyState } from "@/src/components/ui";

const EVENT_META: Record<string, { icon: string; color: string }> = {
  issue_reported: { icon: "clipboard-text-outline", color: colors.onSurfaceTertiary },
  assessment_created: { icon: "magnify", color: colors.brandPrimary },
  repair_started: { icon: "clipboard-list-outline", color: colors.brandPrimary },
  project_outcome: { icon: "flag-checkered", color: colors.success },
  follow_up: { icon: "bell-ring-outline", color: colors.warning },
  follow_up_completed: { icon: "check-circle-outline", color: colors.success },
  project_reopened: { icon: "refresh", color: colors.warning },
};

export default function RecordHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [dash, setDash] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([api<any>("/hi/record/dashboard"), api<any>("/hi/record/timeline")]);
      setDash(d); setEvents(t.events || []);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const fuAction = async (fid: string, action: string) => {
    try { await api(`/hi/record/followups/${fid}/action`, { method: "POST", body: { action } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || ""); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="rec-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Home Record</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <LoadingState /> : dash?.empty ? (
        <EmptyState icon="history" title="Your home memory starts here" message="As you complete repairs, DIYhomie keeps a private record of what was done, what worked, and what to watch — so future projects start smarter." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          {/* Counts */}
          <View style={styles.countRow}>
            {[["open_issues", "Open"], ["in_progress", "Active"], ["completed", "Done"], ["followups_due", "Due"]].map(([k, lbl]) => (
              <View key={k} style={styles.countCard}>
                <Text style={styles.countNum}>{dash?.counts?.[k] ?? 0}</Text>
                <Text style={styles.countLbl}>{lbl}</Text>
              </View>
            ))}
          </View>

          {/* Follow-ups due */}
          {dash?.followups_due?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Follow-ups due</Text>
              {dash.followups_due.map((f: any) => (
                <View key={f.id} testID={`rec-fu-${f.id}`} style={styles.fuCard}>
                  <MaterialCommunityIcons name="bell-ring-outline" size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fuText}>{f.what}</Text>
                    <View style={styles.fuActions}>
                      <Pressable testID={`rec-fu-done-${f.id}`} onPress={() => fuAction(f.id, "complete")} style={styles.fuBtn}><Text style={styles.fuBtnText}>Done</Text></Pressable>
                      <Pressable testID={`rec-fu-snooze-${f.id}`} onPress={() => fuAction(f.id, "snooze")} style={styles.fuBtn}><Text style={styles.fuBtnText}>Snooze</Text></Pressable>
                      <Pressable testID={`rec-fu-dismiss-${f.id}`} onPress={() => fuAction(f.id, "dismiss")} style={styles.fuBtn}><Text style={styles.fuBtnText}>Dismiss</Text></Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Open issues */}
          {dash?.open_issues?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Open projects</Text>
              {dash.open_issues.map((i: any) => (
                <Pressable key={i.id} testID={`rec-issue-${i.id}`} style={styles.openCard} onPress={() => router.push(`/home-intel/repair/${i.id}` as any)}>
                  <Text style={styles.openText} numberOfLines={1}>{i.description}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Timeline */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            {events.length === 0 ? <Text style={styles.empty}>No activity yet.</Text> : events.slice(0, 40).map((e) => {
              const m = EVENT_META[e.type] || { icon: "circle-small", color: colors.onSurfaceTertiary };
              return (
                <Pressable key={e.id} style={styles.evRow} onPress={() => e.issue_id && router.push(`/home-intel/repair/${e.issue_id}` as any)}>
                  <MaterialCommunityIcons name={m.icon as any} size={18} color={m.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.evTitle} numberOfLines={2}>{e.title}</Text>
                    <Text style={styles.evProv}>{(e.provenance || "").replace("_", " ")}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
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
  countRow: { flexDirection: "row", gap: spacing.sm },
  countCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  countNum: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  countLbl: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11, marginTop: 2 },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.sm },
  fuCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  fuText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  fuActions: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  fuBtn: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  fuBtnText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 12 },
  openCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  openText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  evRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  evTitle: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 19 },
  evProv: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, marginTop: 1, textTransform: "capitalize" },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, paddingVertical: spacing.md },
});
