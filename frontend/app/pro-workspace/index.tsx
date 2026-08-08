import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Modal } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const STATUS_COLOR: Record<string, string> = { draft: "#888", active: colors.brandPrimary, review: "#F2994A", delivered: "#27AE60", archived: "#888" };

export default function ProHome() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [role, setRole] = useState("architect");
  const [org, setOrg] = useState("");
  const [projOpen, setProjOpen] = useState(false);
  const [pname, setPname] = useState("");
  const [ptype, setPtype] = useState("existing_conditions");

  const load = useCallback(async () => {
    try {
      const m = await api<any>("/hi/pro/me");
      setMe(m);
      if (m.profile?.status === "active") {
        const p = await api<any>("/hi/pro/projects");
        setProjects(p.projects || []);
      }
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const enroll = async () => {
    setBusy(true);
    try { await api("/hi/pro/enroll", { method: "POST", body: { professional_role: role, organization_name: org.trim() || null } }); setEnrollOpen(false); await load(); }
    catch (e: any) { Alert.alert("Couldn't enroll", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const createProject = async () => {
    if (!pname.trim()) { Alert.alert("Name needed", "Give the project a name."); return; }
    setBusy(true);
    try { const r = await api<any>("/hi/pro/projects", { method: "POST", body: { project_name: pname.trim(), project_type: ptype } }); setProjOpen(false); setPname(""); router.push(`/pro-workspace/${r.project.id}`); }
    catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Pro Workspace" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const active = me?.profile?.status === "active";

  return (
    <View style={styles.root}>
      <ScreenHeader title="Pro Workspace" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {!active ? (
          <View style={styles.enrollCard}>
            <MaterialCommunityIcons name="briefcase-outline" size={30} color={colors.brandPrimary} />
            <Text style={styles.enrollTitle}>Professional workspace</Text>
            <Text style={styles.enrollBody}>Structured existing-conditions capture, QA review, and client deliverables — built on the same DIYhomie foundation.</Text>
            {me?.profile?.status === "pending" ? <Text style={styles.pending}>Your access request is pending approval.</Text> :
              <Pressable testID="pro-enroll-open" style={styles.primaryBtn} onPress={() => setEnrollOpen(true)}><Text style={styles.primaryText}>Enroll as a professional</Text></Pressable>}
          </View>
        ) : (
          <>
            <Pressable testID="pro-new-project" style={styles.newBtn} onPress={() => setProjOpen(true)}>
              <MaterialCommunityIcons name="plus" size={20} color="#fff" /><Text style={styles.newText}>New client project</Text>
            </Pressable>
            <Text style={styles.section}>Your projects</Text>
            {projects.length === 0 ? <Text style={styles.empty}>No projects yet.</Text> :
              projects.map((p) => (
                <Pressable key={p.id} testID={`pro-project-${p.id}`} style={styles.projRow} onPress={() => router.push(`/pro-workspace/${p.id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.projName} numberOfLines={1}>{p.project_name}</Text>
                    <Text style={styles.projMeta}>{p.project_type.replace(/_/g, " ")}{p.client_reference ? ` · ${p.client_reference}` : ""}</Text>
                  </View>
                  <View style={[styles.tag, { borderColor: STATUS_COLOR[p.status] }]}><Text style={[styles.tagText, { color: STATUS_COLOR[p.status] }]}>{p.status}</Text></View>
                </Pressable>
              ))}
          </>
        )}
        <Text style={styles.note}>DIYhomie never claims survey-grade or permit-ready accuracy. QA flags data-quality — you make the final call.</Text>
      </ScrollView>

      <Modal visible={enrollOpen} transparent animationType="slide" onRequestClose={() => setEnrollOpen(false)}>
        <View style={styles.modalWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Enroll</Text>
          <Text style={styles.label}>Your role</Text>
          <View style={styles.chipRow}>{(me?.roles || []).map((rr: string) => <Pressable key={rr} testID={`pro-role-${rr}`} style={[styles.chip, role === rr && styles.chipOn]} onPress={() => setRole(rr)}><Text style={[styles.chipText, role === rr && styles.chipTextOn]}>{rr.replace(/_/g, " ")}</Text></Pressable>)}</View>
          <TextInput testID="pro-org" value={org} onChangeText={setOrg} placeholder="Organization (optional)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <View style={styles.sheetBtns}>
            <Pressable style={[styles.sheetBtn, styles.cancel]} onPress={() => setEnrollOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
            <Pressable testID="pro-enroll" disabled={busy} style={[styles.sheetBtn, styles.go]} onPress={enroll}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.goText}>Enroll</Text>}</Pressable>
          </View>
        </View></View>
      </Modal>

      <Modal visible={projOpen} transparent animationType="slide" onRequestClose={() => setProjOpen(false)}>
        <View style={styles.modalWrap}><View style={styles.sheet}>
          <Text style={styles.sheetTitle}>New project</Text>
          <TextInput testID="pro-pname" value={pname} onChangeText={setPname} placeholder="Project name (e.g. 123 Main St)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <Text style={styles.label}>Type</Text>
          <View style={styles.chipRow}>{(me?.project_types || []).map((t: string) => <Pressable key={t} testID={`pro-ptype-${t}`} style={[styles.chip, ptype === t && styles.chipOn]} onPress={() => setPtype(t)}><Text style={[styles.chipText, ptype === t && styles.chipTextOn]}>{t.replace(/_/g, " ")}</Text></Pressable>)}</View>
          <View style={styles.sheetBtns}>
            <Pressable style={[styles.sheetBtn, styles.cancel]} onPress={() => setProjOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
            <Pressable testID="pro-create" disabled={busy} style={[styles.sheetBtn, styles.go]} onPress={createProject}>{busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.goText}>Create</Text>}</Pressable>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  enrollCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, alignItems: "center", gap: spacing.sm },
  enrollTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  enrollBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", lineHeight: 19 },
  pending: { color: "#F2994A", fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.sm },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  newText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  projRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  projName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  projMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.lg },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: "center", marginTop: spacing.sm },
  primaryText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.sm, marginBottom: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  chipTextOn: { color: colors.brandPrimary },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.sm },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  sheetBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: "center" },
  cancel: { borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  go: { backgroundColor: colors.brandPrimary },
  goText: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
});
