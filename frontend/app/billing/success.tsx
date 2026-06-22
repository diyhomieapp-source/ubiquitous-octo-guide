import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const MAX_POLLS = 8;
const INTERVAL = 2000;

export default function BillingSuccess() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session_id } = useLocalSearchParams<{ session_id?: string }>();
  const { setUser, refresh } = useAuth();

  const [state, setState] = useState<"checking" | "paid" | "pending" | "error">("checking");
  const polls = useRef(0);

  useEffect(() => {
    let cancelled = false;
    if (!session_id) { setState("error"); return; }

    const poll = async () => {
      if (cancelled) return;
      polls.current += 1;
      try {
        const res = await api<{ payment_status: string; status: string; user: any }>(`/billing/status/${session_id}`);
        if (res.payment_status === "paid") {
          if (res.user) setUser(res.user);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setState("paid");
          setTimeout(() => router.replace("/(tabs)"), 1400);
          return;
        }
        if (res.status === "expired") { setState("error"); return; }
      } catch {
        // keep trying until max
      }
      if (polls.current >= MAX_POLLS) { setState("pending"); return; }
      setTimeout(poll, INTERVAL);
    };
    poll();
    return () => { cancelled = true; };
  }, [session_id, router, setUser]);

  const goTabs = async () => { await refresh(); router.replace("/(tabs)"); };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {state === "checking" && (
        <>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={styles.title}>CONFIRMING PAYMENT</Text>
          <Text style={styles.sub}>Hang tight — unlocking your account…</Text>
        </>
      )}
      {state === "paid" && (
        <>
          <View style={styles.iconWrap}><MaterialCommunityIcons name="check-decagram" size={64} color={colors.success} /></View>
          <Text style={styles.title}>YOU'RE IN!</Text>
          <Text style={styles.sub}>Credits added. Homie is ready to build.</Text>
        </>
      )}
      {state === "pending" && (
        <>
          <MaterialCommunityIcons name="clock-outline" size={56} color={colors.warning} />
          <Text style={styles.title}>ALMOST THERE</Text>
          <Text style={styles.sub}>Payment is still processing. Your credits will appear shortly.</Text>
          <Pressable style={styles.cta} onPress={goTabs}><Text style={styles.ctaText}>GO TO MY DASHBOARD</Text></Pressable>
        </>
      )}
      {state === "error" && (
        <>
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color={colors.error} />
          <Text style={styles.title}>SOMETHING WENT WRONG</Text>
          <Text style={styles.sub}>We couldn't confirm this payment.</Text>
          <Pressable style={styles.cta} onPress={() => router.replace("/paywall")}><Text style={styles.ctaText}>BACK TO PLANS</Text></Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  iconWrap: { marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 36, letterSpacing: 1, marginTop: spacing.md },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", lineHeight: 22 },
  cta: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, paddingHorizontal: spacing.xl, borderRadius: radius.md, marginTop: spacing.lg },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
});
