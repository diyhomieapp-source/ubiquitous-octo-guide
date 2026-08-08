import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CATEGORIES = ["Lumber", "Paint", "Tile", "Flooring", "Drywall", "Hardware", "Fasteners", "Adhesive", "Trim", "Insulation", "Electrical", "Plumbing", "Other"];
const CONDITIONS = ["new", "good", "usable", "poor"];
const UNITS = ["pieces", "boxes", "sq ft", "linear ft", "gallons", "lbs"];

export default function AddLeftover() {
  const router = useRouter();
  const { sid } = useLocalSearchParams<{ sid: string }>();
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Other");
  const [qty, setQty] = useState(""); const [unit, setUnit] = useState("pieces");
  const [cond, setCond] = useState("good");
  const [loc, setLoc] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name it", "Give this material a name."); return; }
    setBusy(true);
    const body: any = { name: name.trim(), material_category: cat, condition: cond,
      quantity: qty ? parseFloat(qty) : undefined, unit: qty ? unit : undefined, storage_location: loc.trim() || undefined };
    try { await api(`/hi/cleanup/sessions/${sid}/leftovers`, { method: "POST", body }); router.back(); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Leftover material" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.label}>Name</Text>
        <TextInput testID="lo-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. White subway tile" placeholderTextColor={colors.onSurfaceTertiary} />

        <Text style={styles.label}>Category</Text>
        <View style={styles.wrap}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}>
              <Text style={[styles.chipText, cat === c && { color: "#fff" }]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Quantity (optional)</Text>
        <View style={styles.row}>
          <TextInput testID="lo-qty" style={[styles.input, { flex: 1 }]} value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="e.g. 12" placeholderTextColor={colors.onSurfaceTertiary} />
        </View>
        {!!qty && (
          <View style={styles.wrap}>
            {UNITS.map((u) => (
              <Pressable key={u} style={[styles.chip, unit === u && styles.chipOn]} onPress={() => setUnit(u)}>
                <Text style={[styles.chipText, unit === u && { color: "#fff" }]}>{u}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.label}>Condition</Text>
        <View style={styles.row}>
          {CONDITIONS.map((c) => (
            <Pressable key={c} style={[styles.condChip, cond === c && styles.chipOn]} onPress={() => setCond(c)}>
              <Text style={[styles.chipText, cond === c && { color: "#fff" }]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Where is it stored? (optional)</Text>
        <TextInput testID="lo-loc" style={styles.input} value={loc} onChangeText={setLoc} placeholder="e.g. Garage shelf" placeholderTextColor={colors.onSurfaceTertiary} />

        <Pressable testID="lo-save" style={styles.primary} disabled={busy} onPress={save}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Add material</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  row: { flexDirection: "row", gap: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  condChip: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.sm, paddingVertical: spacing.sm },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xl, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
