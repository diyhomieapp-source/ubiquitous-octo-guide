import { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Platform, Share,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import ConfettiCannon from "react-native-confetti-cannon";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type RefStats = {
  code: string;
  invited: number;
  converted: number;
  earned_cents: number;
  credit_cents: number;
  reward_cents: number;
  is_paid: boolean;
};

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function shareBase() {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return process.env.EXPO_PUBLIC_BACKEND_URL || "https://diyhomie.app";
}

export default function Referrals() {
  const [stats, setStats] = useState<RefStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const confettiRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<RefStats>("/referrals/me");
      setStats(res);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const link = stats ? `${shareBase()}?ref=${stats.code}` : "";
  const reward = stats ? dollars(stats.reward_cents) : "$5";

  const fireConfetti = () => { try { confettiRef.current?.start(); } catch {} };

  const copyCode = async () => {
    if (!stats) return;
    await Clipboard.setStringAsync(link);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    fireConfetti();
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!stats) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const message = `I'm using DIYhomie — an AI master contractor that walks you through any home repair step-by-step. Join with my link and we both get ${reward} off: ${link}`;
    try {
      if (Platform.OS === "web" && (navigator as any)?.share) {
        await (navigator as any).share({ title: "DIYhomie", text: message, url: link });
      } else if (Platform.OS === "web") {
        await Clipboard.setStringAsync(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        await Share.share({ message });
      }
      fireConfetti();
    } catch {}
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Share & Earn" />
      {loading || !stats ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* hero */}
          <View style={styles.hero}>
            <View style={styles.giftCircle}>
              <MaterialCommunityIcons name="gift-outline" size={36} color={colors.brandPrimary} />
            </View>
            <Text style={styles.heroTitle}>GIVE {reward}, GET {reward}</Text>
            <Text style={styles.heroSub}>
              Invite a friend. When they subscribe, you both get {reward} credit toward your DIYhomie plan — every single time.
            </Text>
          </View>

          {/* stats */}
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stats.invited}</Text>
              <Text style={styles.statLabel}>INVITED</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stats.converted}</Text>
              <Text style={styles.statLabel}>JOINED</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, { color: colors.success }]}>{dollars(stats.earned_cents)}</Text>
              <Text style={styles.statLabel}>EARNED</Text>
            </View>
          </View>

          {/* current credit balance */}
          <View style={styles.balanceCard}>
            <MaterialCommunityIcons name="wallet-outline" size={22} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.balanceLabel}>Available account credit</Text>
              <Text style={styles.balanceSub}>Auto-applied to your next invoice</Text>
            </View>
            <Text style={styles.balanceValue}>{dollars(stats.credit_cents)}</Text>
          </View>

          {/* code */}
          <Text style={styles.sectionLabel}>YOUR INVITE LINK</Text>
          <Pressable testID="referral-copy" style={styles.codeBox} onPress={copyCode}>
            <View style={{ flex: 1 }}>
              <Text style={styles.codeValue}>{stats.code}</Text>
              <Text style={styles.codeLink} numberOfLines={1}>{link}</Text>
            </View>
            <View style={styles.copyBtn}>
              <MaterialCommunityIcons name={copied ? "check" : "content-copy"} size={18} color={colors.onBrandPrimary} />
              <Text style={styles.copyText}>{copied ? "COPIED" : "COPY"}</Text>
            </View>
          </Pressable>

          <Pressable testID="referral-share" style={styles.shareBtn} onPress={shareLink}>
            <MaterialCommunityIcons name="share-variant" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.shareText}>SHARE INVITE</Text>
          </Pressable>

          {!stats.is_paid && (
            <View style={styles.noteCard}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.info} />
              <Text style={styles.noteText}>
                Your rewards stack up now. The moment you start a paid plan, every {reward} you've earned is applied to your balance.
              </Text>
            </View>
          )}

          {/* how it works */}
          <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
          {[
            { icon: "send-outline", t: "Share your link", d: "Send it to friends tackling home projects." },
            { icon: "account-plus-outline", t: "They join & subscribe", d: `They get ${reward} off their first plan.` },
            { icon: "cash-multiple", t: `You earn ${reward}`, d: "Credit lands automatically on your account." },
          ].map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepIcon}><MaterialCommunityIcons name={s.icon as any} size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{s.t}</Text>
                <Text style={styles.stepDesc}>{s.d}</Text>
              </View>
            </View>
          ))}
          <View style={{ height: spacing["2xl"] }} />
        </ScrollView>
      )}

      <ConfettiCannon
        ref={confettiRef}
        count={120}
        origin={{ x: 180, y: -20 }}
        autoStart={false}
        fadeOut
        fallSpeed={2600}
        colors={[colors.brandPrimary, colors.success, "#FFC400", "#FFFFFF"]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  hero: { alignItems: "center", marginBottom: spacing.xl },
  giftCircle: { width: 76, height: 76, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  heroTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 38, letterSpacing: 1, textAlign: "center" },
  heroSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 20, marginTop: spacing.sm, paddingHorizontal: spacing.md },
  statRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.lg },
  stat: { flex: 1, alignItems: "center" },
  statNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 34, lineHeight: 36 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  statDivider: { width: 1, height: 40, backgroundColor: colors.borderStrong },
  balanceCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.xl },
  balanceLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  balanceSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  balanceValue: { color: colors.success, fontFamily: font.display, fontSize: 30 },
  sectionLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  codeBox: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.borderStrong, borderWidth: 1.5, borderStyle: "dashed", marginBottom: spacing.md },
  codeValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 3 },
  codeLink: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  copyText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginBottom: spacing.lg },
  shareText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  noteCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.xl },
  noteText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  stepIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  stepTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  stepDesc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
});
