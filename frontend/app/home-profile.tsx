import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Modal, Platform, KeyboardAvoidingView,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const money = (c: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;
const fmtDate = (iso?: string) => { try { return new Date(iso!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; } };

type Room = { id: string; name: string; type: string; notes?: string };
type Sys = { id: string; name: string; type: string; install_year?: number; warranty?: string };
type LogItem = { kind: string; id: string; title: string; detail?: string; room?: string; skill_tag?: string; money_saved_cents?: number; hours?: number; created_at: string };
type Home = {
  rooms: Room[]; systems: Sys[];
  stats: { projects_completed: number; money_saved_cents: number; invested_cents: number; total_hours: number; years_active: number; rooms: number; systems: number };
  years: number[]; log: LogItem[]; room_types: string[]; system_types: string[];
};

export default function HomeProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);
  const [addKind, setAddKind] = useState<"room" | "system" | null>(null);
  const [review, setReview] = useState<any | null>(null);

  // add-form state
  const [name, setName] = useState("");
  const [ftype, setFtype] = useState("");
  const [year, setYear] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try { setD(await api<Home>("/home")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = (kind: "room" | "system") => {
    setAddKind(kind); setName(""); setYear(""); setNotes("");
    setFtype(kind === "room" ? (d?.room_types[0] || "Other") : (d?.system_types[0] || "Other"));
  };

  const submitAdd = async () => {
    if (!name.trim()) return;
    Haptics.selectionAsync();
    try {
      if (addKind === "room") {
        await api("/home/rooms", { method: "POST", body: { name: name.trim(), type: ftype, notes: notes.trim() } });
      } else {
        await api("/home/systems", { method: "POST", body: { name: name.trim(), type: ftype, install_year: year ? parseInt(year) : null, notes: notes.trim() } });
      }
      setAddKind(null); load();
    } catch {}
  };

  const del = async (kind: "rooms" | "systems", id: string) => {
    setD((h) => h ? { ...h, [kind]: (h[kind] as any[]).filter((x) => x.id !== id) } : h);
    try { await api(`/home/${kind}/${id}`, { method: "DELETE" }); } catch { load(); }
  };

  const openReview = async (y: number) => {
    try { setReview(await api(`/home/year-review/${y}`)); } catch {}
  };

  if (loading || !d) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  const types = addKind === "room" ? d.room_types : d.system_types;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="home-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>My Home</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["3xl"], gap: spacing.lg }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <MaterialCommunityIcons name="home-heart" size={26} color={colors.brandPrimary} />
          <Text style={styles.heroTitle}>Your home's living record</Text>
          <Text style={styles.heroSub}>Everything you've done, saved, and learned — building over your whole homeownership journey.</Text>
        </View>

        <View style={styles.statGrid}>
          <Stat icon="check-decagram" label="PROJECTS" value={String(d.stats.projects_completed)} color={colors.brandPrimary} />
          <Stat icon="cash-multiple" label="SAVED" value={money(d.stats.money_saved_cents)} color={colors.success} />
          <Stat icon="wallet-outline" label="INVESTED" value={money(d.stats.invested_cents)} color={colors.info} />
          <Stat icon="calendar-check" label="YEARS" value={String(d.stats.years_active)} color={colors.warning} />
        </View>

        {/* Year in Review */}
        {d.years.length > 0 && (
          <View>
            <Text style={styles.section}>YEAR IN REVIEW</Text>
            <View style={styles.yearRow}>
              {d.years.map((y) => (
                <Pressable key={y} testID={`home-year-${y}`} style={styles.yearChip} onPress={() => openReview(y)}>
                  <Text style={styles.yearText}>{y}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={colors.onBrandTertiary} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Rooms */}
        <View>
          <View style={styles.sectionRow}>
            <Text style={styles.section}>ROOMS</Text>
            <Pressable testID="home-add-room" hitSlop={8} onPress={() => openAdd("room")}><MaterialCommunityIcons name="plus-circle" size={22} color={colors.brandPrimary} /></Pressable>
          </View>
          {d.rooms.length === 0 ? <Text style={styles.emptyLine}>Add rooms to track upgrades and issues per space.</Text> :
            d.rooms.map((r) => (
              <View key={r.id} style={styles.itemCard}>
                <View style={styles.itemIcon}><MaterialCommunityIcons name="floor-plan" size={20} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{r.name}</Text>
                  <Text style={styles.itemMeta}>{r.type}{r.notes ? ` · ${r.notes}` : ""}</Text>
                </View>
                <Pressable testID={`home-del-room-${r.id}`} hitSlop={8} onPress={() => del("rooms", r.id)}><MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceTertiary} /></Pressable>
              </View>
            ))}
        </View>

        {/* Systems */}
        <View>
          <View style={styles.sectionRow}>
            <Text style={styles.section}>SYSTEMS & APPLIANCES</Text>
            <Pressable testID="home-add-system" hitSlop={8} onPress={() => openAdd("system")}><MaterialCommunityIcons name="plus-circle" size={22} color={colors.brandPrimary} /></Pressable>
          </View>
          {d.systems.length === 0 ? <Text style={styles.emptyLine}>Track HVAC, water heater, roof age & warranties.</Text> :
            d.systems.map((s) => (
              <View key={s.id} style={styles.itemCard}>
                <View style={styles.itemIcon}><MaterialCommunityIcons name="water-boiler" size={20} color={colors.info} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{s.name}</Text>
                  <Text style={styles.itemMeta}>{s.type}{s.install_year ? ` · ${s.install_year}` : ""}{s.warranty ? ` · ${s.warranty} warranty` : ""}</Text>
                </View>
                <Pressable testID={`home-del-system-${s.id}`} hitSlop={8} onPress={() => del("systems", s.id)}><MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceTertiary} /></Pressable>
              </View>
            ))}
        </View>

        {/* Lifetime log */}
        <View>
          <Text style={styles.section}>LIFETIME KNOWLEDGE LOG</Text>
          {d.log.length === 0 ? <Text style={styles.emptyLine}>Complete a project and it's recorded here forever.</Text> :
            d.log.map((e) => (
              <View key={e.id} style={styles.logRow}>
                <View style={[styles.logDot, { backgroundColor: e.kind === "project" ? colors.brandPrimary : colors.surfaceSecondary, borderColor: colors.brandPrimary }]}>
                  <MaterialCommunityIcons name={e.kind === "project" ? "hammer" : "note-text-outline"} size={13} color={e.kind === "project" ? colors.onBrandPrimary : colors.brandPrimary} />
                </View>
                <View style={styles.logCard}>
                  <Text style={styles.logDate}>{fmtDate(e.created_at)}{e.room ? ` · ${e.room}` : ""}</Text>
                  <Text style={styles.logTitle}>{e.title}</Text>
                  {!!e.detail && <Text style={styles.logDetail} numberOfLines={2}>{e.detail}</Text>}
                  {!!e.money_saved_cents && <Text style={styles.logSaved}>Saved {money(e.money_saved_cents)}</Text>}
                </View>
              </View>
            ))}
        </View>
      </ScrollView>

      {/* Add modal */}
      <Modal visible={!!addKind} transparent animationType="slide" onRequestClose={() => setAddKind(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>Add {addKind === "room" ? "a room" : "a system"}</Text>
            <TextInput testID="home-add-name" style={styles.input} value={name} onChangeText={setName} placeholder={addKind === "room" ? "Room name (e.g. Master Bath)" : "Name (e.g. Rheem 50gal heater)"} placeholderTextColor={colors.onSurfaceTertiary} />
            <Text style={styles.label}>TYPE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {types.map((t) => (
                <Pressable key={t} style={[styles.chip, ftype === t && styles.chipActive]} onPress={() => setFtype(t)}>
                  <Text style={[styles.chipText, ftype === t && styles.chipTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {addKind === "system" && <TextInput testID="home-add-year" style={[styles.input, { marginTop: spacing.md }]} value={year} onChangeText={setYear} keyboardType="numeric" placeholder="Install year (optional)" placeholderTextColor={colors.onSurfaceTertiary} />}
            <TextInput testID="home-add-notes" style={[styles.input, { marginTop: spacing.md }]} value={notes} onChangeText={setNotes} placeholder="Notes (optional)" placeholderTextColor={colors.onSurfaceTertiary} />
            <View style={styles.sheetBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setAddKind(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="home-add-submit" style={styles.saveBtn} onPress={submitAdd}><Text style={styles.saveText}>ADD</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Year review modal */}
      <Modal visible={!!review} transparent animationType="fade" onRequestClose={() => setReview(null)}>
        <Pressable style={styles.reviewOverlay} onPress={() => setReview(null)}>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewYear}>{review?.year}</Text>
            <Text style={styles.reviewTitle}>Year in Review</Text>
            <View style={styles.reviewStats}>
              <View style={styles.reviewStat}><Text style={styles.reviewNum}>{review?.projects}</Text><Text style={styles.reviewLbl}>PROJECTS</Text></View>
              <View style={styles.reviewStat}><Text style={[styles.reviewNum, { color: colors.success }]}>{money(review?.money_saved_cents || 0)}</Text><Text style={styles.reviewLbl}>SAVED</Text></View>
              <View style={styles.reviewStat}><Text style={styles.reviewNum}>{review?.hours}</Text><Text style={styles.reviewLbl}>HOURS</Text></View>
            </View>
            {review?.top_skills?.length > 0 && <Text style={styles.reviewSkills}>Top skills: {review.top_skills.join(", ")}</Text>}
            <Pressable style={styles.reviewClose} onPress={() => setReview(null)}><Text style={styles.saveText}>NICE!</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Stat({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={styles.statCard}>
      <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      <Text style={[styles.statNum, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  hero: { backgroundColor: colors.brandTertiary + "44", borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  heroTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  heroSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { width: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  statNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  emptyLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, fontStyle: "italic" },
  yearRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  yearChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  yearText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.base },
  itemCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  itemIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  itemName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  itemMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  logRow: { flexDirection: "row", gap: spacing.md },
  logDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 2 },
  logCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 2 },
  logDate: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  logTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  logDetail: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18 },
  logSaved: { color: colors.success, fontFamily: font.bold, fontSize: type.sm, marginTop: 2 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing["3xl"] },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.md },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  chipTextActive: { color: colors.onBrandPrimary },
  sheetBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  saveBtn: { flex: 2, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  reviewOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  reviewCard: { backgroundColor: colors.surface, borderRadius: 24, padding: spacing.xl, width: "100%", alignItems: "center", gap: spacing.sm },
  reviewYear: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 48, lineHeight: 52 },
  reviewTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  reviewStats: { flexDirection: "row", gap: spacing.lg, marginVertical: spacing.md },
  reviewStat: { alignItems: "center" },
  reviewNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  reviewLbl: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  reviewSkills: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, textAlign: "center" },
  reviewClose: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing["2xl"], paddingVertical: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
});
