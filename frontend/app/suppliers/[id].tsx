import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${((c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Product = { id: string; sku: string; name: string; unit: string; price_cents: number };
type Supplier = { id: string; name: string; pro_only: boolean; delivery: boolean; pickup: boolean; min_order_cents: number };
type CartItem = { sku: string; name: string; unit: string; unit_price_cents: number; qty: number; grade: string; cut_length: string };

export default function SupplierDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api<{ supplier: Supplier; products: Product[] }>(`/suppliers/${id}`);
      setSupplier(d.supplier); setProducts(d.products);
      setFulfillment(d.supplier.delivery ? "delivery" : "pickup");
    } catch (e: any) {
      setError(e?.status === 403 ? "This supplier is available to verified Pro members only." : (e?.message || "Couldn't load this supplier."));
    } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setQty = (p: Product, qty: number) => {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) { delete next[p.sku]; return next; }
      next[p.sku] = { ...(next[p.sku] || { sku: p.sku, name: p.name, unit: p.unit, unit_price_cents: p.price_cents, grade: "", cut_length: "" }), qty };
      return next;
    });
  };
  const setField = (sku: string, field: "grade" | "cut_length", val: string) =>
    setCart((c) => (c[sku] ? { ...c, [sku]: { ...c[sku], [field]: val } } : c));

  const items = Object.values(cart);
  const subtotal = items.reduce((s, i) => s + i.unit_price_cents * i.qty, 0);
  const belowMin = supplier ? subtotal < (supplier.min_order_cents || 0) : false;

  const submit = async (mode: "rfq" | "order") => {
    if (items.length === 0 || submitting) return;
    if (belowMin) { Alert.alert("Below minimum", `This supplier requires a ${money(supplier!.min_order_cents)} minimum order.`); return; }
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const o = await api<{ id: string }>("/material-orders", { method: "POST", body: {
        supplier_id: id, mode, fulfillment,
        items: items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unit: i.unit, grade: i.grade, cut_length: i.cut_length, unit_price_cents: i.unit_price_cents })),
        note: note.trim(),
      } });
      router.replace(`/orders/${o.id}`);
    } catch (e: any) { Alert.alert("Couldn't submit", e?.message || "Try again."); }
    finally { setSubmitting(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  if (error || !supplier) return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="supd-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Supplier</Text>
        <View style={{ width: 28 }} />
      </View>
      <View style={styles.errWrap}>
        <MaterialCommunityIcons name="store-alert-outline" size={40} color={colors.onSurfaceTertiary} />
        <Text style={styles.errText}>{error || "Supplier not found."}</Text>
        <Pressable testID="supd-retry" style={styles.retryBtn} onPress={load}><Text style={styles.retryText}>Try again</Text></Pressable>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="supd-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{supplier.name}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: items.length ? 220 : 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.bulkNote}>Bulk mode — set quantities, grade or cut lengths, then request a quote or place an order.</Text>
        {products.map((p) => {
          const ci = cart[p.sku];
          const qty = ci?.qty || 0;
          return (
            <View key={p.id} style={styles.prod}>
              <View style={styles.prodTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prodName}>{p.name}</Text>
                  <Text style={styles.prodMeta}>{p.sku} · {money(p.price_cents)}/{p.unit}</Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable testID={`prod-minus-${p.sku}`} style={styles.stepBtn} onPress={() => setQty(p, Math.max(0, qty - 1))}><MaterialCommunityIcons name="minus" size={16} color={colors.onSurface} /></Pressable>
                  <TextInput testID={`prod-qty-${p.sku}`} style={styles.qtyInput} value={qty ? String(qty) : ""} onChangeText={(t) => setQty(p, parseInt(t.replace(/[^0-9]/g, "")) || 0)} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} />
                  <Pressable testID={`prod-plus-${p.sku}`} style={styles.stepBtn} onPress={() => setQty(p, qty + 1)}><MaterialCommunityIcons name="plus" size={16} color={colors.onSurface} /></Pressable>
                </View>
              </View>
              {qty > 0 && (
                <View style={styles.specRow}>
                  <TextInput style={styles.specInput} value={ci?.grade} onChangeText={(t) => setField(p.sku, "grade", t)} placeholder="Grade (opt.)" placeholderTextColor={colors.onSurfaceTertiary} />
                  <TextInput style={styles.specInput} value={ci?.cut_length} onChangeText={(t) => setField(p.sku, "cut_length", t)} placeholder="Cut length (opt.)" placeholderTextColor={colors.onSurfaceTertiary} />
                  <Text style={styles.lineTotal}>{money(p.price_cents * qty)}</Text>
                </View>
              )}
            </View>
          );
        })}
        {items.length > 0 && (
          <TextInput testID="order-note" style={styles.noteInput} value={note} onChangeText={setNote} placeholder="Note for supplier (delivery date, site access…)" placeholderTextColor={colors.onSurfaceTertiary} multiline />
        )}
      </ScrollView>

      {items.length > 0 && (
        <View style={[styles.cartBar, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.fulfillRow}>
            {supplier.delivery && <Pressable testID="ff-delivery" style={[styles.ffBtn, fulfillment === "delivery" && styles.ffOn]} onPress={() => setFulfillment("delivery")}><MaterialCommunityIcons name="truck-outline" size={15} color={fulfillment === "delivery" ? colors.onBrandPrimary : colors.onSurfaceSecondary} /><Text style={[styles.ffText, fulfillment === "delivery" && styles.ffTextOn]}>Delivery</Text></Pressable>}
            {supplier.pickup && <Pressable testID="ff-pickup" style={[styles.ffBtn, fulfillment === "pickup" && styles.ffOn]} onPress={() => setFulfillment("pickup")}><MaterialCommunityIcons name="storefront-outline" size={15} color={fulfillment === "pickup" ? colors.onBrandPrimary : colors.onSurfaceSecondary} /><Text style={[styles.ffText, fulfillment === "pickup" && styles.ffTextOn]}>Pickup</Text></Pressable>}
            <View style={{ flex: 1 }} />
            <Text style={styles.subtotal}>{money(subtotal)}</Text>
          </View>
          {belowMin && <Text style={styles.minWarn}>Minimum order {money(supplier.min_order_cents)}</Text>}
          <View style={styles.cartBtns}>
            <Pressable testID="submit-rfq" style={styles.rfqBtn} onPress={() => submit("rfq")} disabled={submitting}>
              {submitting ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.rfqText}>REQUEST QUOTE</Text>}
            </Pressable>
            <Pressable testID="submit-order" style={styles.orderBtn} onPress={() => submit("order")} disabled={submitting}>
              <Text style={styles.orderText}>PLACE ORDER</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  errWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  errText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, textAlign: "center", lineHeight: 22 },
  retryBtn: { borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  retryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  bulkNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  prod: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  prodTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  prodName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  prodMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  qtyInput: { width: 44, height: 32, textAlign: "center", color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, backgroundColor: colors.surface, borderRadius: radius.sm, borderColor: colors.border, borderWidth: 1 },
  specRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  specInput: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  lineTotal: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base, minWidth: 64, textAlign: "right" },
  noteInput: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, minHeight: 70, textAlignVertical: "top", marginTop: spacing.sm },
  cartBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  fulfillRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ffBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  ffOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  ffText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  ffTextOn: { color: colors.onBrandPrimary },
  subtotal: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  minWarn: { color: colors.warning, fontFamily: font.medium, fontSize: type.sm },
  cartBtns: { flexDirection: "row", gap: spacing.sm },
  rfqBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.brandPrimary, borderWidth: 1.5 },
  rfqText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  orderBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  orderText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
});
