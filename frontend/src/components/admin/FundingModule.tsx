import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function FundingModule() {
  const [dash, setDash] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([api<any>("/hi/admin/funding/dashboard"), api<any>("/hi/admin/funding/config")]);
      setDash(d); setConfig(c.config); setProviders(c.providers || []);
    } catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: any) => {
    setBusy(true);
    try { const r = await api<any>("/hi/admin/funding/config", { method: "PUT", body }); setConfig(r.config); }
    catch (e: any) { Alert.alert("Update failed", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash || !config) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}><Text style={styles.h1}>Savings & Funding</Text><Pressable testID="fundadm-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable></View>
      <View style={styles.statRow}>
        <Stat label="Confirmed" value={`$${dash.confirmed_customer_savings}`} />
        <Stat label="Cost cut" value={`$${dash.cost_reduction_savings}`} />
        <Stat label="Goals" value={dash.active_goals} />
        <Stat label="Reached" value={`${dash.completion_rate}%`} />
      </View>
      <Text style={styles.note}>Customer value first — internal revenue is tracked separately and never shown to users.</Text>

      <Text style={styles.subhead}>Feature</Text>
      <View style={[styles.card, styles.switchRow]}>
        <Text style={styles.rTitle}>Fund This Project enabled</Text>
        <Switch testID="fundadm-enabled" value={!!config.enabled} onValueChange={(v) => patch({ enabled: v })} trackColor={{ true: colors.brandPrimary }} />
      </View>
      <View style={[styles.card, styles.switchRow]}>
        <Text style={styles.rTitle}>Conservative forecasts</Text>
        <Switch testID="fundadm-conservative" value={!!config.conservative_forecast} onValueChange={(v) => patch({ conservative_forecast: v })} trackColor={{ true: colors.brandPrimary }} />
      </View>

      <Text style={styles.subhead}>Providers</Text>
      {providers.map((p) => {
        const key = `${p.key}_enabled`;
        return (
          <View key={p.key} style={[styles.card, styles.switchRow]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rTitle}>{p.label}</Text>
              <Text style={styles.rMeta}>Phase {p.phase}{p.key !== "affiliates" ? " · needs provider agreement + keys" : ""}</Text>
            </View>
            <Switch testID={`fundadm-${p.key}`} value={!!config[key]} onValueChange={(v) => patch({ [key]: v })} trackColor={{ true: colors.brandPrimary }} disabled={busy} />
          </View>
        );
      })}
      <Text style={styles.note}>Kard & BenefitHub stay inert until real agreements + server-side keys are configured. Turning them on here only flags intent.</Text>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  subhead: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  rMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
