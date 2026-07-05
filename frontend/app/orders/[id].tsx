import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const origin = () => (typeof window !== "undefined" && window.location ? window.location.origin : (process.env.EXPO_PUBLIC_BACKEND_URL || ""));

type Item = { name: string; sku?: string; qty: number; unit: string; grade?: string; cut_length?: string; unit_price_cents: number; line_cents: number };
type Ev = { status: string; at: string };
type Order = { id: string; supplier_name: string; mode: string; fulfillment: string; status: string; items: Item[]; subtotal_cents: number; quoted_cents?: number | null; note: string; events: Ev[] };

const SC: Record<string, string> = { rfq: colors.info, quoted: colors.warning, confirmed: colors.brandPrimary, fulfilled: colors.success, cancelled: colors.error };

export default function OrderDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setO(await api<Order>(`/material-orders/${id}`)); } catch { router.back(); } finally { setLoading(false); }
  }, [id, router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pay = async () => {
    try {
      const { checkout_url } = await api<{ checkout_url: string }>(`/material-orders/${id}/pay`, { method: "POST", body: { origin_url: origin() } });
      if (Platform.OS === "web") window.open(checkout_url, "_blank"); else await WebBrowser.openBrowserAsync(checkout_url);
    } catch (e: any) { Alert.alert("Payment", e?.message || "Could not start payment."); }
  };

  if (loading || !o) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  const total = o.quoted_cents || o.subtotal_cents;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="ordd-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{o.supplier_name}</Text>
        <View style={{ width: 28 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.metaRow}>
          <View style={[styles.pill, { backgroundColor: (SC[o.status] || colors.onSurfaceTertiary) + "22" }]}><Text style={[styles.pillText, { color: SC[o.status] || colors.onSurfaceTertiary }]}>{o.status}</Text></View>
          <Text style={styles.sub}>{o.mode === "rfq" ? "Quote request" : "Order"} · {o.fulfillment}</Text>
        </View>

        <Text style={styles.section}>Items</Text>
        {o.items.map((it, i) => (
          <View key={i} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{it.name}</Text>
              <Text style={styles.itemMeta}>{it.qty} {it.unit} × {money(it.unit_price_cents)}{it.grade ? ` · ${it.grade}` : ""}{it.cut_length ? ` · ${it.cut_length}` : ""}</Text>
            </View>
            <Text style={styles.itemAmt}>{money(it.line_cents)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{o.quoted_cents ? "Quoted total" : "Estimated subtotal"}</Text>
          <Text style={styles.totalAmt}>{money(total)}</Text>
        </View>
        {!!o.note && <Text style={styles.note}>“{o.note}”</Text>}

        {o.status === "quoted" && (
          <Pressable testID="order-pay" style={styles.payBtn} onPress={pay}><MaterialCommunityIcons name="credit-card-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.payText}>PAY {money(total)}</Text></Pressable>
        )}

        <Text style={styles.section}>Timeline</Text>
        {(o.events || []).map((e, i) => (
          <View key={i} style={styles.evRow}><View style={styles.evDot} /><Text style={styles.evText}>{e.status}</Text><Text style={styles.evTime}>{new Date(e.at).toLocaleDateString()}</Text></View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontFamily: font.bold, fontSize: 10, textTransform: "capitalize" },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  itemName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  itemMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  itemAmt: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm, paddingTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },
  totalLabel: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  totalAmt: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 24 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, fontStyle: "italic", marginTop: spacing.sm },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  payText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  evRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  evDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  evText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  evTime: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
});
