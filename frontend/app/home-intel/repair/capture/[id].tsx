import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, SafetyCard } from "@/src/components/ui";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";

const TEMPLATE_ICON: Record<string, string> = {
  wide_context: "image-filter-hdr", close_up: "magnify-plus-outline", before_after: "compare",
  with_measurement: "ruler", label_model: "barcode-scan", inspection_video: "video-outline",
};

export default function GuidedCapture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [templates, setTemplates] = useState<Record<string, any>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [captured, setCaptured] = useState<string | null>(null); // base64
  const [note, setNote] = useState("");
  const [inference, setInference] = useState<any>(null);
  const [meas, setMeas] = useState({ measure_type: "", value: "", unit: "in" });
  const [savedMsg, setSavedMsg] = useState("");

  const load = useCallback(async () => {
    try { const r = await api<any>("/hi/visual/templates"); setTemplates(r.templates || r || {}); }
    catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const capture = async (fromCamera: boolean) => {
    const b64 = fromCamera ? await takePhoto("Guided capture helps Homie see exactly what it needs.") : await pickFromLibrary("Choose the photo that matches the guide.");
    if (b64) { setCaptured(b64); setInference(null); setSavedMsg(""); }
  };

  const save = async () => {
    if (!captured || !selected) return;
    setBusy("save");
    try {
      await api(`/hi/repair/issues/${id}/evidence`, { method: "POST", body: { type: "photo", base64: captured, note: `[${templates[selected]?.purpose || selected}]${note.trim() ? " " + note.trim() : ""}` } });
      try { await api(`/hi/visual/issues/${id}/capture-request`, { method: "POST", body: { template: selected, note: note.trim() || null } }); } catch {}
      setSavedMsg("Saved to this project's evidence.");
      setNote("");
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || ""); }
    finally { setBusy(""); }
  };

  const analyze = async () => {
    if (!captured) return;
    setBusy("infer");
    try { const r = await api<any>(`/hi/visual/issues/${id}/infer`, { method: "POST", body: { base64: captured } }); setInference(r.inference || r); }
    catch (e: any) { Alert.alert("Couldn't analyze", e?.message || ""); }
    finally { setBusy(""); }
  };

  const addMeasurement = async () => {
    const v = parseFloat(meas.value);
    if (!meas.measure_type.trim() || isNaN(v)) { Alert.alert("Add what you measured and the number."); return; }
    setBusy("meas");
    try {
      await api(`/hi/visual/issues/${id}/measurements`, { method: "POST", body: { measure_type: meas.measure_type.trim(), value: v, unit: meas.unit, source_method: "manual", note: note.trim() || null } });
      setMeas({ measure_type: "", value: "", unit: meas.unit });
      setSavedMsg("Measurement recorded.");
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || ""); }
    finally { setBusy(""); }
  };

  const t = selected ? templates[selected] : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="gc-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Guided Capture</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          <Text style={styles.intro}>Pick what you're capturing — Homie tells you exactly how to frame it so the photo is actually useful.</Text>

          {/* Template picker */}
          <View style={styles.tplGrid}>
            {Object.keys(templates).map((key) => (
              <Pressable key={key} testID={`gc-tpl-${key}`} onPress={() => setSelected(key)} style={[styles.tplCard, selected === key && styles.tplOn]}>
                <MaterialCommunityIcons name={(TEMPLATE_ICON[key] || "camera-outline") as any} size={20} color={selected === key ? colors.onBrandTertiary : colors.brandPrimary} />
                <Text style={[styles.tplText, selected === key && { color: colors.onBrandTertiary }]}>{key.replace(/_/g, " ")}</Text>
              </Pressable>
            ))}
          </View>

          {t ? (
            <View testID="gc-guide" style={styles.guideCard}>
              <Text style={styles.guideTitle}>{t.purpose}</Text>
              <Text style={styles.guideRow}>📐 {t.framing}</Text>
              <Text style={styles.guideRow}>↔️ Distance: {t.distance}</Text>
              <Text style={styles.guideRow}>📱 {t.orientation}</Text>
              {t.reference_scale ? <Text style={styles.guideRow}>📏 Include: {t.reference_scale}</Text> : null}
              {t.privacy_reminder ? <Text style={[styles.guideRow, { color: colors.warning }]}>🔒 {t.privacy_reminder}</Text> : null}
              <View style={styles.inferBox}>
                <Text style={styles.inferLabel}>Homie CAN read: <Text style={styles.inferVal}>{t.will_infer}</Text></Text>
                <Text style={styles.inferLabel}>Homie WON'T guess: <Text style={styles.inferVal}>{t.wont_infer}</Text></Text>
              </View>
              <View style={styles.rowBtns}>
                <Button testID="gc-camera" label="Take photo" icon="camera-outline" onPress={() => capture(true)} />
                <Button testID="gc-upload" label="Upload" icon="image-outline" variant="secondary" onPress={() => capture(false)} />
              </View>
            </View>
          ) : null}

          {captured ? (
            <View style={styles.capturedCard}>
              <View style={styles.capturedHead}>
                <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
                <Text style={styles.capturedText}>Photo ready</Text>
                <Pressable testID="gc-retake" onPress={() => capture(true)}><Text style={styles.linkText}>Retake</Text></Pressable>
              </View>
              <TextInput testID="gc-note" value={note} onChangeText={setNote} placeholder="Add an annotation (what should Homie look at?)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              <View style={styles.rowBtns}>
                <Button testID="gc-save" label="Save to evidence" icon="content-save-outline" loading={busy === "save"} onPress={save} />
                <Button testID="gc-analyze" label="Analyze with Homie" icon="magnify-scan" variant="secondary" loading={busy === "infer"} onPress={analyze} />
              </View>
              {savedMsg ? <Text style={styles.savedText}>{savedMsg}</Text> : null}
            </View>
          ) : null}

          {inference ? (
            <View testID="gc-inference" style={styles.guideCard}>
              <Text style={styles.guideTitle}>What Homie sees</Text>
              {inference.high_risk_blocked || inference.professional_verification_required ? (
                <SafetyCard level="verify" title="Professional verification required" message="This looks like it involves a high-risk system — Homie won't authorize action from a photo alone. Have a professional confirm." />
              ) : null}
              <Text style={styles.guideRow}>{inference.summary || inference.description || JSON.stringify(inference.findings || inference).slice(0, 400)}</Text>
              {(inference.quality_warnings || []).map((w: string, i: number) => <Text key={i} style={[styles.guideRow, { color: colors.warning }]}>⚠️ {w}</Text>)}
              <Text style={styles.hint}>Photo analysis is an estimate — verify before purchase or invasive work.</Text>
            </View>
          ) : null}

          {/* Measurement */}
          <Text style={styles.sectionTitle}>Record a measurement</Text>
          <View style={styles.measRow}>
            <TextInput testID="gc-meas-type" value={meas.measure_type} onChangeText={(v) => setMeas((s) => ({ ...s, measure_type: v }))} placeholder="What? (e.g. gap width)" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { flex: 2 }]} />
            <TextInput testID="gc-meas-value" value={meas.value} onChangeText={(v) => setMeas((s) => ({ ...s, value: v }))} placeholder="0.0" keyboardType="numeric" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
            <Pressable testID="gc-meas-unit" onPress={() => setMeas((s) => ({ ...s, unit: s.unit === "in" ? "cm" : s.unit === "cm" ? "ft" : s.unit === "ft" ? "m" : "in" }))} style={styles.unitBtn}>
              <Text style={styles.unitText}>{meas.unit}</Text>
            </Pressable>
          </View>
          <Button testID="gc-meas-save" label="Save measurement" icon="ruler" variant="secondary" loading={busy === "meas"} onPress={addMeasurement} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerTitle: { fontFamily: font.display, fontSize: type.xl, color: colors.onSurface, letterSpacing: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  intro: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, lineHeight: 18 },
  tplGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tplCard: { flexGrow: 1, minWidth: 100, alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  tplOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  tplText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary, textTransform: "capitalize", textAlign: "center" },
  guideCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  guideTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  guideRow: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  inferBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  inferLabel: { fontFamily: font.bold, fontSize: type.sm, color: colors.onSurfaceTertiary },
  inferVal: { fontFamily: font.regular, color: colors.onSurfaceSecondary },
  rowBtns: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  capturedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.success },
  capturedHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  capturedText: { flex: 1, fontFamily: font.bold, fontSize: type.base, color: colors.success },
  linkText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: font.regular, fontSize: type.base },
  savedText: { fontFamily: font.medium, fontSize: type.sm, color: colors.success },
  hint: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  sectionTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface, marginTop: spacing.sm },
  measRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  unitBtn: { width: 52, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  unitText: { fontFamily: font.bold, fontSize: type.base, color: colors.brandPrimary },
});
