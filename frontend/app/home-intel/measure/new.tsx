import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const UNITS = ["inches", "feet", "centimeters", "meters"];
const TYPES = ["Room Length", "Wall Width", "Ceiling Height", "Door Opening", "Window Opening", "Furniture", "Appliance", "Exterior Area", "Other"];
const CONF = ["low", "medium", "high"];

export default function NewMeasurement() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; project_id?: string; room_id?: string; request_id?: string }>();
  const [name, setName] = useState("");
  const [mtype, setMtype] = useState((params.type as string) || "Other");
  const [len, setLen] = useState(""); const [wid, setWid] = useState(""); const [hei, setHei] = useState("");
  const [unit, setUnit] = useState("feet");
  const [source, setSource] = useState<"manual" | "camera_estimate">("manual");
  const [conf, setConf] = useState("medium");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name it", "Give this measurement a name."); return; }
    if (!len && !wid && !hei) { Alert.alert("Add a dimension", "Enter at least one value."); return; }
    setBusy(true);
    const body: any = { name: name.trim(), measurement_type: mtype, unit, source, confidence_level: source === "camera_estimate" ? "low" : conf, notes: notes.trim() || undefined,
      length_value: len ? parseFloat(len) : undefined, width_value: wid ? parseFloat(wid) : undefined, height_value: hei ? parseFloat(hei) : undefined,
      project_id: params.project_id, room_id: params.room_id };
    try {
      if (params.request_id) {
        await api(`/hi/measurements/requests/${params.request_id}/complete`, { method: "POST", body: { create: body } });
      } else {
        await api("/hi/measurements", { method: "POST", body });
      }
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="New measurement" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.label}>Mode</Text>
        <View style={styles.row}>
          {(["manual", "camera_estimate"] as const).map((s) => (
            <Pressable key={s} testID={`mode-${s}`} style={[styles.chip, source === s && styles.chipOn]} onPress={() => setSource(s)}>
              <Text style={[styles.chipText, source === s && { color: "#fff" }]}>{s === "manual" ? "Manual" : "Camera estimate"}</Text>
            </Pressable>
          ))}
        </View>
        {source === "camera_estimate" && <Text style={styles.warn}>⚠︎ Verify this measurement before purchasing materials or beginning construction.</Text>}

        <Text style={styles.label}>Name</Text>
        <TextInput testID="m-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. North wall" placeholderTextColor={colors.onSurfaceTertiary} />

        <Text style={styles.label}>Type</Text>
        <View style={styles.wrap}>
          {TYPES.map((t) => (
            <Pressable key={t} style={[styles.miniChip, mtype === t && styles.chipOn]} onPress={() => setMtype(t)}>
              <Text style={[styles.miniText, mtype === t && { color: "#fff" }]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Dimensions ({unit})</Text>
        <View style={styles.row}>
          <TextInput testID="m-length" style={styles.dim} value={len} onChangeText={setLen} keyboardType="decimal-pad" placeholder="Length" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput testID="m-width" style={styles.dim} value={wid} onChangeText={setWid} keyboardType="decimal-pad" placeholder="Width" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput testID="m-height" style={styles.dim} value={hei} onChangeText={setHei} keyboardType="decimal-pad" placeholder="Height" placeholderTextColor={colors.onSurfaceTertiary} />
        </View>
        <View style={styles.wrap}>
          {UNITS.map((u) => (
            <Pressable key={u} style={[styles.miniChip, unit === u && styles.chipOn]} onPress={() => setUnit(u)}>
              <Text style={[styles.miniText, unit === u && { color: "#fff" }]}>{u}</Text>
            </Pressable>
          ))}
        </View>

        {source === "manual" && (
          <>
            <Text style={styles.label}>Confidence</Text>
            <View style={styles.row}>
              {CONF.map((c) => (
                <Pressable key={c} style={[styles.chip, conf === c && styles.chipOn]} onPress={() => setConf(c)}>
                  <Text style={[styles.chipText, conf === c && { color: "#fff" }]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput testID="m-notes" style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} multiline placeholder="Anything to remember" placeholderTextColor={colors.onSurfaceTertiary} />

        <Pressable testID="m-save" style={styles.primary} disabled={busy} onPress={save}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save measurement</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  warn: { color: "#F2994A", fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  row: { flexDirection: "row", gap: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  chip: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.sm, paddingVertical: spacing.sm },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  miniChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  miniText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  dim: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textAlign: "center" },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.lg, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
