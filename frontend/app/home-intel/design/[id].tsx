import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Image } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState, SafetyCard } from "@/src/components/ui";

const VERDICT_META: Record<string, { label: string; color: string }> = {
  looks_buildable: { label: "Looks buildable", color: colors.success },
  needs_review: { label: "Needs review", color: colors.warning },
  professional_recommended: { label: "Professional recommended", color: colors.error },
};

export default function DesignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [refineText, setRefineText] = useState("");
  const [versionIdx, setVersionIdx] = useState(0);

  const load = useCallback(async () => {
    try { setData(await api<any>(`/hi/design-studio/projects/${id}`)); setVersionIdx(0); }
    catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (key: string, path: string, body?: any, timeoutMsg?: string) => {
    setBusy(key);
    try { const r = await api<any>(`/hi/design-studio/projects/${id}/${path}`, { method: "POST", body: body || {} }); await load(); return r; }
    catch (e: any) { Alert.alert(timeoutMsg || "Couldn't do that", e?.message || ""); }
    finally { setBusy(""); }
  };

  const [job, setJob] = useState<{ progress: number; message: string } | null>(null);

  const runGenJob = async (key: string, path: string, body?: any) => {
    setBusy(key);
    try {
      const r = await api<any>(`/hi/design-studio/projects/${id}/${path}`, { method: "POST", body: body || {} });
      if (r?.job_id) {
        setJob({ progress: 5, message: r.message || "Working on it…" });
        const started = Date.now();
        while (Date.now() - started < 180000) {
          await new Promise((res) => setTimeout(res, 2500));
          const j = await api<any>(`/hi/jobs/${r.job_id}`);
          setJob({ progress: j.progress || 0, message: j.message || "" });
          if (j.status === "completed") { await load(); break; }
          if (j.status === "failed" || j.status === "canceled") { Alert.alert("Couldn't finish", j.message || ""); break; }
        }
      } else { await load(); }
    } catch (e: any) { Alert.alert("Couldn't do that", e?.message || ""); }
    finally { setBusy(""); setJob(null); }
  };

  const refine = async () => {
    if (!refineText.trim()) return;
    const t = refineText.trim(); setRefineText("");
    await runGenJob("refine", "refine", { instruction: t });
  };

  const convert = async () => {
    const r = await act("convert", "convert");
    if (r?.route) router.push(r.route as any);
  };

  const proj = data?.project;
  const versions = data?.versions || [];
  const ver = versions[versionIdx];
  const bd = proj?.buildability;
  const vm = bd ? VERDICT_META[bd.verdict] : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="dsd-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{proj?.title || "Design"}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : !proj ? null : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          <Text style={styles.meta}>{proj.design_type.replace(/_/g, " ")} · {proj.objective}</Text>
          {proj.style_summary ? <Text style={styles.styleSummary}>{proj.style_summary}</Text> : null}

          {job && (
            <View testID="dsd-job-progress" style={styles.jobCard}>
              <ActivityIndicator size="small" color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.jobMsg}>{job.message}</Text>
                <View style={styles.jobTrack}><View style={[styles.jobFill, { width: `${Math.max(5, job.progress)}%` }]} /></View>
              </View>
            </View>
          )}

          {!versions.length ? (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Ready to see it?</Text>
              <Text style={styles.actionBody}>{"Homie will create a realistic concept image and a written design direction. It's inspiration — not a construction plan."}</Text>
              <Pressable testID="dsd-generate" onPress={() => runGenJob("concept", "concept")} style={styles.primaryBtn} disabled={busy === "concept"}>
                {busy === "concept" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Generate concept</Text>}
              </Pressable>
            </View>
          ) : (
            <>
              {/* Version strip */}
              {versions.length > 1 ? (
                <View style={styles.verRow}>
                  {versions.map((v: any, i: number) => (
                    <Pressable key={v.id} testID={`dsd-ver-${v.version}`} onPress={() => setVersionIdx(i)} style={[styles.verChip, i === versionIdx && styles.verOn]}>
                      <Text style={[styles.verText, i === versionIdx && { color: colors.onBrandTertiary }]}>v{v.version}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {ver?.image_base64 ? (
                <Image testID="dsd-image" source={{ uri: `data:image/png;base64,${ver.image_base64}` }} style={styles.concept} resizeMode="cover" />
              ) : (
                <View style={[styles.concept, styles.noImage]}><MaterialCommunityIcons name="image-off-outline" size={28} color={colors.onSurfaceTertiary} /><Text style={styles.metaSmall}>Image unavailable — direction below still applies</Text></View>
              )}
              <Text style={styles.disclaimer}>{ver?.disclaimer}</Text>

              {ver?.direction ? (
                <View style={styles.dirCard}>
                  <Text style={styles.dirTitle}>{ver.direction.style_name}</Text>
                  {ver.direction.palette?.length ? <Text style={styles.dirRow}>🎨 {ver.direction.palette.join(" · ")}</Text> : null}
                  {(ver.direction.key_changes || []).map((c: string, i: number) => <Text key={i} style={styles.dirRow}>• {c}</Text>)}
                  {ver.direction.materials?.length ? <Text style={styles.dirRow}>🧱 {ver.direction.materials.join(", ")}</Text> : null}
                  {ver.direction.lighting ? <Text style={styles.dirRow}>💡 {ver.direction.lighting}</Text> : null}
                  {ver.changes && ver.changes !== "Initial concept" ? <Text style={styles.metaSmall}>Change: {ver.changes}</Text> : null}
                </View>
              ) : null}

              {/* Refine */}
              <View style={styles.refineRow}>
                <TextInput testID="dsd-refine-input" value={refineText} onChangeText={setRefineText} placeholder='Refine it — e.g. "warmer wall color"' placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                <Pressable testID="dsd-refine" onPress={refine} style={styles.sendBtn}>
                  {busy === "refine" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="auto-fix" size={18} color={colors.onBrandPrimary} />}
                </Pressable>
              </View>

              {/* Buildability */}
              {!bd ? (
                <Pressable testID="dsd-buildability" onPress={() => act("buildability", "buildability")} style={styles.secondaryBtn}>
                  {busy === "buildability" ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <><MaterialCommunityIcons name="clipboard-search-outline" size={16} color={colors.brandPrimary} /><Text style={styles.secondaryText}>Can I actually build this? (buildability review)</Text></>}
                </Pressable>
              ) : (
                <View testID="dsd-bd" style={[styles.dirCard, { borderColor: vm?.color }]}>
                  <Text style={[styles.dirTitle, { color: vm?.color }]}>{vm?.label}</Text>
                  {bd.safety?.length ? <SafetyCard level="verify" title="Safety" message={bd.safety.join(" ")} /> : null}
                  {[["buildability", "Buildability"], ["budget", "Budget"], ["permit", "Permit / pro"], ["taste", "Your call (taste)"]].map(([k, label]) => (
                    (bd as any)[k as string]?.length ? (
                      <View key={k as string}>
                        <Text style={styles.bdLabel}>{label as string}</Text>
                        {(bd as any)[k as string].map((x: string, i: number) => <Text key={i} style={styles.dirRow}>• {x}</Text>)}
                      </View>
                    ) : null
                  ))}
                  {bd.measure_first?.length ? (
                    <View>
                      <Text style={styles.bdLabel}>Measure before buying</Text>
                      {bd.measure_first.map((m: string, i: number) => <Text key={i} style={styles.dirRow}>📏 {m}</Text>)}
                    </View>
                  ) : null}
                </View>
              )}

              {/* Approve + convert */}
              {proj.linked_issue_id ? (
                <Pressable testID="dsd-open-project" onPress={() => router.push(`/home-intel/repair/${proj.linked_issue_id}` as any)} style={styles.primaryBtn}>
                  <Text style={styles.primaryText}>Open the build project →</Text>
                </Pressable>
              ) : (
                <View style={styles.rowBtns}>
                  {proj.status !== "approved" ? (
                    <Pressable testID="dsd-approve" onPress={() => act("approve", "approve")} style={styles.secondaryBtn}>
                      {busy === "approve" ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.secondaryText}>Approve this design</Text>}
                    </Pressable>
                  ) : null}
                  <Pressable testID="dsd-convert" onPress={convert} style={styles.primaryBtn}>
                    {busy === "convert" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Turn it into a real project</Text>}
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  jobCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md },
  jobMsg: { fontFamily: font.medium, fontSize: type.base, color: colors.onBrandTertiary },
  jobTrack: { height: 5, backgroundColor: colors.surfaceTertiary, borderRadius: 3, marginTop: spacing.sm, overflow: "hidden" },
  jobFill: { height: 5, backgroundColor: colors.brandPrimary, borderRadius: 3 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  headerTitle: { flex: 1, fontFamily: font.display, fontSize: type.xl, color: colors.onSurface, letterSpacing: 1, textAlign: "center" },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  meta: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceTertiary, textTransform: "capitalize" },
  styleSummary: { fontFamily: font.regular, fontSize: type.sm, color: colors.info, fontStyle: "italic" },
  actionCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  actionTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  actionBody: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  primaryBtn: { flex: 1, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: font.bold, fontSize: type.base, color: colors.onBrandPrimary },
  secondaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  secondaryText: { fontFamily: font.bold, fontSize: type.sm, color: colors.brandPrimary },
  verRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  verChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  verOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  verText: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
  concept: { width: "100%", height: 260, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  noImage: { alignItems: "center", justifyContent: "center", gap: spacing.sm },
  disclaimer: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  dirCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  dirTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  dirRow: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
  bdLabel: { fontFamily: font.bold, fontSize: 11, color: colors.brandPrimary, letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.xs },
  metaSmall: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  refineRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: font.regular, fontSize: type.base },
  sendBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  rowBtns: { flexDirection: "row", gap: spacing.sm },
});
