import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const origin = () => (typeof window !== "undefined" && window.location ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || ""));

type Status = { onboarded: boolean; charges_enabled: boolean; payouts_enabled: boolean };

export default function ProPayouts() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await api<Status>("/pro/connect/status")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startOnboard = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/pro/connect/onboard", { method: "POST", body: { origin_url: origin() } });
      if (Platform.OS === "web") window.open(url, "_blank");
      else await WebBrowser.openBrowserAsync(url);
    } catch (e: any) {
      Alert.alert("Payout setup", e?.message || "Payments aren't configured on this environment yet.");
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="payouts-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Payouts</Text>
        <View style={{ width: 28 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <View style={styles.body}>
          <View style={[styles.iconCircle, { backgroundColor: (status?.onboarded ? colors.success : colors.brandPrimary) + "22" }]}>
            <MaterialCommunityIcons name={status?.onboarded ? "check-decagram" : "bank-outline"} size={44} color={status?.onboarded ? colors.success : colors.brandPrimary} />
          </View>
          {status?.onboarded ? (
            <>
              <Text style={styles.title}>You're ready to get paid</Text>
              <Text style={styles.sub}>Your Stripe account is connected. Invoice payments will deposit to your bank automatically.</Text>
              <Pressable testID="payouts-manage" style={styles.outlineBtn} onPress={startOnboard}>
                <Text style={styles.outlineText}>Update payout details</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Set up payouts</Text>
              <Text style={styles.sub}>Connect your bank securely through Stripe so clients can pay your invoices in-app. Takes ~2 minutes.</Text>
              <View style={styles.rows}>
                <Row done={status?.charges_enabled} text="Accept card payments" />
                <Row done={status?.payouts_enabled} text="Receive bank payouts" />
              </View>
              <Pressable testID="payouts-start" style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={startOnboard} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>CONNECT WITH STRIPE</Text>}
              </Pressable>
              <Pressable testID="payouts-refresh" onPress={load}><Text style={styles.refresh}>I finished — refresh status</Text></Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function Row({ done, text }: { done?: boolean; text: string }) {
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons name={done ? "check-circle" : "circle-outline"} size={20} color={done ? colors.success : colors.onSurfaceTertiary} />
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  iconCircle: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, textAlign: "center" },
  sub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", lineHeight: 24, maxWidth: 320 },
  rows: { gap: spacing.sm, marginVertical: spacing.md, alignSelf: "stretch", paddingHorizontal: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.xl, alignItems: "center", alignSelf: "stretch" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  outlineBtn: { borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  outlineText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  refresh: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.md, textDecorationLine: "underline" },
});
