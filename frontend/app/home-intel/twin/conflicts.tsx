import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function TwinConflicts() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualVal, setManualVal] = useState("");

  const load = useCallback(async () => {
    try { const d = await api<{ conflicts: any[] }>("/hi/twin/conflicts"); setRows(d.conflicts); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resolve = async (cid: string, resolution: string, manual_value?: number) => {
    setBusy(true);
    try { await api(`/hi/twin/conflicts/${cid}/resolve`, { method: "POST", body: { resolution, manual_value } }); setManualFor(null); setManualVal(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't resolve", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Review conflicts" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Review conflicts" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {rows.length === 0 ? (
          <View style={styles.doneWrap}>
            <MaterialCommunityIcons name="check-decagram" size={40} color={colors.success} />
            <Text style={styles.doneText}>No conflicts to review. Your twin is consistent.</Text>
            <Pressable testID="conf-back" style={styles.outline} onPress={() => router.back()}><Text style={styles.outlineText}>Back to twin</Text></Pressable>
          </View>
        ) : rows.map((c) => {
          const d = c.detail || {};
          return (
            <View key={c.id} testID={`conflict-${c.id}`} style={styles.card}>
              <Text style={styles.q}>Two measurements for “{d.label}” differ. Which should DIYhomie use?</Text>
              <View style={styles.optRow}>
                <View style={styles.opt}>
                  <Text style={styles.optVal}>{d.existing_value} {d.unit}</Text>
                  <Text style={styles.optSrc}>Existing · {d.existing_source}</Text>
                </View>
                <MaterialCommunityIcons name="swap-horizontal" size={18} color={colors.onSurfaceTertiary} />
                <View style={styles.opt}>
                  <Text style={styles.optVal}>{d.new_value} {d.unit}</Text>
                  <Text style={styles.optSrc}>New · {d.new_source}</Text>
                </View>
              </View>

              <View style={styles.btnGrid}>
                <Pressable testID={`keep-${c.id}`} disabled={busy} style={styles.actBtn} onPress={() => resolve(c.id, "keep_existing")}><Text style={styles.actText}>Keep existing</Text></Pressable>
                <Pressable testID={`use-${c.id}`} disabled={busy} style={styles.actBtn} onPress={() => resolve(c.id, "use_new")}><Text style={styles.actText}>Use new value</Text></Pressable>
                <Pressable testID={`manual-${c.id}`} disabled={busy} style={styles.actBtn} onPress={() => setManualFor(manualFor === c.id ? null : c.id)}><Text style={styles.actText}>Enter manually</Text></Pressable>
                <Pressable testID={`unknown-${c.id}`} disabled={busy} style={styles.actBtn} onPress={() => resolve(c.id, "unknown")}><Text style={styles.actText}>Mark unknown</Text></Pressable>
              </View>

              {manualFor === c.id && (
                <View style={styles.row}>
                  <TextInput testID={`manual-input-${c.id}`} style={styles.input} value={manualVal} onChangeText={setManualVal} keyboardType="decimal-pad" placeholder={`Correct ${d.unit} value`} placeholderTextColor={colors.onSurfaceTertiary} />
                  <Pressable testID={`manual-save-${c.id}`} disabled={busy || !manualVal} style={styles.saveBtn} onPress={() => resolve(c.id, "manual", parseFloat(manualVal))}><Text style={styles.saveText}>Save</Text></Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  doneWrap: { alignItems: "center", paddingTop: spacing["3xl"], gap: spacing.md },
  doneText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, textAlign: "center" },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  q: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, lineHeight: 21 },
  optRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.md },
  opt: { flex: 1, alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md },
  optVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: type.xl },
  optSrc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, textTransform: "capitalize" },
  btnGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  actBtn: { flexGrow: 1, alignItems: "center", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, minWidth: "47%" },
  actText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textAlign: "center" },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  outline: { alignItems: "center", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.md },
  outlineText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
});
