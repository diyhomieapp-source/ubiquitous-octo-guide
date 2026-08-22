import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Counts = { rooms: number; assets: number; documents: number; projects_total: number; projects_completed: number; measurements: number; tools: number };
type Ev = { type: string; title: string; at: string; route?: string | null; icon?: string };

const TILES: { key: keyof Counts; id: string; label: string; icon: any; route: string }[] = [
  { key: "rooms", id: "rooms", label: "Rooms", icon: "floor-plan", route: "/home-intel/rooms" },
  { key: "assets", id: "assets", label: "Assets", icon: "cube-outline", route: "/home-intel/assets" },
  { key: "documents", id: "documents", label: "Documents", icon: "file-document-outline", route: "/home-intel/documents" },
  { key: "projects_total", id: "projects", label: "Projects", icon: "hammer-wrench", route: "/home-intel/projects" },
  { key: "measurements", id: "measurements", label: "Measurements", icon: "ruler", route: "/home-intel/measure" },
  { key: "tools", id: "tools", label: "Toolbox", icon: "toolbox-outline", route: "/home-intel/inventory" },
];

export default function HomePassport() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [groups, setGroups] = useState<{ month: string; events: Ev[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", year_built: "", square_footage: "", stories: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api("/hi/passport");
      setData(d);
      const t = await api<{ groups: { month: string; events: Ev[] }[] }>("/hi/passport/timeline?limit=40");
      setGroups(t.groups);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openEdit = () => {
    const p = data?.property || {};
    setForm({ name: p.name || "", address: p.address || "", year_built: p.year_built ? String(p.year_built) : "",
      square_footage: p.square_footage ? String(p.square_footage) : "", stories: p.stories ? String(p.stories) : "" });
    setEditing(true);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const body: any = { name: form.name.trim() || undefined, address: form.address.trim() || undefined };
      if (form.year_built.trim()) body.year_built = parseInt(form.year_built, 10);
      if (form.square_footage.trim()) body.square_footage = parseInt(form.square_footage, 10);
      if (form.stories.trim()) body.stories = parseInt(form.stories, 10);
      await api("/hi/passport/profile", { method: "PUT", body });
      setEditing(false);
      load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || "Try again."); }
    finally { setSaving(false); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Home Passport" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  const p = data.property || {};
  const c: Counts = data.counts;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Home Passport" right={
        <Pressable testID="passport-edit" onPress={openEdit} accessibilityRole="button">
          <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.brandPrimary} />
        </Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <View style={styles.profileCard}>
          <MaterialCommunityIcons name="home-variant-outline" size={28} color={colors.brandPrimary} />
          <Text style={styles.homeName}>{p.name || "My Home"}</Text>
          {!!p.address && <Text style={styles.homeMeta}>{p.address}</Text>}
          <Text style={styles.homeMeta}>
            {[p.property_type || p.home_type, p.year_built ? `Built ${p.year_built}` : null,
              p.square_footage ? `${p.square_footage} sq ft` : null,
              p.stories ? `${p.stories} ${p.stories === 1 ? "story" : "stories"}` : null]
              .filter(Boolean).join(" · ") || "Add details so Homie knows your home better"}          </Text>
        </View>

        <View style={styles.grid}>
          {TILES.map((t) => (
            <Pressable key={t.key} testID={`passport-tile-${t.id}`} style={styles.tile} onPress={() => router.push(t.route as any)}>
              <MaterialCommunityIcons name={t.icon} size={22} color={colors.brandPrimary} />
              <Text style={styles.tileCount}>{c[t.key]}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.completedNote}>{c.projects_completed} project{c.projects_completed === 1 ? "" : "s"} completed and saved to this home&apos;s record.</Text>

        {data.active_projects?.length > 0 && (
          <>
            <Text style={styles.section}>Active projects</Text>
            {data.active_projects.map((ap: any) => (
              <Pressable key={ap.id} testID={`passport-project-${ap.id}`} style={styles.row} onPress={() => router.push(`/home-intel/projects/${ap.id}`)}>
                <MaterialCommunityIcons name="hammer-wrench" size={18} color={colors.info} />
                <Text style={styles.rowText}>{ap.title}</Text>
                <Text style={styles.rowStatus}>{ap.status}</Text>
              </Pressable>
            ))}
          </>
        )}

        <Text style={styles.section}>Home timeline</Text>
        {groups.length === 0 && <Text style={styles.empty}>As you capture rooms, add assets and complete projects, your home&apos;s history builds here.</Text>}
        {groups.map((g) => (
          <View key={g.month}>
            <Text style={styles.month}>{g.month}</Text>
            {g.events.map((e, i) => (
              <Pressable key={`${g.month}-${i}`} style={styles.row} disabled={!e.route}
                onPress={() => e.route && router.push(e.route as any)}>
                <MaterialCommunityIcons name={(e.icon as any) || "circle-small"} size={18} color={colors.brandPrimary} />
                <Text style={styles.rowText}>{e.title}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Home details</Text>
            <TextInput testID="passport-name" style={styles.input} placeholder="Home name" placeholderTextColor={colors.onSurfaceTertiary}
              value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
            <TextInput testID="passport-address" style={styles.input} placeholder="Address (city is enough)" placeholderTextColor={colors.onSurfaceTertiary}
              value={form.address} onChangeText={(v) => setForm((f) => ({ ...f, address: v }))} />
            <View style={styles.inputRow}>
              <TextInput testID="passport-year" style={[styles.input, { flex: 1 }]} placeholder="Year built" placeholderTextColor={colors.onSurfaceTertiary}
                keyboardType="number-pad" value={form.year_built} onChangeText={(v) => setForm((f) => ({ ...f, year_built: v }))} />
              <TextInput testID="passport-sqft" style={[styles.input, { flex: 1 }]} placeholder="Sq ft" placeholderTextColor={colors.onSurfaceTertiary}
                keyboardType="number-pad" value={form.square_footage} onChangeText={(v) => setForm((f) => ({ ...f, square_footage: v }))} />
              <TextInput testID="passport-stories" style={[styles.input, { flex: 1 }]} placeholder="Stories" placeholderTextColor={colors.onSurfaceTertiary}
                keyboardType="number-pad" value={form.stories} onChangeText={(v) => setForm((f) => ({ ...f, stories: v }))} />
            </View>
            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setEditing(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="passport-save" style={styles.saveBtn} disabled={saving} onPress={saveProfile}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  profileCard: { alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  homeName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  homeMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  tile: { width: "31%", flexGrow: 1, alignItems: "center", gap: 2, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  tileCount: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  tileLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  completedNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  month: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs },
  rowText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, flex: 1 },
  rowStatus: { color: colors.info, fontFamily: font.medium, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  modalWrap: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing["2xl"], gap: spacing.sm },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  inputRow: { flexDirection: "row", gap: spacing.sm },
  modalBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base },
  saveBtn: { flex: 1, alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
});
