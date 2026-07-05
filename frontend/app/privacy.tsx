import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Consent = { status: string; scope: string | null; updated_at: string | null };
type Consents = Record<string, Consent>;
type Ev = { id: string; at: string; event: string; category: string; method: string; path: string; risk_level: string };
type Summary = { category: string; count: number };
type MeResp = { total: number; events: Ev[]; summary: Summary[]; consents: Consents };

const CONSENT_LABELS: Record<string, { label: string; sub: string; icon: any }> = {
  marketing: { label: "Marketing emails", sub: "Tips, offers & product news", icon: "email-outline" },
  analytics: { label: "Usage analytics", sub: "Anonymous product improvement", icon: "chart-line" },
  cookies: { label: "Cookies & tracking", sub: "Session & preference storage", icon: "cookie-outline" },
  data_processing: { label: "Data processing", sub: "Use my data to power features", icon: "cog-outline" },
  personalization: { label: "Personalization", sub: "Tailor guides & recommendations", icon: "account-star-outline" },
};
const CAT_LABELS: Record<string, string> = {
  auth: "Sign-in", project: "Projects", billing: "Billing", consent: "Privacy", admin: "Admin",
  api: "API & Developer", community: "Community", pro: "Pro", expert: "Experts",
  data_rights: "Data rights", freemium: "Plan", general: "General", webhook: "Webhooks",
};
const RISK_COLOR: Record<string, string> = { high: colors.error, medium: colors.warning, low: colors.onSurfaceTertiary };

function ago(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function eventLabel(e: Ev) {
  const map: Record<string, string> = {
    login: "Signed in", register: "Created account", consent_change: "Updated a consent",
    data_export: "Exported your data", data_deletion: "Requested data deletion",
    api_key_created: "Created an API key", resource_delete: "Deleted an item",
    data_transfer: "Transferred data", admin_change: "Admin change",
  };
  if (map[e.event]) return map[e.event];
  const verb = { POST: "Created", PUT: "Updated", PATCH: "Updated", DELETE: "Deleted", GET: "Viewed" }[e.method] || e.method;
  return `${verb} in ${CAT_LABELS[e.category] || e.category}`;
}

export default function Privacy() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<MeResp>("/audit/me?limit=100")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleConsent = async (type: string, next: boolean) => {
    if (!data) return;
    setSavingKey(type);
    // optimistic
    setData({ ...data, consents: { ...data.consents, [type]: { ...data.consents[type], status: next ? "granted" : "revoked" } } });
    try {
      const r = await api<{ consents: Consents }>("/consents", { method: "POST", body: { type, status: next ? "granted" : "revoked" } });
      setData((d) => (d ? { ...d, consents: r.consents } : d));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      Alert.alert("Failed", e?.message || "Try again."); load();
    } finally { setSavingKey(null); }
  };

  const exportTrail = async () => {
    setBusy(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const bundle = await api<any>("/audit/me/export");
      await Clipboard.setStringAsync(JSON.stringify(bundle, null, 2));
      Alert.alert("Activity export ready", `Your full activity trail (${bundle.event_count} events) plus consent history was copied as JSON. Paste it anywhere to keep a record.`);
      load();
    } catch (e: any) { Alert.alert("Export failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="privacy-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Privacy & Activity</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading || !data ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          <View style={styles.pledge}>
            <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.success} />
            <Text style={styles.pledgeText}>Full transparency: every action on your account is logged. You control your consents and can export your entire history anytime.</Text>
          </View>

          <Text style={styles.section}>Consent controls</Text>
          <View style={styles.card}>
            {Object.keys(CONSENT_LABELS).map((k, i) => {
              const c = data.consents[k];
              const meta = CONSENT_LABELS[k];
              const on = c?.status === "granted";
              return (
                <View key={k} style={[styles.consentRow, i > 0 && styles.divider]}>
                  <MaterialCommunityIcons name={meta.icon} size={20} color={colors.onSurfaceSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.consentLabel}>{meta.label}</Text>
                    <Text style={styles.consentSub}>{meta.sub}</Text>
                  </View>
                  {savingKey === k ? <ActivityIndicator color={colors.brandPrimary} /> : (
                    <Switch testID={`consent-${k}`} value={on} onValueChange={(v) => toggleConsent(k, v)}
                      trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.onSurface} />
                  )}
                </View>
              );
            })}
          </View>

          <Text style={styles.section}>How your data is used</Text>
          <View style={styles.summaryWrap}>
            {data.summary.length === 0 ? <Text style={styles.help}>No activity recorded yet.</Text> :
              data.summary.map((s) => (
                <View key={s.category} style={styles.chip}>
                  <Text style={styles.chipCount}>{s.count}</Text>
                  <Text style={styles.chipLabel}>{CAT_LABELS[s.category] || s.category}</Text>
                </View>
              ))}
          </View>

          <Pressable testID="privacy-export" style={styles.actionBtn} onPress={exportTrail} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="download-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.actionText}>Export my activity log (JSON)</Text></>}
          </Pressable>

          <Text style={styles.section}>Recent activity ({data.total})</Text>
          {data.events.length === 0 ? <Text style={styles.help}>Nothing here yet.</Text> :
            data.events.map((e) => (
              <View key={e.id} testID="activity-row" style={styles.evRow}>
                <View style={[styles.dot, { backgroundColor: RISK_COLOR[e.risk_level] || colors.onSurfaceTertiary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.evTitle}>{eventLabel(e)}</Text>
                  <Text style={styles.evMeta}>{CAT_LABELS[e.category] || e.category} · {ago(e.at)}</Text>
                </View>
                {e.risk_level !== "low" && <Text style={[styles.riskTag, { color: RISK_COLOR[e.risk_level] }]}>{e.risk_level}</Text>}
              </View>
            ))}

          <Pressable testID="privacy-data" style={styles.linkBtn} onPress={() => router.push("/data")}>
            <MaterialCommunityIcons name="database-export-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.linkText}>Export, transfer or delete all my data →</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  pledge: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.success + "18", borderRadius: radius.md, padding: spacing.md },
  pledgeText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  consentRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderTopColor: colors.border, borderTopWidth: 1 },
  consentLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  consentSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  summaryWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minWidth: 74 },
  chipCount: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 20 },
  chipLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  actionText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  evRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  evTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  evMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  riskTag: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  linkBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl },
  linkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
