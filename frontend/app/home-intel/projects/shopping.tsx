import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TextInput } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Mat = { id: string; name: string; quantity?: string; unit?: string; category: string; purchase_status?: string };

export default function ShoppingMode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // purchase price modal
  const [buying, setBuying] = useState<Mat | null>(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  // receipt review
  const [receipt, setReceipt] = useState<any>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api(`/hi/materials/projects/${id}/shopping`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmPurchase = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      const body: any = {};
      if (price.trim()) body.actual_price = parseFloat(price);
      await api(`/hi/materials/items/${buying.id}/purchased`, { method: "POST", body });
      setBuying(null); setPrice(""); load();
    } catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const outOfStock = async (m: Mat) => {
    try {
      const res = await api<{ suggestion: string }>(`/hi/materials/items/${m.id}/out-of-stock`, { method: "POST", body: {} });
      Alert.alert("Marked out of stock", res.suggestion);
      load();
    } catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
  };

  const pickReceipt = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photos access needed", "Allow photo access to upload your receipt.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.6, base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    setUploading(true);
    try {
      const rc = await api(`/hi/materials/projects/${id}/receipts`, {
        method: "POST", body: { image_base64: result.assets[0].base64 },
      });
      setReceipt(rc);
    } catch (e: any) { Alert.alert("Couldn't read receipt", e?.message || "Try again."); }
    finally { setUploading(false); }
  };

  const confirmReceipt = async () => {
    if (!receipt) return;
    setBusy(true);
    try {
      const matches = (receipt.items || [])
        .filter((it: any) => it.suggested_material_id)
        .map((it: any) => ({ material_id: it.suggested_material_id, price: it.price }));
      const res = await api<{ matched_items: number }>(`/hi/materials/receipts/${receipt.id}/confirm`, {
        method: "POST", body: { merchant: receipt.merchant, purchase_date: receipt.purchase_date, total: receipt.total, matches },
      });
      Alert.alert("Receipt saved", `${res.matched_items} item(s) matched to your project and marked purchased.`);
      setReceipt(null); load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Shopping" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Shopping Mode" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.forText}>Shopping for: {data.project?.title}</Text>
        <Text testID="shop-remaining" style={styles.remaining}>{data.remaining_count} item{data.remaining_count === 1 ? "" : "s"} remaining</Text>

        <Pressable testID="shop-receipt" style={styles.receiptBtn} disabled={uploading} onPress={pickReceipt}>
          {uploading ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <>
              <MaterialCommunityIcons name="receipt" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.receiptText}>Upload Receipt</Text>
            </>
          )}
        </Pressable>

        {data.remaining.map((m: Mat) => (
          <View key={m.id} style={styles.card}>
            <View style={styles.cardTop}>
              <MaterialCommunityIcons name="checkbox-blank-outline" size={20} color={colors.onSurfaceTertiary} />
              <Text style={styles.name}>{m.name}</Text>
              {!!(m.quantity || m.unit) && <Text style={styles.qty}>{m.quantity} {m.unit}</Text>}
            </View>
            <View style={styles.btnRow}>
              <Pressable testID={`shop-buy-${m.id}`} style={styles.buyBtn} onPress={() => { setBuying(m); setPrice(""); }}>
                <Text style={styles.buyText}>Purchased</Text>
              </Pressable>
              <Pressable testID={`shop-oos-${m.id}`} style={styles.oosBtn} onPress={() => outOfStock(m)}>
                <Text style={styles.oosText}>Out of stock</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {data.remaining.length === 0 && <Text style={styles.done}>Everything&apos;s checked off — you&apos;re ready to work. 🛠️</Text>}

        {data.purchased.length > 0 && (
          <>
            <Text style={styles.section}>Purchased</Text>
            {data.purchased.map((m: Mat & { actual_price?: number }) => (
              <View key={m.id} style={styles.doneRow}>
                <MaterialCommunityIcons name="checkbox-marked" size={18} color={colors.success} />
                <Text style={styles.doneText}>{m.name}{(m as any).actual_price != null ? ` · $${(m as any).actual_price}` : ""}</Text>
              </View>
            ))}
          </>
        )}
        {data.out_of_stock.length > 0 && (
          <>
            <Text style={styles.section}>Out of stock</Text>
            {data.out_of_stock.map((m: Mat) => (
              <View key={m.id} style={styles.doneRow}>
                <MaterialCommunityIcons name="close-box-outline" size={18} color={colors.error} />
                <Text style={styles.doneText}>{m.name}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* purchase price modal */}
      <Modal visible={!!buying} transparent animationType="slide" onRequestClose={() => setBuying(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Purchased “{buying?.name}”</Text>
            <TextInput testID="shop-price" style={styles.input} placeholder="Price paid (optional)" placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setBuying(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="shop-buy-confirm" style={styles.saveBtn} disabled={busy} onPress={confirmPurchase}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* receipt review modal */}
      <Modal visible={!!receipt} transparent animationType="slide" onRequestClose={() => setReceipt(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Review receipt</Text>
            <Text style={styles.reviewMeta}>
              {receipt?.merchant || "Unknown merchant"}{receipt?.purchase_date ? ` · ${receipt.purchase_date}` : ""}{receipt?.total != null ? ` · $${receipt.total}` : ""}
            </Text>
            <Text style={styles.reviewConfidence}>Read confidence: {receipt?.confidence} — double-check before saving.</Text>
            <ScrollView style={{ maxHeight: 260 }}>
              {(receipt?.items || []).map((it: any, i: number) => (
                <View key={i} style={styles.reviewRow}>
                  <Text style={styles.reviewName}>{it.name}{it.price != null ? ` · $${it.price}` : ""}</Text>
                  <Text style={[styles.reviewMatch, { color: it.suggested_material_name ? colors.success : colors.onSurfaceTertiary }]}>
                    {it.suggested_material_name ? `→ ${it.suggested_material_name}` : "No project match"}
                  </Text>
                </View>
              ))}
              {(receipt?.items || []).length === 0 && <Text style={styles.reviewMeta}>No line items could be read.</Text>}
            </ScrollView>
            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setReceipt(null)}><Text style={styles.cancelText}>Discard</Text></Pressable>
              <Pressable testID="receipt-confirm" style={styles.saveBtn} disabled={busy} onPress={confirmReceipt}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Receipt</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  forText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  remaining: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl, marginTop: 2, marginBottom: spacing.md },
  receiptBtn: { flexDirection: "row", gap: spacing.xs, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  receiptText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, flex: 1 },
  qty: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  btnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  buyBtn: { flex: 1, alignItems: "center", backgroundColor: colors.success + "22", borderColor: colors.success, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  buyText: { color: colors.success, fontFamily: font.bold, fontSize: type.sm },
  oosBtn: { flex: 1, alignItems: "center", borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  oosText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  done: { color: colors.success, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.md },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  doneRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  doneText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  modalWrap: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing["2xl"], gap: spacing.sm },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  reviewMeta: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  reviewConfidence: { color: colors.warning, fontFamily: font.regular, fontSize: type.sm },
  reviewRow: { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: spacing.sm },
  reviewName: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  reviewMatch: { fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  modalBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  saveBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
