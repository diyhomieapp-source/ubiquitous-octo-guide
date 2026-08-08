import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CATS = ["Tool", "Material", "Supply", "Safety", "Hardware", "Paint", "Other"];
const STATUSES = [{ k: "have", l: "Have plenty" }, { k: "low", l: "Running low" }, { k: "out", l: "Out" }];

export default function InventoryDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setItem(await api(`/hi/inventory/${id}`)); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patch = (k: string, v: any) => setItem((it: any) => ({ ...it, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api(`/hi/inventory/${id}`, { method: "PUT", body: {
        name: item.name, category: item.category, brand: item.brand, quantity: item.quantity,
        storage_location: item.storage_location, status: item.status, notes: item.notes,
      } });
      Alert.alert("Saved", "Item updated."); load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  const archive = () => {
    Alert.alert("Remove item?", "This takes it out of your toolbox.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => { try { await api(`/hi/inventory/${id}`, { method: "DELETE" }); router.back(); } catch {} } },
    ]);
  };

  if (loading || !item) return <View style={styles.root}><ScreenHeader title="Item" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Toolbox Item" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Name</Text>
        <TextInput testID="invd-name" style={styles.input} value={item.name} onChangeText={(v) => patch("name", v)} />
        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>{CATS.map((c) => (<Pressable key={c} style={[styles.chip, item.category === c && styles.chipOn]} onPress={() => patch("category", c)}><Text style={[styles.chipText, item.category === c && styles.chipTextOn]}>{c}</Text></Pressable>))}</View>
        <Text style={styles.label}>Brand</Text>
        <TextInput style={styles.input} value={item.brand || ""} onChangeText={(v) => patch("brand", v)} placeholder="—" placeholderTextColor={colors.onSurfaceTertiary} />
        <Text style={styles.label}>Quantity</Text>
        <TextInput style={styles.input} value={item.quantity || ""} onChangeText={(v) => patch("quantity", v)} placeholder="—" placeholderTextColor={colors.onSurfaceTertiary} />
        <Text style={styles.label}>Storage location</Text>
        <TextInput style={styles.input} value={item.storage_location || ""} onChangeText={(v) => patch("storage_location", v)} placeholder="—" placeholderTextColor={colors.onSurfaceTertiary} />
        <Text style={styles.label}>Stock</Text>
        <View style={styles.chips}>{STATUSES.map((s) => (<Pressable key={s.k} testID={`invd-status-${s.k}`} style={[styles.chip, item.status === s.k && styles.chipOn]} onPress={() => patch("status", s.k)}><Text style={[styles.chipText, item.status === s.k && styles.chipTextOn]}>{s.l}</Text></Pressable>))}</View>
        <Text style={styles.label}>Notes</Text>
        <TextInput style={[styles.input, { minHeight: 70 }]} value={item.notes || ""} onChangeText={(v) => patch("notes", v)} multiline textAlignVertical="top" placeholder="—" placeholderTextColor={colors.onSurfaceTertiary} />

        <Pressable testID="invd-save" style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save changes</Text>}
        </Pressable>
        <Pressable testID="invd-archive" style={styles.archive} onPress={archive}>
          <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} />
          <Text style={styles.archiveText}>Remove from toolbox</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  archive: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.lg },
  archiveText: { color: colors.error, fontFamily: font.bold, fontSize: type.base },
});
