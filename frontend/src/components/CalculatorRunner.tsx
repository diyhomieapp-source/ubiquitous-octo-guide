import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { getCalculator } from "@/src/calculators/registry";

export function CalculatorRunner({ calcId, compact }: { calcId: string; compact?: boolean }) {
  const calc = getCalculator(calcId);
  const [vals, setVals] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    calc?.inputs.forEach((i) => { init[i.key] = i.default ?? 0; });
    return init;
  });

  const output = useMemo(() => {
    if (!calc) return null;
    try { return calc.compute(vals); } catch { return null; }
  }, [calc, vals]);

  if (!calc) return <Text style={styles.missing}>Calculator not found.</Text>;

  const setVal = (k: string, raw: string) => {
    const num = parseFloat(raw.replace(/[^0-9.]/g, ""));
    setVals((p) => ({ ...p, [k]: isNaN(num) ? 0 : num }));
  };

  return (
    <View>
      {!compact && <Text style={styles.blurb}>{calc.blurb}</Text>}

      {/* inputs */}
      {calc.inputs.map((inp) => (
        <View key={inp.key} style={styles.field}>
          <Text style={styles.label}>{inp.label}{inp.unit ? ` (${inp.unit})` : ""}</Text>
          {inp.type === "select" && inp.options ? (
            <View style={styles.selectRow}>
              {inp.options.map((o) => (
                <Pressable key={o.value} testID={`opt-${inp.key}-${o.value}`} onPress={() => setVals((p) => ({ ...p, [inp.key]: o.value }))}
                  style={[styles.optChip, vals[inp.key] === o.value && styles.optChipOn]}>
                  <Text style={[styles.optText, vals[inp.key] === o.value && { color: colors.onBrandPrimary }]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <TextInput
              testID={`input-${inp.key}`}
              style={styles.input}
              keyboardType="numeric"
              value={String(vals[inp.key] ?? "")}
              onChangeText={(t) => setVal(inp.key, t)}
              placeholderTextColor={colors.onSurfaceTertiary}
            />
          )}
        </View>
      ))}

      {/* results */}
      {output && (
        <>
          <View style={styles.resultsCard}>
            {output.results.map((r, i) => (
              <View key={i} style={[styles.resultRow, r.primary && styles.resultPrimary]}>
                <Text style={[styles.resultLabel, r.primary && { color: colors.onBrandPrimary }]}>{r.label}</Text>
                <Text style={[styles.resultValue, r.primary && { color: colors.onBrandPrimary }]}>{r.value}{r.unit ? ` ${r.unit}` : ""}</Text>
              </View>
            ))}
          </View>
          {output.note && <Text style={styles.noteText}>{output.note}</Text>}

          {output.materials.length > 0 && (
            <>
              <View style={styles.shopHead}>
                <MaterialCommunityIcons name="cart-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.shopTitle}>SHOPPING LIST</Text>
              </View>
              <View style={styles.shopCard}>
                {output.materials.map((m, i) => (
                  <View key={i} style={[styles.shopItem, i < output.materials.length - 1 && styles.shopBorder]}>
                    <Text style={styles.shopName}>{m.name}</Text>
                    <Text style={styles.shopQty}>{m.qty} {m.unit}</Text>
                  </View>
                ))}
                <View style={styles.shopSoon}>
                  <MaterialCommunityIcons name="store-outline" size={14} color={colors.onSurfaceTertiary} />
                  <Text style={styles.shopSoonText}>Buy at Home Depot & Lowe's — coming soon</Text>
                </View>
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, padding: spacing.lg },
  blurb: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 19, marginBottom: spacing.lg },
  field: { marginBottom: spacing.md },
  label: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginBottom: 5 },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, outlineStyle: "none" } as any,
  selectRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  optChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  optChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  optText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  resultsCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, padding: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm, overflow: "hidden" },
  resultRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  resultPrimary: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm },
  resultLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  resultValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  noteText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, fontStyle: "italic", marginBottom: spacing.md },
  shopHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  shopTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1 },
  shopCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, paddingHorizontal: spacing.lg },
  shopItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.md },
  shopBorder: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  shopName: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, flex: 1 },
  shopQty: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  shopSoon: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderTopColor: colors.border, borderTopWidth: 1 },
  shopSoonText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
});
