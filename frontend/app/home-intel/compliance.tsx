import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, TextInput, Modal } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const LEVEL_META: Record<string, { label: string; color: string; icon: string }> = {
  general_guidance: { label: "General guidance", color: "#27AE60", icon: "check-circle-outline" },
  verify_locally: { label: "Verify locally", color: "#2F80ED", icon: "map-marker-question-outline" },
  permit_inquiry_recommended: { label: "Permit inquiry recommended", color: "#F2994A", icon: "file-document-alert-outline" },
  professional_review_recommended: { label: "Professional review recommended", color: "#EB5757", icon: "account-hard-hat" },
};

export default function Compliance() {
  const { project_id } = useLocalSearchParams<{ project_id?: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [jur, setJur] = useState<any>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [state, setState] = useState(""); const [city, setCity] = useState(""); const [postal, setPostal] = useState("");

  const load = useCallback(async () => {
    try {
      const [a, j] = await Promise.all([api(`/hi/compliance/assess`, { method: "POST", body: { project_id } }), api("/hi/compliance/jurisdiction")]);
      setData(a); setJur(j.jurisdiction);
    } catch (e: any) { Alert.alert("Couldn't assess", e?.message || "Try again."); } finally { setLoading(false); }
  }, [project_id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (item: any, status: string) => {
    try { await api(`/hi/compliance/checklist/${item.id}/status`, { method: "POST", body: { status } }); await load(); } catch {}
  };
  const saveLocation = async () => {
    setBusy(true);
    try { await api("/hi/compliance/jurisdiction", { method: "PUT", body: { country: "US", state_or_region: state.trim() || null, city: city.trim() || null, postal_code: postal.trim() || null } }); setLocOpen(false); await load(); }
    catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const createPackage = async () => {
    setBusy(true);
    try { const r = await api("/hi/compliance/package", { method: "POST", body: { project_id } }); Alert.alert("Package created", "A preliminary info package was saved to your project. " + r.package.labels[0]); }
    catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const markVerified = async () => {
    if (!data?.assessment) return;
    try { await api(`/hi/compliance/assessments/${data.assessment.id}/verified`, { method: "POST" }); Alert.alert("Noted", "Marked as verified by you."); await load(); } catch {}
  };

  if (loading || !data?.assessment) return <View style={styles.root}><ScreenHeader title="Permits & Code" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const a = data.assessment; const m = LEVEL_META[a.assessment_level] || LEVEL_META.verify_locally;
  const pro = data.professional_escalation;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Permits & Code" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.h}>Before you begin</Text>
        <View style={[styles.levelCard, { borderColor: m.color + "66", backgroundColor: m.color + "12" }]}>
          <MaterialCommunityIcons name={m.icon as any} size={24} color={m.color} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.levelTitle, { color: m.color }]}>{m.label}</Text>
            <Text style={styles.levelSummary}>{a.summary}</Text>
          </View>
        </View>

        <Pressable testID="comp-location" style={styles.locRow} onPress={() => setLocOpen(true)}>
          <MaterialCommunityIcons name="map-marker-outline" size={16} color={colors.brandPrimary} />
          <Text style={styles.locText}>{jur ? `${jur.city || ""}${jur.city ? ", " : ""}${jur.state_or_region || ""} ${jur.postal_code || ""} · tap to edit` : "Add your location for better guidance"}</Text>
        </Pressable>

        {a.work_categories?.length ? (
          <View style={styles.catWrap}>
            {a.work_categories.map((c: string) => <View key={c} style={styles.catChip}><Text style={styles.catText}>{c.replace(/_/g, " ")}</Text></View>)}
          </View>
        ) : null}

        {pro?.recommended ? (
          <View style={styles.proCard}>
            <Text style={styles.proTitle}>Consider a professional</Text>
            {(pro.reasons || []).map((rn: string, i: number) => <Text key={i} style={styles.proReason}>• {rn}</Text>)}
            <Pressable testID="comp-pro" style={styles.proBtn} onPress={() => router.push(`/home-intel/projects/${project_id}`)}>
              <Text style={styles.proBtnText}>Create Professional Job Summary</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.section}>What to check</Text>
        {(data.checklist || []).map((it: any) => (
          <View key={it.id} style={styles.item}>
            <Pressable testID={`comp-check-${it.id}`} onPress={() => setStatus(it, it.status === "completed" ? "pending" : "completed")} style={styles.checkBox}>
              <MaterialCommunityIcons name={it.status === "completed" ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={it.status === "completed" ? colors.brandPrimary : colors.onSurfaceTertiary} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, it.status === "completed" && styles.done]}>{it.title}</Text>
              <Text style={styles.itemDesc}>{it.description}</Text>
              <Text style={styles.itemSrc}>{it.source_reference}{it.source_date ? ` · ${it.source_date}` : ""} · {it.required === "unknown" ? "verify locally" : (it.required === "true" ? "likely required" : "usually not required")}</Text>
            </View>
          </View>
        ))}

        <View style={styles.actions}>
          <Pressable testID="comp-package" disabled={busy} style={styles.primaryBtn} onPress={createPackage}><Text style={styles.primaryText}>Create info package</Text></Pressable>
          <Pressable testID="comp-verified" disabled={busy} style={styles.outlineBtn} onPress={markVerified}><Text style={styles.outlineText}>{a.verified_by_user ? "✓ Verified by you" : "I've already verified this"}</Text></Pressable>
        </View>

        <Text style={styles.disclaimer}>{data.disclaimer}</Text>
      </ScrollView>

      <Modal visible={locOpen} transparent animationType="slide" onRequestClose={() => setLocOpen(false)}>
        <View style={styles.modalWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Your location (optional)</Text>
          <Text style={styles.disclaimer}>Used to tailor guidance. Your address is never shared without your approval.</Text>
          <TextInput testID="comp-state" value={state} onChangeText={setState} placeholder="State / region" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="comp-city" value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="comp-postal" value={postal} onChangeText={setPostal} placeholder="Postal code" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <View style={styles.sheetBtns}>
            <Pressable style={[styles.sheetBtn, styles.sheetCancel]} onPress={() => setLocOpen(false)}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
            <Pressable testID="comp-loc-save" disabled={busy} style={[styles.sheetBtn, styles.sheetGo]} onPress={saveLocation}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sheetGoText}>Save</Text>}</Pressable>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  h: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.sm },
  levelCard: { flexDirection: "row", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  levelTitle: { fontFamily: font.bold, fontSize: type.base },
  levelSummary: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 3, lineHeight: 19 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  locText: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm },
  catWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  catChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  catText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  proCard: { backgroundColor: "#EB575712", borderColor: "#EB575744", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  proTitle: { color: "#EB5757", fontFamily: font.bold, fontSize: type.base, marginBottom: 4 },
  proReason: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 18 },
  proBtn: { backgroundColor: "#EB5757", borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: "center", marginTop: spacing.sm },
  proBtnText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  item: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  checkBox: { paddingTop: 1 },
  itemTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  done: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  itemDesc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, lineHeight: 18 },
  itemSrc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 4 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  primaryText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  outlineBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  outlineText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.md },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.sm },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  sheetBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  sheetCancel: { borderColor: colors.border, borderWidth: 1 },
  sheetCancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  sheetGo: { backgroundColor: colors.brandPrimary },
  sheetGoText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
});
