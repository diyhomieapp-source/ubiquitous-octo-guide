import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Switch, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CAT_LABEL: Record<string, string> = {
  safety: "Safety alerts", maintenance: "Maintenance reminders", project: "Project updates",
  document: "Document updates", collaboration: "Collaboration", billing: "Account & billing",
  rewards: "Rewards", account: "Account & security", product: "Product updates", marketing: "Marketing & promotions",
};
const CH_LABEL: Record<string, string> = { in_app: "In-app", push: "Push", email: "Email" };
const ORDER = ["safety", "account", "billing", "maintenance", "project", "collaboration", "document", "rewards", "product", "marketing"];

export default function NotificationSettings() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api("/hi/notifications/preferences")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (category: string, channel: string, enabled: boolean) => {
    setBusy(true);
    try {
      const res = await api("/hi/notifications/preferences", { method: "PUT", body: { category, channel, enabled } });
      setData((d: any) => ({ ...d, matrix: res.matrix }));
    } catch (e: any) { Alert.alert("Can't change this", e?.message || "Try again."); load(); } finally { setBusy(false); }
  };

  const setConsent = async (enabled: boolean) => {
    setBusy(true);
    try { await api("/hi/notifications/preferences/marketing-consent", { method: "POST", body: { enabled } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Notifications" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const essential = new Set(data.essential || []);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Notifications" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.intro}>Choose what DIYhomie can send you and where. Safety, security and billing alerts stay on to protect you.</Text>

        {ORDER.map((cat) => (
          <View key={cat} style={styles.card}>
            <View style={styles.catHead}>
              <Text style={styles.catTitle}>{CAT_LABEL[cat]}</Text>
              {essential.has(cat) ? <View style={styles.essTag}><Text style={styles.essText}>ESSENTIAL</Text></View> : null}
            </View>
            {cat === "marketing" ? (
              <View style={styles.channelRow}>
                <Text style={styles.chLabel}>I agree to receive marketing</Text>
                <Switch testID="notif-marketing-consent" value={!!data.marketing_consent} onValueChange={setConsent} trackColor={{ true: colors.brandPrimary }} />
              </View>
            ) : (
              ["in_app", "push", "email"].map((ch) => (
                <View key={ch} style={styles.channelRow}>
                  <Text style={styles.chLabel}>{CH_LABEL[ch]}</Text>
                  <Switch
                    testID={`notif-${cat}-${ch}`}
                    value={!!data.matrix?.[cat]?.[ch]}
                    disabled={busy || (cat === "safety" && ch === "in_app")}
                    onValueChange={(v) => toggle(cat, ch, v)}
                    trackColor={{ true: colors.brandPrimary }}
                  />
                </View>
              ))
            )}
          </View>
        ))}

        <View style={styles.quiet}>
          <MaterialCommunityIcons name="moon-waning-crescent" size={16} color={colors.onSurfaceTertiary} />
          <Text style={styles.quietText}>Quiet hours: {data.quiet_hours?.start}:00–{data.quiet_hours?.end}:00. During quiet hours we hold non-urgent push & email; your inbox still updates silently.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  catHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  catTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  essTag: { borderColor: colors.onSurfaceTertiary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  essText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 8, letterSpacing: 0.5 },
  channelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  chLabel: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm },
  quiet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginTop: spacing.md },
  quietText: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16 },
});
