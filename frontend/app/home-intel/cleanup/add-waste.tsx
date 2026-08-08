import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CATEGORIES = ["Clean cardboard", "Metal", "Untreated wood", "Treated wood", "Paint", "Chemical or solvent",
  "Adhesive or caulk", "Concrete or masonry", "Drywall", "Tile", "Electronics", "Batteries", "Yard waste", "Other"];
const UNITS = ["bags", "boxes", "cu ft", "lbs", "gallons"];

export default function AddWaste() {
  const router = useRouter();
  const { sid } = useLocalSearchParams<{ sid: string }>();
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Other");
  const [qty, setQty] = useState(""); const [unit, setUnit] = useState("bags");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name it", "Describe the waste item."); return; }
    setBusy(true);
    const body: any = { name: name.trim(), waste_category: cat, estimated_quantity: qty ? parseFloat(qty) : undefined, unit: qty ? unit : undefined };
    try {
      const r = await api<{ waste: any }>(`/hi/cleanup/sessions/${sid}/waste`, { method: "POST", body });
      router.replace(`/home-intel/cleanup/waste/${r.waste.id}`);
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Waste item" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.label}>What is it?</Text>
        <TextInput testID="w-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Half-can of oil-based paint" placeholderTextColor={colors.onSurfaceTertiary} />

        <Text style={styles.label}>Category</Text>
        <Text style={styles.hint}>Pick the closest match — this drives the safety guidance.</Text>
        <View style={styles.wrap}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}>
              <Text style={[styles.chipText, cat === c && { color: "#fff" }]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Estimated amount (optional)</Text>
        <TextInput testID="w-qty" style={styles.input} value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="e.g. 2" placeholderTextColor={colors.onSurfaceTertiary} />
        {!!qty && (
          <View style={styles.wrap}>
            {UNITS.map((u) => (
              <Pressable key={u} style={[styles.chip, unit === u && styles.chipOn]} onPress={() => setUnit(u)}>
                <Text style={[styles.chipText, unit === u && { color: "#fff" }]}>{u}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable testID="w-save" style={styles.primary} disabled={busy} onPress={save}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Get disposal guidance</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xl, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
