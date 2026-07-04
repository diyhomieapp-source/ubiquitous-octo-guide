import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const URGENCY: { key: string; label: string; icon: string }[] = [
  { key: "emergency", label: "Emergency", icon: "alert-octagon-outline" },
  { key: "standard", label: "Soon", icon: "clock-outline" },
  { key: "planning", label: "Just planning", icon: "calendar-outline" },
];

export function ProReferralModal({
  visible, onClose, presetTrade, presetIssue, projectId,
}: {
  visible: boolean; onClose: () => void;
  presetTrade?: string; presetIssue?: string; projectId?: string;
}) {
  const { user } = useAuth();
  const [trades, setTrades] = useState<string[]>([]);
  const [trade, setTrade] = useState(presetTrade || "");
  const [issue, setIssue] = useState(presetIssue || "");
  const [location, setLocation] = useState(user?.location || "");
  const [urgency, setUrgency] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (visible) {
      api<{ trades: string[] }>("/pro-referrals/trades", { auth: false })
        .then((r) => setTrades(r.trades)).catch(() => {});
      setTrade(presetTrade || ""); setIssue(presetIssue || "");
      setLocation(user?.location || ""); setUrgency("standard"); setDone(false);
    }
  }, [visible]);

  const submit = async () => {
    if (!trade || issue.trim().length < 5) return;
    setBusy(true);
    Haptics.selectionAsync();
    try {
      await api("/pro-referrals", {
        method: "POST",
        body: { trade, issue: issue.trim(), location: location.trim(), urgency, project_id: projectId || null },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
    } catch {} finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <View style={styles.grip} />
          {done ? (
            <View style={styles.doneWrap}>
              <View style={styles.doneIcon}><MaterialCommunityIcons name="check-circle-outline" size={44} color={colors.success} /></View>
              <Text style={styles.doneTitle}>Request received</Text>
              <Text style={styles.doneSub}>We'll match you with a vetted local {trade.toLowerCase()} pro and reach out by email. No pressure, no spam.</Text>
              <Pressable testID="pro-done" style={styles.cta} onPress={onClose}>
                <Text style={styles.ctaText}>DONE</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.head}>
                <View style={styles.headIcon}><MaterialCommunityIcons name="account-hard-hat" size={22} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Get a local pro</Text>
                  <Text style={styles.subtitle}>Some jobs are safer with an expert. We'll find one.</Text>
                </View>
                <Pressable testID="pro-close" hitSlop={10} onPress={onClose}>
                  <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceTertiary} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>TRADE NEEDED</Text>
                <View style={styles.chips}>
                  {trades.map((t) => (
                    <Pressable key={t} testID={`pro-trade-${t}`} style={[styles.chip, trade === t && styles.chipActive]} onPress={() => { Haptics.selectionAsync(); setTrade(t); }}>
                      <Text style={[styles.chipText, trade === t && styles.chipTextActive]}>{t}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>WHAT DO YOU NEED HELP WITH?</Text>
                <TextInput testID="pro-issue" style={styles.textArea} value={issue} onChangeText={setIssue} placeholder="Describe the job — the more detail, the better the match." placeholderTextColor={colors.onSurfaceTertiary} multiline />

                <Text style={styles.label}>YOUR LOCATION</Text>
                <TextInput testID="pro-location" style={styles.input} value={location} onChangeText={setLocation} placeholder="City, State or ZIP" placeholderTextColor={colors.onSurfaceTertiary} />

                <Text style={styles.label}>TIMELINE</Text>
                <View style={styles.chips}>
                  {URGENCY.map((u) => (
                    <Pressable key={u.key} testID={`pro-urgency-${u.key}`} style={[styles.chip, urgency === u.key && styles.chipActive]} onPress={() => { Haptics.selectionAsync(); setUrgency(u.key); }}>
                      <MaterialCommunityIcons name={u.icon as any} size={15} color={urgency === u.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                      <Text style={[styles.chipText, urgency === u.key && styles.chipTextActive]}>{u.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable testID="pro-submit" style={[styles.cta, (!trade || issue.trim().length < 5) && styles.ctaDisabled]} onPress={submit} disabled={busy || !trade || issue.trim().length < 5}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>REQUEST A QUOTE</Text>}
                </Pressable>
                <Text style={styles.fine}>Free to request. You're never charged by DIYhomie for a referral.</Text>
              </ScrollView>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", paddingTop: spacing.sm },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, marginTop: spacing.md, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  chipTextActive: { color: colors.onBrandPrimary },
  textArea: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, minHeight: 80, textAlignVertical: "top", color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  cta: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.lg },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.5 },
  fine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", marginTop: spacing.sm },
  doneWrap: { padding: spacing.xl, alignItems: "center", gap: spacing.sm, paddingBottom: spacing["3xl"] },
  doneIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  doneTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  doneSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 21 },
});
