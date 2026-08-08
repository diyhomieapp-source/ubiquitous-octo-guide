import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STAGES = ["invited", "registered", "verified", "active", "rewarded"];

export default function Referral() {
  const [code, setCode] = useState<string | null>(null);
  const [refs, setRefs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ my_code: string | null; referrals: any[] }>("/hi/rewards/referral"); setCode(d.my_code); setRefs(d.referrals); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    try { const d = await api<{ referral_code: string }>("/hi/rewards/referral", { method: "POST" }); setCode(d.referral_code); load(); } catch {}
  };
  const link = () => `${Platform.OS === "web" ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || "")}/?ref=${code}`;
  const copy = async () => { try { await Clipboard.setStringAsync(link()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Refer a friend" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.blurb}>Invite a fellow homeowner. Points are awarded only after they register, verify, and get set up — not just for a click.</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : !code ? (
          <Pressable testID="ref-create" style={styles.primary} onPress={create}><Text style={styles.primaryText}>Create my referral link</Text></Pressable>
        ) : (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>YOUR CODE</Text>
            <Text style={styles.code}>{code}</Text>
            <Pressable testID="ref-copy" style={styles.copyBtn} onPress={copy}>
              <MaterialCommunityIcons name="content-copy" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.copyText}>{copied ? "Copied!" : "Copy invite link"}</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.section}>How it works</Text>
        {STAGES.map((s, i) => (
          <View key={s} style={styles.stageRow}>
            <View style={styles.stageNum}><Text style={styles.stageNumText}>{i + 1}</Text></View>
            <Text style={styles.stageText}>{{ invited: "You invite a friend", registered: "They create an account", verified: "They verify their account", active: "They complete a real activity", rewarded: "Your points are approved" }[s]}</Text>
          </View>
        ))}

        {refs.length > 0 && <Text style={styles.section}>Your invites</Text>}
        {refs.map((r) => (
          <View key={r.id} style={styles.refRow}>
            <Text style={styles.refCode}>{r.referral_code}</Text>
            <Text style={styles.refStatus}>{r.status}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  blurb: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginBottom: spacing.md },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  codeCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "44", borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, alignItems: "center" },
  codeLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5 },
  code: { color: colors.onSurface, fontFamily: font.display, fontSize: 34, letterSpacing: 2, marginVertical: spacing.xs },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.sm },
  copyText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  stageRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  stageNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  stageNumText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  stageText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  refRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  refCode: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  refStatus: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
});
