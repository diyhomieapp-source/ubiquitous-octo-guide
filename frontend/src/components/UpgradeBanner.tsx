import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Ent = { plan: string; is_paid: boolean; remaining: { scans: number; guides: number; saved_projects: number }; trial_days_left: number | null; upgrade_cta: string; price_label: string };

export function UpgradeBanner() {
  const [ent, setEnt] = useState<Ent | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const e = await api<Ent>("/entitlements/me");
      setEnt(e);
      if (!e.is_paid) api("/conversion/event", { method: "POST", body: { event: "cta_view", meta: { where: "profile" } } }).catch(() => {});
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const upgrade = async () => {
    setBusy(true);
    try {
      api("/conversion/event", { method: "POST", body: { event: "cta_click", meta: { where: "profile" } } }).catch(() => {});
      const r = await api<{ checkout_url: string }>("/billing/checkout", { method: "POST", body: { tier: "pro" } });
      if (r.checkout_url) {
        if (Platform.OS === "web" && typeof window !== "undefined") window.open(r.checkout_url, "_blank");
        else await Linking.openURL(r.checkout_url);
      }
    } catch {} finally { setBusy(false); }
  };

  if (!ent || ent.is_paid) return null;
  return (
    <View style={styles.banner} testID="upgrade-banner">
      <View style={styles.top}>
        <MaterialCommunityIcons name="rocket-launch-outline" size={20} color={colors.onBrandPrimary} />
        <Text style={styles.title}>Free plan</Text>
        {ent.trial_days_left != null && <View style={styles.pill}><Text style={styles.pillText}>{ent.trial_days_left}d trial left</Text></View>}
      </View>
      <Text style={styles.cta}>{ent.upgrade_cta}</Text>
      <View style={styles.creds}>
        <Cred label="Scans" n={ent.remaining.scans} />
        <Cred label="AR guides" n={ent.remaining.guides} />
        <Cred label="Saved projects" n={ent.remaining.saved_projects} />
      </View>
      <Pressable testID="upgrade-btn" style={styles.btn} onPress={upgrade} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.btnText}>Upgrade — {ent.price_label}</Text>}
      </Pressable>
    </View>
  );
}

function Cred({ label, n }: { label: string; n: number }) {
  return <View style={styles.cred}><Text style={styles.credN}>{n}</Text><Text style={styles.credL}>{label} left</Text></View>;
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, flex: 1 },
  pill: { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  pillText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 10 },
  cta: { color: colors.onBrandPrimary, opacity: 0.92, fontFamily: font.medium, fontSize: type.sm, lineHeight: 19 },
  creds: { flexDirection: "row", gap: spacing.sm },
  cred: { flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: radius.sm, padding: spacing.sm, alignItems: "center" },
  credN: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 20 },
  credL: { color: colors.onBrandPrimary, opacity: 0.85, fontFamily: font.medium, fontSize: 9, marginTop: 2 },
  btn: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs },
  btnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
});
