import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Share, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState } from "@/src/components/ui";

const SOURCE_LABEL: Record<string, string> = {
  user_entered: "You told me", user_confirmed: "You confirmed", inferred: "Homie inferred", document: "From a document",
};
const ROLES = [
  { key: "owner", label: "Owner" },
  { key: "renter", label: "Renter" },
  { key: "household_member", label: "Household member" },
];

export default function PropertyBrain() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [newFact, setNewFact] = useState({ label: "", value: "" });
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<any>("/hi/brain/summary")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setRole = async (role: string) => {
    setBusy("role");
    try { setData(await api<any>("/hi/brain/profile", { method: "PUT", body: { occupancy_role: role } })); }
    catch {} finally { setBusy(""); }
  };

  const saveUnknown = async (u: any) => {
    const v = (answer[u.key] || "").trim();
    if (!v) return;
    setBusy(u.key);
    try {
      if (u.key === "property_type") await api("/hi/brain/profile", { method: "PUT", body: { property_type: v } });
      else if (u.key === "region") await api("/hi/brain/profile", { method: "PUT", body: { region: v } });
      else await api("/hi/brain/facts", { method: "POST", body: { key: u.key, label: u.label, value: v } });
      setAnswer((s) => ({ ...s, [u.key]: "" }));
      await load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || ""); }
    finally { setBusy(""); }
  };

  const factAction = async (fid: string, action: string) => {
    setBusy(fid + action);
    try { await api(`/hi/brain/facts/${fid}/action`, { method: "POST", body: { action } }); await load(); }
    catch {} finally { setBusy(""); }
  };

  const addFact = async () => {
    if (!newFact.label.trim() || !newFact.value.trim()) return;
    setBusy("add");
    try {
      await api("/hi/brain/facts", { method: "POST", body: newFact });
      setNewFact({ label: "", value: "" }); setShowAdd(false); await load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || ""); }
    finally { setBusy(""); }
  };

  const renterReport = async () => {
    setBusy("report");
    try {
      const r = await api<any>("/hi/brain/renter-report");
      if (Platform.OS === "web") { try { await (navigator as any).clipboard?.writeText(r.report_text); Alert.alert("Report copied", "Paste it into an email to your landlord or property manager."); } catch { Alert.alert("Maintenance report", r.report_text.slice(0, 800)); } }
      else await Share.share({ message: r.report_text });
    } catch {} finally { setBusy(""); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="pb-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>What Homie Knows</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : !data ? null : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          <Text style={styles.intro}>{data.note}</Text>

          {/* Completeness + next best detail */}
          <View style={styles.sumCard}>
            <View style={styles.sumRow}>
              <Text testID="pb-completeness" style={styles.sumBig}>{data.completeness}%</Text>
              <Text style={styles.sumLabel}>of the details that make guidance sharper</Text>
            </View>
            <View style={styles.progBar}><View style={[styles.progFill, { width: `${data.completeness}%` }]} /></View>
            {data.next_best_detail ? (
              <View testID="pb-next-best" style={styles.nextBest}>
                <MaterialCommunityIcons name="lightbulb-on-outline" size={16} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.nextTitle}>Most valuable next detail: {data.next_best_detail.label}</Text>
                  <Text style={styles.nextWhy}>{data.next_best_detail.why}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Occupancy role */}
          <Text style={styles.sectionTitle}>Your role at {data.property?.name || "this home"}</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => (
              <Pressable key={r.key} testID={`pb-role-${r.key}`} onPress={() => setRole(r.key)} style={[styles.roleChip, data.property?.occupancy_role === r.key && styles.roleChipOn]}>
                {busy === "role" && data.property?.occupancy_role !== r.key ? null : null}
                <Text style={[styles.roleText, data.property?.occupancy_role === r.key && styles.roleTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          {data.renter_mode ? (
            <View testID="pb-renter" style={styles.renterCard}>
              <MaterialCommunityIcons name="shield-account-outline" size={18} color={colors.info} />
              <View style={{ flex: 1 }}>
                <Text style={styles.renterText}>{data.renter_boundary}</Text>
                <Pressable testID="pb-renter-report" onPress={renterReport} style={styles.reportBtn}>
                  {busy === "report" ? <ActivityIndicator size="small" color={colors.info} /> : <Text style={styles.reportText}>Export maintenance report for your landlord</Text>}
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Confirmed records */}
          <Text style={styles.sectionTitle}>Confirmed records</Text>
          <View style={styles.recordGrid}>
            {data.confirmed_records.map((c: any) => (
              <View key={c.label} style={styles.recordCard}>
                <Text style={styles.recordVal}>{c.value}</Text>
                <Text style={styles.recordLabel}>{c.label}</Text>
              </View>
            ))}
          </View>

          {/* Known details */}
          {data.known_details?.length ? (
            <>
              <Text style={styles.sectionTitle}>Details on record</Text>
              {data.known_details.map((k: any) => (
                <View key={k.key} style={styles.factRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.factLabel}>{k.label}</Text>
                    <Text style={styles.factValue}>{k.value}</Text>
                  </View>
                  <View style={styles.provChip}><Text style={styles.provText}>{SOURCE_LABEL[k.source] || k.source}</Text></View>
                </View>
              ))}
            </>
          ) : null}

          {/* Custom facts w/ corrections */}
          {data.facts?.filter((f: any) => !data.known_details.some((k: any) => k.key === f.key)).map((f: any) => (
            <View key={f.id} style={styles.factRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.factLabel}>{f.label}</Text>
                <Text style={styles.factValue}>{f.value}</Text>
              </View>
              <Pressable testID={`pb-outdate-${f.id}`} onPress={() => factAction(f.id, "mark_outdated")} style={styles.factBtn}><Text style={styles.factBtnText}>Outdated</Text></Pressable>
              <Pressable testID={`pb-remove-${f.id}`} onPress={() => factAction(f.id, "remove")} style={styles.factBtn}><Text style={[styles.factBtnText, { color: colors.error }]}>Remove</Text></Pressable>
            </View>
          ))}

          {/* Unknowns */}
          {data.unknowns?.length ? (
            <>
              <Text style={styles.sectionTitle}>Still unknown (all optional)</Text>
              {data.unknowns.map((u: any) => (
                <View key={u.key} testID={`pb-unknown-${u.key}`} style={styles.unknownCard}>
                  <Text style={styles.unknownQ}>{u.label}</Text>
                  <Text style={styles.unknownWhy}>{u.why}</Text>
                  <View style={styles.row}>
                    <TextInput testID={`pb-answer-${u.key}`} value={answer[u.key] || ""} onChangeText={(v) => setAnswer((s) => ({ ...s, [u.key]: v }))} placeholder="Add it (or leave unknown)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                    <Pressable testID={`pb-save-${u.key}`} onPress={() => saveUnknown(u)} style={styles.saveBtn}>
                      {busy === u.key ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="check" size={18} color={colors.onBrandPrimary} />}
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {/* Add any detail */}
          <Pressable testID="pb-add-toggle" onPress={() => setShowAdd(!showAdd)} style={styles.addToggle}>
            <MaterialCommunityIcons name={showAdd ? "minus" : "plus"} size={16} color={colors.brandPrimary} />
            <Text style={styles.addToggleText}>Add another detail Homie should remember</Text>
          </Pressable>
          {showAdd ? (
            <View style={styles.unknownCard}>
              <TextInput testID="pb-new-label" value={newFact.label} onChangeText={(v) => setNewFact((s) => ({ ...s, label: v }))} placeholder="What is it? (e.g. Water heater brand)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              <TextInput testID="pb-new-value" value={newFact.value} onChangeText={(v) => setNewFact((s) => ({ ...s, value: v }))} placeholder="The detail (e.g. Rheem, installed 2019)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              <Pressable testID="pb-new-save" onPress={addFact} style={styles.addBtn}>
                {busy === "add" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.addBtnText}>Save detail</Text>}
              </Pressable>
            </View>
          ) : null}

          {/* Shortcuts to existing builders */}
          <Text style={styles.sectionTitle}>Build the record</Text>
          <View style={styles.row}>
            <Pressable testID="pb-rooms" onPress={() => router.push("/home-intel/rooms" as any)} style={styles.shortcut}><MaterialCommunityIcons name="floor-plan" size={18} color={colors.brandPrimary} /><Text style={styles.shortcutText}>Rooms</Text></Pressable>
            <Pressable testID="pb-assets" onPress={() => router.push("/home-intel/assets" as any)} style={styles.shortcut}><MaterialCommunityIcons name="fridge-outline" size={18} color={colors.brandPrimary} /><Text style={styles.shortcutText}>Assets</Text></Pressable>
            <Pressable testID="pb-docs" onPress={() => router.push("/home-intel/documents" as any)} style={styles.shortcut}><MaterialCommunityIcons name="file-cabinet" size={18} color={colors.brandPrimary} /><Text style={styles.shortcutText}>Documents</Text></Pressable>
          </View>
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
  sumCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  sumRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  sumBig: { fontFamily: font.display, fontSize: type["3xl"], color: colors.onSurface },
  sumLabel: { flex: 1, fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, paddingBottom: 6 },
  progBar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progFill: { height: 6, backgroundColor: colors.brandPrimary },
  nextBest: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md },
  nextTitle: { fontFamily: font.bold, fontSize: type.sm, color: colors.onBrandTertiary },
  nextWhy: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  sectionTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface, marginTop: spacing.sm },
  roleRow: { flexDirection: "row", gap: spacing.sm },
  roleChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  roleChipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  roleText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  roleTextOn: { color: colors.onBrandTertiary },
  renterCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.info + "12", borderColor: colors.info, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  renterText: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary, lineHeight: 18 },
  reportBtn: { marginTop: spacing.sm },
  reportText: { fontFamily: font.bold, fontSize: type.sm, color: colors.info },
  recordGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  recordCard: { flexGrow: 1, minWidth: 100, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  recordVal: { fontFamily: font.display, fontSize: type.xl, color: colors.brandPrimary },
  recordLabel: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  factRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  factLabel: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  factValue: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  provChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  provText: { fontFamily: font.medium, fontSize: 10, color: colors.onSurfaceTertiary },
  factBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  factBtnText: { fontFamily: font.medium, fontSize: type.sm, color: colors.warning },
  unknownCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  unknownQ: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface },
  unknownWhy: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: font.regular, fontSize: type.base },
  saveBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  addToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  addToggleText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  addBtnText: { fontFamily: font.bold, fontSize: type.base, color: colors.onBrandPrimary },
  shortcut: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, backgroundColor: colors.surfaceSecondary },
  shortcutText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurface },
});
