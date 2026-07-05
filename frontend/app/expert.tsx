import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Expert = { type?: string; specialty?: string; status?: string; credits?: number; badge?: string };
type MyGuide = { id: string; title: string; category: string; status: string; version: number; views: number };
type Me = { expert: Expert; types: string[]; categories: string[]; guides: MyGuide[] };

const STATUS_COLOR: Record<string, string> = { draft: "#828282", pending: "#F2994A", published: "#27AE60", rejected: "#EB5757", obsolete: "#828282" };

export default function ExpertHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => { try { setMe(await api<Me>("/expert/me")); } catch {} finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const status = me?.expert?.status;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="expert-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Expert Program</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : !me ? (
        <View style={styles.center}><Text style={styles.empty}>Couldn&apos;t load the Expert Program. Pull back and try again.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {status === "approved" ? (
            <>
              <View style={styles.hero}>
                <MaterialCommunityIcons name="check-decagram" size={26} color={colors.onBrandPrimary} />
                <Text style={styles.heroBadge}>{me!.expert.badge}</Text>
                <Text style={styles.heroSpec}>{me!.expert.specialty}</Text>
                <Text style={styles.heroCredits}>{me!.expert.credits} contribution credits</Text>
              </View>
              <View style={styles.headRow}>
                <Text style={styles.section}>My guides</Text>
                <View style={{ flex: 1 }} />
                <Pressable testID="guide-add-toggle" style={[styles.btn, styles.btnOk]} onPress={() => setAdding((a) => !a)}><MaterialCommunityIcons name={adding ? "close" : "plus"} size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>{adding ? "Close" : "New guide"}</Text></Pressable>
              </View>
              {adding && <NewGuide categories={me!.categories} onCreated={() => { setAdding(false); load(); }} />}
              {me!.guides.length === 0 && !adding && <Text style={styles.empty}>Author your first guide to share your expertise with the community.</Text>}
              {me!.guides.map((g) => (
                <View key={g.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={[styles.gTitle, { flex: 1 }]}>{g.title}</Text>
                    <View style={[styles.pill, { backgroundColor: (STATUS_COLOR[g.status] || colors.onSurfaceTertiary) + "22" }]}><Text style={[styles.pillText, { color: STATUS_COLOR[g.status] || colors.onSurfaceTertiary }]}>{g.status.toUpperCase()}</Text></View>
                  </View>
                  <Text style={styles.meta}>{g.category} · v{g.version} · {g.views} views</Text>
                  {g.status === "draft" && <Pressable testID={`guide-submit-${g.id}`} style={styles.submitLink} onPress={async () => { try { await api(`/expert/guides/${g.id}/submit`, { method: "POST" }); load(); } catch {} }}><Text style={styles.submitLinkText}>Submit for review →</Text></Pressable>}
                </View>
              ))}
            </>
          ) : status === "pending" ? (
            <View style={styles.pendingCard}>
              <MaterialCommunityIcons name="clock-outline" size={30} color={colors.warning} />
              <Text style={styles.pendingTitle}>Application under review</Text>
              <Text style={styles.pendingSub}>Our team is verifying your {me!.expert.type} credentials. You&apos;ll be notified within 24h. Once approved, you can publish pro guides.</Text>
            </View>
          ) : (
            <ApplyForm types={me!.types} onDone={load} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function ApplyForm({ types, onDone }: { types: string[]; onDone: () => void }) {
  const [type, setType] = useState(types[0] || "Community Mentor");
  const [specialty, setSpecialty] = useState("");
  const [license, setLicense] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    if (!specialty.trim()) { Alert.alert("Missing", "Tell us your specialty."); return; }
    setBusy(true);
    try { await api("/expert/apply", { method: "POST", body: { type, specialty: specialty.trim(), license: license.trim(), bio: bio.trim() } }); onDone(); }
    catch (e: any) { Alert.alert("Couldn't apply", e?.message || "Try again."); } finally { setBusy(false); }
  };
  return (
    <View>
      <Text style={styles.introTitle}>Share your expertise</Text>
      <Text style={styles.introSub}>Verified contractors, inspectors, star DIYers & product experts author pro guides, mentor the community, and earn credits & visibility.</Text>
      <Text style={styles.label}>I&apos;m applying as</Text>
      <View style={styles.chipRow}>{types.map((t) => <Pressable key={t} testID={`expert-type-${t}`} style={[styles.chip, type === t && styles.chipOn]} onPress={() => setType(t)}><Text style={[styles.chipText, type === t && styles.chipTextOn]}>{t}</Text></Pressable>)}</View>
      <TextInput testID="expert-specialty" style={styles.input} value={specialty} onChangeText={setSpecialty} placeholder="Specialty (e.g. Electrical & Lighting)" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput testID="expert-license" style={styles.input} value={license} onChangeText={setLicense} placeholder="License / certification # (optional)" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput testID="expert-bio" style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} value={bio} onChangeText={setBio} placeholder="Short bio & experience" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <Pressable testID="expert-apply" style={styles.applyBtn} onPress={apply} disabled={busy}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.applyText}>Submit application</Text>}</Pressable>
    </View>
  );
}

function NewGuide({ categories, onCreated }: { categories: string[]; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0] || "General");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [steps, setSteps] = useState("");
  const [safety, setSafety] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim()) { Alert.alert("Missing", "Give your guide a title."); return; }
    setBusy(true);
    try {
      await api("/expert/guides", { method: "POST", body: {
        title: title.trim(), category, summary: summary.trim(), body: body.trim(),
        steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
        safety: safety.split("\n").map((s) => s.trim()).filter(Boolean),
      } });
      onCreated();
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };
  return (
    <View style={styles.form}>
      <TextInput testID="guide-new-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="Guide title" placeholderTextColor={colors.onSurfaceTertiary} />
      <View style={styles.chipRow}>{categories.map((c) => <Pressable key={c} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}><Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text></Pressable>)}</View>
      <TextInput style={styles.input} value={summary} onChangeText={setSummary} placeholder="One-line summary" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} value={body} onChangeText={setBody} placeholder="Guide body / overview" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={steps} onChangeText={setSteps} placeholder="Steps (one per line)" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <TextInput style={[styles.input, { minHeight: 56, textAlignVertical: "top" }]} value={safety} onChangeText={setSafety} placeholder="Safety notes (one per line)" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <Pressable testID="guide-new-create" style={[styles.btn, styles.btnOk, { alignSelf: "flex-start" }]} onPress={create} disabled={busy}>{busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="check" size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Save draft</Text></>}</Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  hero: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center", marginBottom: spacing.md, gap: 3 },
  heroBadge: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 20, marginTop: spacing.xs },
  heroSpec: { color: colors.onBrandPrimary, opacity: 0.9, fontFamily: font.medium, fontSize: type.sm },
  heroCredits: { color: colors.onBrandPrimary, opacity: 0.85, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.xs },
  introTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.xs },
  introSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19, marginBottom: spacing.md },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs },
  headRow: { flexDirection: "row", alignItems: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginVertical: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.sm },
  applyBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  applyText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  pendingCard: { alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.xl, gap: spacing.sm },
  pendingTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  pendingSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textAlign: "center", lineHeight: 19 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  gTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  submitLink: { marginTop: 2 },
  submitLinkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginVertical: spacing.lg, lineHeight: 20 },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
