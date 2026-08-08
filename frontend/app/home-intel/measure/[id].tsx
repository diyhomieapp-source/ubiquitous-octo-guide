import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const UNITS = ["inches", "feet", "centimeters", "meters"];
const CONF = ["low", "medium", "high"];
const SRC_LABEL: Record<string, string> = { manual: "Manual", camera_estimate: "Camera estimate", ar_future: "AR (future)", measureassist_future: "MeasureAssist", imported_future: "Imported" };

export default function MeasurementDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [m, setM] = useState<any>(null);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [len, setLen] = useState(""); const [wid, setWid] = useState(""); const [hei, setHei] = useState("");
  const [unit, setUnit] = useState("feet"); const [conf, setConf] = useState("medium"); const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ measurement: any; revisions: any[] }>(`/hi/measurements/${id}`);
      setM(d.measurement); setRevisions(d.revisions || []);
      setLen(d.measurement.length_value != null ? String(d.measurement.length_value) : "");
      setWid(d.measurement.width_value != null ? String(d.measurement.width_value) : "");
      setHei(d.measurement.height_value != null ? String(d.measurement.height_value) : "");
      setUnit(d.measurement.unit || "feet");
      setConf(d.measurement.confidence_level || "medium");
      setNotes(d.measurement.notes || "");
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    setBusy(true);
    const body: any = {
      unit, confidence_level: conf, notes: notes.trim() || undefined,
      length_value: len ? parseFloat(len) : undefined,
      width_value: wid ? parseFloat(wid) : undefined,
      height_value: hei ? parseFloat(hei) : undefined,
      reason: "Edited by user",
    };
    try { await api(`/hi/measurements/${id}`, { method: "PUT", body }); await load(); Alert.alert("Saved", "Measurement updated."); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try { await api(`/hi/measurements/${id}/confirm`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't confirm", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  const del = () => {
    Alert.alert("Delete measurement?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api(`/hi/measurements/${id}`, { method: "DELETE" }); router.back(); } catch (e: any) { Alert.alert("Couldn't delete", e?.message || "Try again."); }
      } },
    ]);
  };

  if (loading || !m) return <View style={styles.root}><ScreenHeader title="Measurement" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const isEstimate = m.source === "camera_estimate";
  const confirmed = m.verification_status === "user_confirmed";

  return (
    <View style={styles.root}>
      <ScreenHeader title={m.name} right={
        <Pressable testID="m-delete" onPress={del} hitSlop={10}><MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} /></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.tagRow}>
          <View style={styles.tag}><Text style={styles.tagText}>{m.measurement_type}</Text></View>
          <View style={styles.tag}><Text style={styles.tagText}>{SRC_LABEL[m.source] || m.source}</Text></View>
          {confirmed ? (
            <View style={[styles.tag, { borderColor: colors.success }]}><MaterialCommunityIcons name="check-decagram" size={13} color={colors.success} /><Text style={[styles.tagText, { color: colors.success }]}> Confirmed</Text></View>
          ) : isEstimate ? (
            <View style={[styles.tag, { borderColor: colors.warning }]}><Text style={[styles.tagText, { color: colors.warning }]}>ESTIMATE</Text></View>
          ) : null}
        </View>

        {isEstimate && !confirmed && <Text style={styles.warn}>⚠︎ This is a camera estimate. Verify it before purchasing materials or beginning construction.</Text>}

        <Text style={styles.label}>Dimensions ({unit})</Text>
        <View style={styles.row}>
          <TextInput testID="d-length" style={styles.dim} value={len} onChangeText={setLen} keyboardType="decimal-pad" placeholder="Length" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput testID="d-width" style={styles.dim} value={wid} onChangeText={setWid} keyboardType="decimal-pad" placeholder="Width" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput testID="d-height" style={styles.dim} value={hei} onChangeText={setHei} keyboardType="decimal-pad" placeholder="Height" placeholderTextColor={colors.onSurfaceTertiary} />
        </View>
        <View style={styles.wrap}>
          {UNITS.map((u) => (
            <Pressable key={u} style={[styles.miniChip, unit === u && styles.chipOn]} onPress={() => setUnit(u)}>
              <Text style={[styles.miniText, unit === u && { color: "#fff" }]}>{u}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Confidence</Text>
        <View style={styles.row}>
          {CONF.map((c) => (
            <Pressable key={c} style={[styles.chip, conf === c && styles.chipOn]} onPress={() => setConf(c)}>
              <Text style={[styles.chipText, conf === c && { color: "#fff" }]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Notes</Text>
        <TextInput testID="d-notes" style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} multiline placeholder="Anything to remember" placeholderTextColor={colors.onSurfaceTertiary} />

        <Pressable testID="d-save" style={styles.primary} disabled={busy} onPress={save}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save changes</Text>}
        </Pressable>

        {!confirmed && (
          <Pressable testID="d-confirm" style={styles.outline} disabled={busy} onPress={confirm}>
            <MaterialCommunityIcons name="check-decagram-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.outlineText}>I verified this measurement</Text>
          </Pressable>
        )}

        {revisions.length > 0 && (
          <>
            <Text style={styles.section}>Edit history</Text>
            {revisions.map((r) => (
              <View key={r.id} style={styles.revRow}>
                <MaterialCommunityIcons name="history" size={15} color={colors.onSurfaceTertiary} />
                <Text style={styles.revText}>{r.field.replace("_value", "")}: {r.previous_value ?? "—"} → {r.new_value}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  tagText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  warn: { color: colors.warning, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.md, lineHeight: 20 },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  row: { flexDirection: "row", gap: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  dim: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textAlign: "center" },
  chip: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.sm, paddingVertical: spacing.sm },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  miniChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  miniText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xl, minHeight: 48, justifyContent: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  outline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  outlineText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  revRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  revText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
});
