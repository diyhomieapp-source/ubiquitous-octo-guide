import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { useAuth } from "@/src/auth";
import { registerForPush } from "@/src/utils/push";

type Row = { id: string; title: string; category: string; priority: string; due_date: string; asset_name?: string | null };
type Feed = { overdue: Row[]; due_today: Row[]; this_week: Row[]; counts: { overdue: number; due_today: number; this_week: number; badge: number }; headline: string };
type Prefs = { push_enabled: boolean; digest_frequency: string };

const PRIORITY_COLOR: Record<string, string> = { high: colors.error, medium: colors.warning, low: colors.info };
const FREQS = [{ k: "off", l: "Off" }, { k: "daily", l: "Daily" }, { k: "weekly", l: "Weekly" }];

function Group({ title, rows, color, onPress }: { title: string; rows: Row[]; color: string; onPress: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <>
      <Text style={styles.section}>{title}</Text>
      {rows.map((t) => (
        <Pressable key={t.id} testID={`rem-${t.id}`} style={styles.row} onPress={() => onPress(t.id)}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
            <Text style={styles.meta} numberOfLines={1}>{t.category}{t.asset_name ? ` · ${t.asset_name}` : ""} · due {t.due_date}</Text>
          </View>
          <View style={[styles.pill, { borderColor: PRIORITY_COLOR[t.priority] || colors.border }]}>
            <Text style={[styles.pillText, { color: PRIORITY_COLOR[t.priority] || colors.onSurfaceTertiary }]}>{t.priority}</Text>
          </View>
        </Pressable>
      ))}
    </>
  );
}

export default function Reminders() {
  const router = useRouter();
  const { user } = useAuth();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([api<Feed>("/hi/reminders/feed"), api<Prefs>("/hi/reminders/preferences")]);
      setFeed(f); setPrefs(p);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const savePrefs = async (patch: Partial<Prefs>) => {
    setSaving(true);
    try { const p = await api<Prefs>("/hi/reminders/preferences", { method: "PUT", body: patch }); setPrefs(p); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  const togglePush = async () => {
    if (!prefs) return;
    const next = !prefs.push_enabled;
    if (next && Platform.OS !== "web" && user?.id) {
      const res = await registerForPush(user.id);
      if (res.status === "denied") {
        Alert.alert("Notifications are off", "Enable notifications for DIYhomie in your device Settings to get reminders.");
        return;
      }
    }
    await savePrefs({ push_enabled: next });
    if (next) Alert.alert("Reminders on", Platform.OS === "web"
      ? "In-app reminders are on. Phone alerts work after you install the built app."
      : "You'll get home-care reminders. (Lock-screen alerts require the published app build.)");
  };

  const testPush = async () => {
    try {
      const r = await api<{ sent: boolean; note?: string }>("/hi/reminders/test-push", { method: "POST" });
      Alert.alert(r.sent ? "Sent 🔔" : "Not delivered", r.sent ? "Check your notifications." : (r.note || "Push works after a native build."));
    } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Reminders" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          <>
            <View style={styles.headlineCard}>
              <MaterialCommunityIcons name="bell-ring-outline" size={22} color={colors.brandPrimary} />
              <Text style={styles.headline}>{feed?.headline}</Text>
            </View>

            <View style={styles.prefCard}>
              <View style={styles.prefRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prefTitle}>Reminder notifications</Text>
                  <Text style={styles.prefSub}>Get nudged about due &amp; overdue tasks</Text>
                </View>
                <Pressable testID="rem-push-toggle" style={[styles.toggle, prefs?.push_enabled && styles.toggleOn]} disabled={saving} onPress={togglePush}>
                  <Text style={[styles.toggleText, prefs?.push_enabled && { color: colors.onBrandPrimary }]}>{prefs?.push_enabled ? "ON" : "OFF"}</Text>
                </Pressable>
              </View>
              {prefs?.push_enabled && (
                <>
                  <Text style={[styles.prefSub, { marginTop: spacing.md, marginBottom: spacing.xs }]}>Digest frequency</Text>
                  <View style={styles.chips}>
                    {FREQS.map((f) => (
                      <Pressable key={f.k} testID={`rem-freq-${f.k}`} style={[styles.chip, prefs?.digest_frequency === f.k && styles.chipOn]} onPress={() => savePrefs({ digest_frequency: f.k })}>
                        <Text style={[styles.chipText, prefs?.digest_frequency === f.k && styles.chipTextOn]}>{f.l}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable testID="rem-test-push" style={styles.testBtn} onPress={testPush}>
                    <MaterialCommunityIcons name="bell-check-outline" size={16} color={colors.brandPrimary} />
                    <Text style={styles.testText}>Send a test notification</Text>
                  </Pressable>
                </>
              )}
            </View>

            {feed && feed.counts.badge === 0 && feed.counts.this_week === 0 ? (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="check-circle-outline" size={40} color={colors.success} />
                <Text style={styles.emptyText}>Nothing needs your attention right now. Nice work keeping the home in shape!</Text>
              </View>
            ) : (
              <>
                <Group title="Overdue" rows={feed?.overdue || []} color={colors.error} onPress={(id) => router.push(`/home-intel/maintenance/${id}`)} />
                <Group title="Due today" rows={feed?.due_today || []} color={colors.warning} onPress={(id) => router.push(`/home-intel/maintenance/${id}`)} />
                <Group title="This week" rows={feed?.this_week || []} color={colors.info} onPress={(id) => router.push(`/home-intel/maintenance/${id}`)} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  headlineCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  headline: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, lineHeight: 20 },
  prefCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  prefRow: { flexDirection: "row", alignItems: "center" },
  prefTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  prefSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  toggle: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, minWidth: 56, alignItems: "center" },
  toggleOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  toggleText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  testBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  testText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  pillText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  empty: { alignItems: "center", gap: spacing.md, marginTop: spacing["2xl"], paddingHorizontal: spacing.lg },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 22 },
});
