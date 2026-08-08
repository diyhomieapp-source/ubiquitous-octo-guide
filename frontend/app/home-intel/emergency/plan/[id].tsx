import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function PlanDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [plan, setPlan] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState("");

  const load = useCallback(async () => {
    try { const r = await api<any>(`/hi/emergency/prep-plans/${id}`); setPlan(r.plan); setItems(r.items || []); }
    catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (item: any) => {
    const next = item.status === "done" ? "todo" : "done";
    setItems((p) => p.map((x) => x.id === item.id ? { ...x, status: next } : x));
    try { await api(`/hi/emergency/prep-items/${item.id}`, { method: "PUT", body: { status: next } }); }
    catch { load(); }
  };
  const addItem = async () => {
    if (!newItem.trim()) return;
    setBusy(true);
    try { await api(`/hi/emergency/prep-plans/${id}/items`, { method: "POST", body: { title: newItem } }); setNewItem(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !plan) return <View style={styles.root}><ScreenHeader title="Checklist" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  const done = items.filter((i) => i.status === "done").length;

  return (
    <View style={styles.root}>
      <ScreenHeader title={plan.label} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.track}><View style={[styles.fill, { width: `${items.length ? Math.round(done / items.length * 100) : 0}%` }]} /></View>
        <Text style={styles.progress}>{done} of {items.length} done</Text>
        {items.map((i) => (
          <Pressable key={i.id} testID={`er-item-${i.id}`} style={styles.item} onPress={() => toggle(i)}>
            <MaterialCommunityIcons name={i.status === "done" ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={i.status === "done" ? colors.brandPrimary : colors.onSurfaceTertiary} />
            <Text style={[styles.itemText, i.status === "done" && styles.itemDone]}>{i.title}</Text>
          </Pressable>
        ))}
        <View style={styles.addRow}>
          <TextInput testID="er-item-input" value={newItem} onChangeText={setNewItem} placeholder="Add your own task…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} onSubmitEditing={addItem} />
          <Pressable testID="er-item-add" disabled={busy || !newItem.trim()} style={[styles.addBtn, (busy || !newItem.trim()) && { opacity: 0.5 }]} onPress={addItem}><MaterialCommunityIcons name="plus" size={20} color="#fff" /></Pressable>
        </View>
        <Text style={styles.note}>Preparedness is about being ready — it doesn't guarantee your property is protected or low-risk.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  progress: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, marginTop: 6, marginBottom: spacing.md },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  itemText: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  itemDone: { color: colors.onSurfaceTertiary, textDecorationLine: "line-through" },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: spacing.sm },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  addBtn: { backgroundColor: colors.brandPrimary, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.lg },
});
