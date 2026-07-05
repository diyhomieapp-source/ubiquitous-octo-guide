import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${((c || 0) / 100).toFixed(2)}`;

type Deal = { id: string; title: string; category: string; item: string; unit: string; price_full_cents: number; unit_price_cents: number; discount_pct: number; next_tier: { min: number; pct: number } | null; participants: number; target: number; total_qty: number; region: string; ends_at: string; status: string; creator_name: string; is_creator: boolean; my_qty: number; joined: boolean };

export default function Bulk() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([api<{ deals: Deal[] }>("/bulk/deals"), api<{ categories: string[] }>("/bulk/meta")]);
      setDeals(d.deals); setCats(m.categories);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const join = async (d: Deal) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { await api(`/bulk/deals/${d.id}/join`, { method: "POST", body: { qty: d.my_qty || 1 } }); load(); } catch (e: any) { Alert.alert("Couldn't join", e?.message || "Try again."); }
  };
  const leave = async (d: Deal) => { try { await api(`/bulk/deals/${d.id}/leave`, { method: "POST" }); load(); } catch {} };
  const close = async (d: Deal) => {
    try { const r = await api<{ discount_pct: number }>(`/bulk/deals/${d.id}/close`, { method: "POST" }); Alert.alert("Locked in!", `Order confirmed at ${r.discount_pct}% off. Participants notified.`); load(); } catch (e: any) { Alert.alert("Couldn't close", e?.message || "Try again."); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="bulk-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Bulk Buying</Text>
        <Pressable testID="bulk-add" hitSlop={10} onPress={() => setCreating((c) => !c)}><MaterialCommunityIcons name={creating ? "close" : "plus"} size={24} color={colors.onSurface} /></Pressable>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}>
            <Text style={styles.intro}>Pool orders with neighbors to unlock bulk discounts. The more who join, the deeper the price drop.</Text>
            {creating && <CreateForm cats={cats} onCreated={() => { setCreating(false); load(); }} />}
            {deals.length === 0 ? (
              <View style={styles.empty}><MaterialCommunityIcons name="cart-outline" size={30} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No group deals nearby yet. Start one with the + above!</Text></View>
            ) : deals.map((d) => <DealCard key={d.id} deal={d} onJoin={() => join(d)} onLeave={() => leave(d)} onClose={() => close(d)} />)}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function DealCard({ deal, onJoin, onLeave, onClose }: { deal: Deal; onJoin: () => void; onLeave: () => void; onClose: () => void }) {
  const nextMin = deal.next_tier?.min || deal.target;
  const progress = Math.min(1, deal.participants / nextMin);
  const locked = deal.status !== "open";
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={1}>{deal.title}</Text>
        {deal.discount_pct > 0 && <View style={styles.discTag}><Text style={styles.discText}>{deal.discount_pct}% OFF</Text></View>}
      </View>
      <Text style={styles.meta}>{deal.category} · {deal.region}{locked ? " · LOCKED" : ""}</Text>
      {!!deal.item && <Text style={styles.item} numberOfLines={2}>{deal.item}</Text>}

      <View style={styles.priceRow}>
        {deal.discount_pct > 0 && <Text style={styles.strike}>{money(deal.price_full_cents)}</Text>}
        <Text style={styles.price}>{money(deal.unit_price_cents)}</Text>
        <Text style={styles.perUnit}>/ {deal.unit}</Text>
      </View>

      <View style={styles.progressBg}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
      <Text style={styles.progressText}>
        {deal.participants} joined ({deal.total_qty} {deal.unit}s)
        {deal.next_tier ? ` · ${deal.next_tier.min - deal.participants} more → ${deal.next_tier.pct}% off` : " · max discount reached 🎉"}
      </Text>

      <View style={styles.cardFoot}>
        <Text style={styles.creator}>by {deal.creator_name}</Text>
        <View style={{ flex: 1 }} />
        {deal.is_creator ? (
          !locked && <Pressable testID={`bulk-close-${deal.id}`} style={styles.claimBtn} onPress={onClose}><Text style={styles.claimText}>Lock in order</Text></Pressable>
        ) : deal.joined ? (
          <Pressable testID={`bulk-leave-${deal.id}`} style={styles.ghostBtn} onPress={onLeave}><Text style={styles.ghostText}>Leave</Text></Pressable>
        ) : (
          !locked && <Pressable testID={`bulk-join-${deal.id}`} style={styles.claimBtn} onPress={onJoin}><Text style={styles.claimText}>Join deal</Text></Pressable>
        )}
      </View>
    </View>
  );
}

function CreateForm({ cats, onCreated }: { cats: string[]; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [item, setItem] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Other");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const cents = Math.round((parseFloat(price.replace(/[^0-9.]/g, "")) || 0) * 100);
    if (!title.trim() || cents <= 0) { Alert.alert("Missing info", "Add a title and a valid unit price."); return; }
    setBusy(true);
    try {
      await api("/bulk/deals", { method: "POST", body: { title: title.trim(), item: item.trim(), unit: unit.trim() || "unit", price_full_cents: cents, category } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTitle(""); setItem(""); setPrice(""); onCreated();
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Start a group deal</Text>
      <TextInput testID="bulk-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="Deal title (e.g. Spring mulch order)" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput style={styles.input} value={item} onChangeText={setItem} placeholder="What's being ordered? (item, size, brand)" placeholderTextColor={colors.onSurfaceTertiary} />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <TextInput testID="bulk-price" style={[styles.input, { flex: 1 }]} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Full unit price $" placeholderTextColor={colors.onSurfaceTertiary} />
        <TextInput style={[styles.input, { flex: 1 }]} value={unit} onChangeText={setUnit} placeholder="unit (bag, board…)" placeholderTextColor={colors.onSurfaceTertiary} />
      </View>
      <View style={styles.chipWrap}>
        {cats.map((c) => <Pressable key={c} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text></Pressable>)}
      </View>
      <Pressable testID="bulk-submit" style={styles.submitBtn} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Launch deal</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  intro: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginBottom: spacing.md },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  discTag: { backgroundColor: colors.success + "22", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  discText: { color: colors.success, fontFamily: font.bold, fontSize: 11 },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  item: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  priceRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, marginTop: 2 },
  strike: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textDecorationLine: "line-through" },
  price: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 24 },
  perUnit: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginBottom: 3 },
  progressBg: { height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: "hidden", marginTop: spacing.xs },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  progressText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, marginTop: 4 },
  cardFoot: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs },
  creator: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  claimBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  claimText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  ghostBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  ghostText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  formTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs },
  submitText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
