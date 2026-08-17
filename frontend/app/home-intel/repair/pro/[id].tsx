import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Share, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Constants from "expo-constants";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, SafetyCard } from "@/src/components/ui";

const STATE_META: Record<string, { label: string; color: string; icon: string }> = {
  diy_appropriate: { label: "DIY is appropriate", color: colors.success, icon: "hammer-wrench" },
  diy_with_caution: { label: "DIY with caution", color: colors.warning, icon: "alert-outline" },
  professional_recommended: { label: "A professional is recommended", color: "#FF6A00", icon: "account-hard-hat" },
  professional_required: { label: "A professional is required", color: colors.error, icon: "alert-decagram" },
};

export default function ProHandoffScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [esc, setEsc] = useState<any>(null);
  const [brief, setBrief] = useState<any>(null);
  const [share, setShare] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [showFindingForm, setShowFindingForm] = useState(false);
  const [finding, setFinding] = useState({ professional_type: "", summary: "", recommendations: "", followup_needed: false });
  const [scopeText, setScopeText] = useState("");
  const [scopeResult, setScopeResult] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const e = await api<any>(`/hi/handoff-pro/issues/${id}/escalation`);
      setEsc(e);
      if (e.has_brief) {
        const b = await api<any>(`/hi/handoff-pro/issues/${id}/brief`);
        setBrief(b.brief); setShare(b.share);
      }
      const f = await api<any>(`/hi/handoff-pro/issues/${id}/findings`);
      setFindings(f.findings || []);
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createBrief = async () => {
    setBusy("brief");
    try { const r = await api<any>(`/hi/handoff-pro/issues/${id}/brief`, { method: "POST", body: {} }); setBrief(r.brief); setShare(null); }
    catch (e: any) { Alert.alert("Couldn't create the brief", e?.message || ""); }
    finally { setBusy(""); }
  };

  const shareBrief = async () => {
    setBusy("share");
    try {
      const r = await api<any>(`/hi/handoff-pro/briefs/${brief.id}/share`, { method: "POST" });
      setShare(r.share);
      const base = (Constants.expoConfig?.extra as any)?.EXPO_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const url = `${base}/api/hi/handoff-pro/shared/${r.share.token}`;
      if (Platform.OS === "web") { try { await (navigator as any).clipboard?.writeText(url); Alert.alert("Link copied"); } catch { Alert.alert("Share link", url); } }
      else { await Share.share({ message: `DIYhomie handoff brief: ${url}` }); }
    } catch (e: any) { Alert.alert("Couldn't share", e?.message || ""); }
    finally { setBusy(""); }
  };

  const revoke = async () => {
    setBusy("revoke");
    try { await api(`/hi/handoff-pro/briefs/${brief.id}/share`, { method: "DELETE" }); setShare(null); }
    catch {} finally { setBusy(""); }
  };

  const submitFinding = async () => {
    if (!finding.summary.trim()) { Alert.alert("Add a short summary of what the pro found."); return; }
    setBusy("finding");
    try {
      await api(`/hi/handoff-pro/issues/${id}/findings`, { method: "POST", body: finding });
      setFinding({ professional_type: "", summary: "", recommendations: "", followup_needed: false });
      setShowFindingForm(false);
      await load();
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || ""); }
    finally { setBusy(""); }
  };

  const compareScope = async () => {
    if (!scopeText.trim()) return;
    setBusy("scope");
    try { setScopeResult(await api<any>(`/hi/handoff-pro/issues/${id}/scope-compare`, { method: "POST", body: { pro_scope_text: scopeText.trim() } })); }
    catch (e: any) { Alert.alert("Couldn't compare", e?.message || ""); }
    finally { setBusy(""); }
  };

  const cont = (action: string, label: string) => Alert.alert(label, "Record this and update the project?", [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", onPress: async () => {
      setBusy(action);
      try { await api(`/hi/handoff-pro/issues/${id}/continue`, { method: "POST", body: { action } }); await load(); Alert.alert("Recorded", "Your property record was updated."); }
      catch (e: any) { Alert.alert("Couldn't record", e?.message || ""); }
      finally { setBusy(""); }
    } },
  ]);

  const st = esc ? STATE_META[esc.escalation?.state] || STATE_META.diy_with_caution : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="ph-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Pro Handoff</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <LoadingState /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
          {/* Escalation state */}
          {st ? (
            <View testID="ph-escalation" style={[styles.stateCard, { borderColor: st.color }]}>
              <View style={styles.stateHead}>
                <MaterialCommunityIcons name={st.icon as any} size={22} color={st.color} />
                <Text style={[styles.stateTitle, { color: st.color }]}>{st.label}</Text>
              </View>
              {(esc.escalation.reasons || []).map((r: string, i: number) => <Text key={i} style={styles.stateReason}>• {r}</Text>)}
              <View style={styles.tradeRow}>
                {(esc.escalation.trade_categories || []).map((t: string) => (
                  <View key={t} style={styles.tradeChip}><MaterialCommunityIcons name="account-hard-hat" size={13} color={colors.brandPrimary} /><Text style={styles.tradeText}>{t}</Text></View>
                ))}
              </View>
              <Text style={styles.noteText}>{esc.escalation.note}</Text>
            </View>
          ) : null}

          {/* Brief */}
          {!brief ? (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Hand it off in seconds</Text>
              <Text style={styles.actionBody}>{"I'll turn everything you've documented — evidence, what you tried, safety flags — into a clear brief you can show any professional."}</Text>
              <Button testID="ph-create-brief" label="Create handoff brief" icon="file-document-outline" loading={busy === "brief"} onPress={createBrief} />
            </View>
          ) : (
            <View style={styles.section}>
              <View style={styles.briefHead}>
                <Text style={styles.sectionTitle}>Handoff brief · v{brief.version}</Text>
                <Pressable testID="ph-rebuild" onPress={createBrief} style={styles.linkBtn}>
                  {busy === "brief" ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.linkText}>Rebuild</Text>}
                </Pressable>
              </View>
              <View testID="ph-brief" style={styles.briefCard}>
                <Text style={styles.briefLabel}>FOR THE PROFESSIONAL</Text>
                <Text style={styles.briefText}>{brief.summary_for_professional}</Text>
                {brief.current_status ? <Text style={styles.briefMeta}>{brief.current_status}</Text> : null}
                {brief.sections?.what_was_tried?.items?.length ? (
                  <>
                    <Text style={styles.briefLabel}>WHAT WAS ALREADY TRIED <Text style={styles.prov}>({brief.sections.what_was_tried.provenance})</Text></Text>
                    {brief.sections.what_was_tried.items.map((t: string, i: number) => <Text key={i} style={styles.briefItem}>• {t}</Text>)}
                  </>
                ) : null}
                {brief.sections?.evidence?.items?.length ? (
                  <>
                    <Text style={styles.briefLabel}>EVIDENCE ({brief.sections.evidence.items.length})</Text>
                    {brief.sections.evidence.items.slice(0, 8).map((e: any) => (
                      <Text key={e.id} style={styles.briefItem}>• [{e.type}] {e.note || (e.has_media ? "photo attached" : "")}{e.value != null ? ` — ${e.value}${e.unit || ""}` : ""}</Text>
                    ))}
                  </>
                ) : null}
                <Text style={styles.briefLabel}>QUESTIONS TO ASK</Text>
                {(brief.questions_to_ask || []).map((q: string, i: number) => <Text key={i} style={styles.briefItem}>{i + 1}. {q}</Text>)}
                <Text style={styles.briefLabel}>BEFORE THE VISIT</Text>
                {(brief.visit_prep || []).map((p: string, i: number) => <Text key={i} style={styles.briefItem}>✓ {p}</Text>)}
              </View>
              <View style={styles.rowBtns}>
                <Button testID="ph-share" label={share ? "Copy share link" : "Share with a pro"} icon="share-variant" variant="secondary" loading={busy === "share"} onPress={shareBrief} />
                {share ? (
                  <Pressable testID="ph-revoke" onPress={revoke} style={styles.revokeBtn}>
                    {busy === "revoke" ? <ActivityIndicator size="small" color={colors.error} /> : <Text style={styles.revokeText}>Revoke link</Text>}
                  </Pressable>
                ) : null}
              </View>
              {share ? <Text style={styles.noteText}>Anyone with the link can view this brief until you revoke it (auto-expires in 30 days).</Text> : null}
            </View>
          )}

          {/* Scope comparison */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Got a quote or proposed scope?</Text>
            <TextInput testID="ph-scope-input" value={scopeText} onChangeText={setScopeText} multiline placeholder="Paste what the professional proposed…" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.qInput, { minHeight: 80, textAlignVertical: "top" }]} />
            <Button testID="ph-scope-compare" label="Help me understand it" icon="compare-horizontal" variant="secondary" loading={busy === "scope"} onPress={compareScope} />
            {scopeResult ? (
              <View testID="ph-scope-result" style={styles.briefCard}>
                <Text style={styles.briefLabel}>{scopeResult.alignment?.replace(/_/g, " ").toUpperCase()}</Text>
                <Text style={styles.briefText}>{scopeResult.notes}</Text>
                {(scopeResult.differences || []).map((d: string, i: number) => <Text key={i} style={styles.briefItem}>≠ {d}</Text>)}
                {(scopeResult.questions || []).length ? <Text style={styles.briefLabel}>WORTH ASKING</Text> : null}
                {(scopeResult.questions || []).map((q: string, i: number) => <Text key={i} style={styles.briefItem}>{i + 1}. {q}</Text>)}
              </View>
            ) : null}
          </View>

          {/* Findings */}
          <View style={styles.section}>
            <View style={styles.briefHead}>
              <Text style={styles.sectionTitle}>{`Professional findings (${findings.length})`}</Text>
              <Pressable testID="ph-add-finding" onPress={() => setShowFindingForm(!showFindingForm)} style={styles.linkBtn}><Text style={styles.linkText}>{showFindingForm ? "Cancel" : "+ Add"}</Text></Pressable>
            </View>
            {showFindingForm ? (
              <View style={styles.briefCard}>
                <TextInput testID="ph-f-type" value={finding.professional_type} onChangeText={(v) => setFinding((s) => ({ ...s, professional_type: v }))} placeholder="Who visited? (e.g. Licensed plumber)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.qInput} />
                <TextInput testID="ph-f-summary" value={finding.summary} onChangeText={(v) => setFinding((s) => ({ ...s, summary: v }))} multiline placeholder="What did they find? *" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.qInput, { minHeight: 60, textAlignVertical: "top" }]} />
                <TextInput testID="ph-f-rec" value={finding.recommendations} onChangeText={(v) => setFinding((s) => ({ ...s, recommendations: v }))} multiline placeholder="What did they recommend?" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.qInput, { minHeight: 60, textAlignVertical: "top" }]} />
                <Pressable testID="ph-f-followup" onPress={() => setFinding((s) => ({ ...s, followup_needed: !s.followup_needed }))} style={styles.checkRow}>
                  <MaterialCommunityIcons name={finding.followup_needed ? "checkbox-marked" : "checkbox-blank-outline"} size={20} color={colors.brandPrimary} />
                  <Text style={styles.checkText}>{"Create a follow-up so I don't lose track"}</Text>
                </Pressable>
                <Button testID="ph-f-save" label="Save finding" icon="content-save-outline" loading={busy === "finding"} onPress={submitFinding} />
              </View>
            ) : null}
            {findings.map((f: any) => (
              <View key={f.id} style={styles.findingCard}>
                <Text style={styles.findingType}>{f.professional_type || "Professional"} · {new Date(f.created_at).toLocaleDateString()}</Text>
                <Text style={styles.briefText}>{f.summary}</Text>
                {f.recommendations ? <Text style={styles.briefItem}>Recommends: {f.recommendations}</Text> : null}
                {f.followup_needed ? <Text style={styles.followupTag}>follow-up created</Text> : null}
              </View>
            ))}
          </View>

          {/* Continuation */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>After the visit</Text>
            <SafetyCard level="verify" title="Your project keeps its full history" message="Whichever way you continue, everything stays in your property record." />
            <View style={styles.contRow}>
              <Pressable testID="ph-cont-done" onPress={() => cont("professionally_completed", "Mark professionally completed")} style={[styles.contBtn, { borderColor: colors.success }]}>
                {busy === "professionally_completed" ? <ActivityIndicator size="small" color={colors.success} /> : <><MaterialCommunityIcons name="check-decagram" size={18} color={colors.success} /><Text style={[styles.contText, { color: colors.success }]}>Pro completed it</Text></>}
              </Pressable>
              <Pressable testID="ph-cont-diy" onPress={() => cont("reopen_diy", "Resume DIY work")} style={[styles.contBtn, { borderColor: colors.brandPrimary }]}>
                {busy === "reopen_diy" ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <><MaterialCommunityIcons name="hammer-wrench" size={18} color={colors.brandPrimary} /><Text style={[styles.contText, { color: colors.brandPrimary }]}>{"I'll continue DIY"}</Text></>}
              </Pressable>
              <Pressable testID="ph-cont-monitor" onPress={() => cont("monitoring", "Monitor the result")} style={[styles.contBtn, { borderColor: colors.warning }]}>
                {busy === "monitoring" ? <ActivityIndicator size="small" color={colors.warning} /> : <><MaterialCommunityIcons name="eye-outline" size={18} color={colors.warning} /><Text style={[styles.contText, { color: colors.warning }]}>Monitor result</Text></>}
              </Pressable>
            </View>
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
  stateCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1.5 },
  stateHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stateTitle: { fontFamily: font.bold, fontSize: type.lg },
  stateReason: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary },
  tradeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  tradeChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  tradeText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  noteText: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  actionCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  actionTitle: { fontFamily: font.bold, fontSize: type.lg, color: colors.onSurface },
  actionBody: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: font.bold, fontSize: type.base, color: colors.onSurface, marginTop: spacing.sm },
  briefHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  briefCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  briefLabel: { fontFamily: font.bold, fontSize: 11, color: colors.brandPrimary, letterSpacing: 1, marginTop: spacing.xs },
  prov: { fontFamily: font.regular, color: colors.onSurfaceTertiary, letterSpacing: 0 },
  briefText: { fontFamily: font.regular, fontSize: type.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  briefMeta: { fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceTertiary },
  briefItem: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary, lineHeight: 18 },
  rowBtns: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  linkBtn: { paddingVertical: 4 },
  linkText: { fontFamily: font.medium, fontSize: type.sm, color: colors.brandPrimary },
  revokeBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  revokeText: { fontFamily: font.medium, fontSize: type.sm, color: colors.error },
  qInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: font.regular, fontSize: type.base },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkText: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceSecondary },
  findingCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.border },
  findingType: { fontFamily: font.bold, fontSize: type.sm, color: colors.onSurface },
  followupTag: { fontFamily: font.medium, fontSize: 11, color: colors.warning },
  contRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  contBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, flexGrow: 1, justifyContent: "center" },
  contText: { fontFamily: font.medium, fontSize: type.sm },
});
