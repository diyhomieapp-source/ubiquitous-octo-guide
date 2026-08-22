import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { ReportProblemModal } from "@/src/components/ReportProblemModal";
import { storage } from "@/src/utils/storage";
import { enqueue, flush } from "@/src/utils/offlineQueue";

const BRIEF_STYLES = ["quick", "standard", "detailed"] as const;
const TIME_CHIPS = [5, 25, 60];

const SAFETY_COLOR: Record<string, string> = { "Safe to continue": colors.success, "Verify first": colors.warning, "Stop and contact a professional": colors.error };
const STEP_ICON: Record<string, any> = { completed: "check-circle", skipped: "skip-next-circle-outline", active: "circle-slice-8", not_started: "circle-outline" };

export default function ProjectWorkspace() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [q, setQ] = useState(""); const [answer, setAnswer] = useState<string | null>(null); const [asking, setAsking] = useState(false);
  const [briefing, setBriefing] = useState<any>(null);
  const [briefStyle, setBriefStyle] = useState<string>("standard");
  const [offline, setOffline] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [whatsNext, setWhatsNext] = useState<any>(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [now, setNow] = useState<any>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReasons, setOverrideReasons] = useState<{ code: string; label: string }[]>([]);

  const loadBriefing = useCallback(async (style: string) => {
    try {
      const b = await api<any>(`/hi/workspace/projects/${id}/briefing?style=${style}`);
      setBriefing(b);
      storage.setItem(`ws_brief_${id}`, JSON.stringify(b)).catch(() => {});
    } catch {}
  }, [id]);

  const load = useCallback(async () => {
    try {
      await flush().catch(() => {});
      const d = await api<any>(`/hi/projects/${id}`);
      setData(d);
      setOffline(false);
      storage.setItem(`ws_proj_${id}`, JSON.stringify(d)).catch(() => {});
      loadBriefing(briefStyle);
      api<any>(`/hi/workspace/projects/${id}/now`).then((n) => {
        setNow(n);
        storage.setItem(`ws_now_${id}`, JSON.stringify(n)).catch(() => {});
      }).catch(() => {});
    } catch {
      // offline / low connectivity — fall back to the cached bundle (Doc 49 §13)
      const cached = await storage.getItem<string>(`ws_proj_${id}`, "");
      const cachedBrief = await storage.getItem<string>(`ws_brief_${id}`, "");
      if (cached) {
        try { setData(JSON.parse(cached)); setOffline(true); } catch {}
      }
      if (cachedBrief) { try { setBriefing(JSON.parse(cachedBrief)); } catch {} }
      const cachedNow = await storage.getItem<string>(`ws_now_${id}`, "");
      if (cachedNow) { try { setNow(JSON.parse(cachedNow)); } catch {} }
    } finally { setLoading(false); }
  }, [id, briefStyle, loadBriefing]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const fetchWhatsNext = async (minutes: number) => {
    setNextBusy(true);
    try { setWhatsNext(await api<any>(`/hi/workspace/projects/${id}/whats-next?minutes_available=${minutes}`)); }
    catch {} finally { setNextBusy(false); }
  };

  const stepAction = async (stepId: string, status: string) => {
    setBusy(true);
    try {
      if (offline) {
        // queue for conflict-safe sync when connection returns (Doc 49 §13)
        if (status === "completed") await enqueue({ entity_type: "project_step", entity_id: stepId, operation_type: "step_complete_event", payload: { step_id: stepId } });
        setData((d: any) => {
          if (!d) return d;
          const phases = d.phases.map((ph: any) => ({ ...ph, steps: ph.steps.map((s: any) => (s.id === stepId ? { ...s, status } : s)) }));
          const steps = phases.flatMap((ph: any) => ph.steps);
          const doneN = steps.filter((s: any) => ["completed", "skipped"].includes(s.status)).length;
          const nextCur = steps.find((s: any) => s.status === "active") || steps.find((s: any) => s.status === "not_started");
          return { ...d, phases, current_step: nextCur, steps_done: doneN, progress_pct: steps.length ? Math.round((doneN / steps.length) * 100) : 0 };
        });
        Alert.alert("Saved offline", "This will sync automatically when you're back online.");
      } else {
        setData(await api(`/hi/projects/steps/${stepId}`, { method: "PUT", body: { status } }));
        loadBriefing(briefStyle);
      }
    }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  const pause = async () => {
    try { await api(`/hi/projects/${id}/status`, { method: "PUT", body: { status: "paused" } }); Alert.alert("Saved", "Project paused — resume anytime."); load(); } catch {}
  };
  const resume = async () => {
    try { await api(`/hi/projects/${id}/status`, { method: "PUT", body: { status: "active" } }); load(); } catch {}
  };
  const doAsk = async () => {
    if (!q.trim()) return;
    setAsking(true); setAnswer(null);
    try { const r = await api<{ answer: string }>(`/hi/projects/${id}/ask`, { method: "POST", body: { question: q.trim(), project_step_id: data?.current_step?.id } }); setAnswer(r.answer); }
    catch { setAnswer("Couldn't answer right now."); }
    finally { setAsking(false); }
  };

  const openOverride = async () => {
    if (overrideReasons.length === 0) {
      try { const r = await api<any>("/hi/workspace/override-reasons"); setOverrideReasons(r.reasons || []); } catch {}
    }
    setOverrideOpen(true);
  };
  const submitOverride = async (reason: string) => {
    if (!cur) return;
    setOverrideOpen(false);
    setBusy(true);
    try {
      await api(`/hi/workspace/projects/${id}/steps/${cur.id}/skip-override`, { method: "POST", body: { reason } });
      load();
    } catch (e: any) { Alert.alert("Couldn't skip", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Project" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;
  const p = data.project;
  const safeColor = SAFETY_COLOR[p.safety_status] || colors.warning;
  const mustStop = p.safety_status === "Stop and contact a professional";
  const cur = data.current_step;
  const done = p.status === "completed" || p.status === "unresolved" || p.status === "escalated";

  return (
    <View style={styles.root}>
      <ScreenHeader title="Project" right={
        <Pressable testID="proj-materials-btn" onPress={() => router.push(`/home-intel/projects/materials?id=${id}`)}>
          <MaterialCommunityIcons name="cart-outline" size={20} color={colors.brandPrimary} />
        </Pressable>} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.title}>{p.title}</Text>
        {(data.room || data.asset) && <Text style={styles.ctx}>{[data.room?.name, data.asset?.name].filter(Boolean).join(" · ")}</Text>}
        {!!p.description && <Text style={styles.summary}>{p.description}</Text>}

        {offline && (
          <View style={styles.offlineBanner}>
            <MaterialCommunityIcons name="cloud-off-outline" size={16} color={colors.warning} />
            <Text style={styles.offlineText}>Offline — showing your saved copy. Changes sync when you reconnect. Live safety checks can&apos;t run offline.</Text>
          </View>
        )}

        {/* Daily briefing (Doc 49 §9) */}
        {briefing && (
          <View style={styles.briefCard}>
            <View style={styles.briefHead}>
              <MaterialCommunityIcons name="robot-happy-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.briefLabel}>Homie&apos;s briefing</Text>
              {briefing.state?.label ? <Text style={styles.briefState}>{briefing.state.label}</Text> : null}
            </View>
            <Text style={styles.briefSpoken}>{briefing.spoken}</Text>
            {briefing.safety_reminder ? <Text style={styles.briefSafety}>⚠ {briefing.safety_reminder}</Text> : null}
            {briefStyle === "detailed" && (briefing.known_issues || []).map((k: string, i: number) => (
              <Text key={i} style={styles.briefIssue}>• {k}</Text>
            ))}
            <View style={styles.briefStyleRow}>
              {BRIEF_STYLES.map((s) => (
                <Pressable key={s} testID={`proj-brief-${s}`} style={[styles.briefChip, briefStyle === s && styles.briefChipActive]}
                  onPress={() => { setBriefStyle(s); if (!offline) loadBriefing(s); }}>
                  <Text style={[styles.briefChipText, briefStyle === s && { color: colors.onBrandPrimary }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* time-aware What's Next (Doc 49 §5) */}
        {!done && !mustStop && (
          <View style={styles.nextCard}>
            <Text style={styles.nextLabel}>How much time do you have?</Text>
            <View style={styles.briefStyleRow}>
              {TIME_CHIPS.map((m) => (
                <Pressable key={m} testID={`proj-time-${m}`} style={[styles.briefChip, whatsNext?.minutes_available === m && styles.briefChipActive]} disabled={nextBusy || offline} onPress={() => fetchWhatsNext(m)}>
                  <Text style={[styles.briefChipText, whatsNext?.minutes_available === m && { color: colors.onBrandPrimary }]}>{m} min</Text>
                </Pressable>
              ))}
            </View>
            {nextBusy && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.sm }} />}
            {whatsNext?.recommendation && !nextBusy && (
              <View style={styles.nextRec}>
                <Text style={styles.nextRecTitle}>{whatsNext.recommendation.title}</Text>
                <Text style={styles.nextRecWhy}>{whatsNext.recommendation.why}</Text>
              </View>
            )}
          </View>
        )}

        <View style={[styles.safetyBanner, { backgroundColor: safeColor }]}>
          <MaterialCommunityIcons name={mustStop ? "hand-back-right" : "shield-check"} size={18} color={colors.onError} />
          <Text style={styles.safetyText}>{p.safety_status || "Verify first"}</Text>
        </View>

        <View style={styles.metaRow}>
          <Meta icon="chart-line-variant" v={p.difficulty || "—"} />
          <Meta icon="clock-outline" v={p.estimated_duration || "—"} />
          <Meta icon="cash" v={p.estimated_cost_low != null ? `$${p.estimated_cost_low}-${p.estimated_cost_high}` : "—"} />
          <Meta icon="alert-decagram-outline" v={p.risk_level || "—"} />
        </View>

        {/* progress */}
        <View style={styles.progressWrap}>
          <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${data.progress_pct}%` }]} /></View>
          <Text style={styles.progressText}>{data.progress_pct}% · {data.steps_done}/{data.steps_total} steps</Text>
        </View>

        {mustStop && (
          <Pressable testID="proj-pro" style={styles.proBtn} onPress={() => router.push("/pros")}>
            <MaterialCommunityIcons name="account-hard-hat" size={18} color={colors.onError} /><Text style={styles.proText}>Contact a Professional</Text>
          </Pressable>
        )}

        {p.preparation_checklist?.length > 0 && (
          <>
            <Text style={styles.section}>Preparation</Text>
            {p.preparation_checklist.map((c: string, i: number) => <Text key={i} style={styles.li}>• {c}</Text>)}
          </>
        )}

        {/* NOW card — Doc 51 "Do This Next" */}
        {!done && cur && !mustStop && (
          <View style={styles.stepCard}>
            <Text style={styles.stepLabel}>DO THIS NEXT</Text>
            <Text style={styles.stepInstr}>{now?.title || cur.instruction}</Text>
            {now?.reason ? <Text style={styles.nowWhy}>Why: {now.reason}</Text> : null}
            {(now?.requiredTools || []).length > 0 && (
              <View style={styles.toolChips}>
                {now.requiredTools.slice(0, 6).map((t: string) => (
                  <View key={t} style={styles.toolChip}><Text style={styles.toolChipText}>{String(t).replace(/_/g, " ")}</Text></View>
                ))}
              </View>
            )}
            {now?.safety && (
              <View style={[styles.safetyStrip, { borderLeftColor: SAFETY_TONE[now.safety.color] || colors.success }]}>
                <Text style={[styles.safetyStripText, { color: SAFETY_TONE[now.safety.color] || colors.success }]}>
                  {now.safety.color}: {now.safety.label}{now.safety.note ? ` — ${now.safety.note}` : ""}
                </Text>
              </View>
            )}
            {!!cur.safety_note && !now?.safety?.note && <Text style={styles.stepSafety}>⚠ {cur.safety_note}</Text>}
            <View style={styles.stepBtns}>
              <Pressable testID="proj-guided" style={[styles.primaryBtn, { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" }]} onPress={() => router.push(`/home-intel/projects/guided?id=${id}`)}>
                <MaterialCommunityIcons name="play-circle-outline" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.primaryBtnText}>Start Guided Mode</Text>
              </Pressable>
            </View>
            <View style={styles.stepBtns}>
              <Pressable testID="proj-show-me" style={styles.outlineBtn} onPress={() => router.push("/home-intel/guide")}><Text style={styles.outlineText}>Show Me</Text></Pressable>
              <Pressable testID="proj-ar-guide" style={styles.outlineBtn} onPress={() => router.push(`/home-intel/ar?project_id=${id}`)}><Text style={styles.outlineText}>AR Guidance</Text></Pressable>
            </View>
            <View style={styles.stepBtns}>
              <Pressable testID="proj-step-complete" style={styles.primaryBtn} disabled={busy} onPress={() => stepAction(cur.id, "completed")}><Text style={styles.primaryBtnText}>I Finished This</Text></Pressable>
              <Pressable testID="proj-step-skip" style={styles.outlineBtn} disabled={busy} onPress={openOverride}><Text style={styles.outlineText}>Skip…</Text></Pressable>
            </View>
            <View style={styles.stepBtns}>
              <Pressable testID="proj-ask" style={styles.outlineBtn} onPress={() => { setAsk(true); setAnswer(null); setQ(""); }}><Text style={styles.outlineText}>Ask Homie</Text></Pressable>
              <Pressable testID="proj-save-later" style={styles.outlineBtn} onPress={pause}><Text style={styles.outlineText}>Save for Later</Text></Pressable>
            </View>
            {now?.nextTaskPreview ? <Text style={styles.nextPreview}>Up next: {now.nextTaskPreview}</Text> : null}
          </View>
        )}
        {p.status === "paused" && !mustStop && (
          <Pressable testID="proj-resume" style={styles.primaryBtn} onPress={resume}><Text style={styles.primaryBtnText}>Resume Project</Text></Pressable>
        )}

        {/* phases */}
        <Text style={styles.section}>Plan</Text>
        {data.phases.map((ph: any) => (
          <View key={ph.id} style={styles.phase}>
            <Text style={styles.phaseName}>{ph.phase_name}</Text>
            {ph.steps.map((s: any) => (
              <View key={s.id} style={styles.stepRow}>
                <MaterialCommunityIcons name={STEP_ICON[s.status] || "circle-outline"} size={16} color={s.status === "completed" ? colors.success : s.status === "active" ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.stepRowText, (s.status === "completed" || s.status === "skipped") && styles.strike]}>{s.instruction}</Text>
              </View>
            ))}
          </View>
        ))}

        {Array.isArray(p.stop_conditions) && p.stop_conditions.length > 0 && (<><Text style={[styles.section, { color: colors.error }]}>Stop immediately if…</Text>{p.stop_conditions.map((c: string, i: number) => <Text key={i} style={styles.li}>• {c}</Text>)}</>)}
        {Array.isArray(p.cleanup_disposal) && p.cleanup_disposal.length > 0 && (<><Text style={styles.section}>Cleanup & disposal</Text>{p.cleanup_disposal.map((c: string, i: number) => <Text key={i} style={styles.li}>• {c}</Text>)}</>)}
        {!Array.isArray(p.cleanup_disposal) && !!p.cleanup_disposal && (<><Text style={styles.section}>Cleanup & disposal</Text><Text style={styles.li}>{String(p.cleanup_disposal)}</Text></>)}
        {!!p.maintenance_followup && (<><Text style={styles.section}>Maintenance follow-up</Text><Text style={styles.li}>{p.maintenance_followup}</Text></>)}

        <Pressable testID="proj-problem" style={[styles.wideBtn, { borderColor: colors.warning }]} onPress={() => setProblemOpen(true)}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.warning} /><Text style={[styles.wideText, { color: colors.warning }]}>  Something Changed / Report a Problem</Text>
        </Pressable>
        <Pressable testID="proj-evidence" style={styles.wideBtn} onPress={() => router.push(`/home-intel/projects/evidence?id=${id}`)}>
          <MaterialCommunityIcons name="timeline-clock-outline" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Project Evidence Timeline</Text>
        </Pressable>
        <Pressable testID="proj-shopping" style={styles.wideBtn} onPress={() => router.push(`/home-intel/projects/materials?id=${id}`)}>
          <MaterialCommunityIcons name="cart-outline" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Shopping List</Text>
        </Pressable>
        <Pressable testID="proj-budget" style={styles.wideBtn} onPress={() => router.push(`/home-intel/projects/budget?id=${id}`)}>
          <MaterialCommunityIcons name="cash-multiple" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Budget &amp; Changes</Text>
        </Pressable>
        <Pressable testID="proj-pro-help" style={styles.wideBtn} onPress={() => router.push(`/home-intel/projects/pro-help?id=${id}`)}>
          <MaterialCommunityIcons name="account-hard-hat" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Bring in a Pro</Text>
        </Pressable>
        <Pressable testID="proj-intelligence" style={styles.wideBtn} onPress={() => router.push(`/home-intel/projects/intelligence?id=${id}`)}>
          <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Next Best Step &amp; Blockers</Text>
        </Pressable>
        <Pressable testID="proj-ar" style={styles.wideBtn} onPress={() => router.push(`/home-intel/ar?project_id=${id}`)}>
          <MaterialCommunityIcons name="cube-scan" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  View Steps in AR</Text>
        </Pressable>
        <Pressable testID="proj-compliance" style={styles.wideBtn} onPress={() => router.push(`/home-intel/compliance?project_id=${id}`)}>
          <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Permits &amp; Code Check</Text>
        </Pressable>
        <Pressable testID="proj-recommend" style={styles.wideBtn} onPress={() => router.push(`/home-intel/rec?project_id=${id}`)}>
          <MaterialCommunityIcons name="tag-search-outline" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Recommended Products</Text>
        </Pressable>
        <Pressable testID="proj-cleanup" style={styles.wideBtn} onPress={() => router.push(`/home-intel/cleanup?project_id=${id}`)}>
          <MaterialCommunityIcons name="broom" size={18} color={colors.brandPrimary} /><Text style={styles.wideText}>  Cleanup &amp; Disposal</Text>
        </Pressable>
        {!done && (
          <Pressable testID="proj-complete" style={styles.wideBtnFill} onPress={() => router.push(`/home-intel/projects/complete?id=${id}`)}>
            <Text style={styles.wideFillText}>Did you complete this project?</Text>
          </Pressable>
        )}
        {done && <Text style={styles.doneNote}>This project is {p.status} and saved to your property history.</Text>}
      </ScrollView>

      <Modal visible={ask} transparent animationType="slide" onRequestClose={() => setAsk(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ask Homie</Text>
            <TextInput testID="proj-ask-input" style={styles.modalInput} value={q} onChangeText={setQ} placeholder="e.g. How do I find a stud?" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            {answer && <Text style={styles.answer}>{answer}</Text>}
            <Pressable testID="proj-ask-send" style={styles.primaryBtn} disabled={asking} onPress={doAsk}>{asking ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Ask</Text>}</Pressable>
            <Pressable style={styles.modalClose} onPress={() => setAsk(false)}><Text style={styles.outlineText}>Close</Text></Pressable>
          </View>
        </View>
      </Modal>

      <ReportProblemModal visible={problemOpen} onClose={() => setProblemOpen(false)} projectId={String(id)} onReported={() => { load(); }} />

      <Modal visible={overrideOpen} transparent animationType="slide" onRequestClose={() => setOverrideOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Why are you skipping this step?</Text>
            <Text style={styles.overrideNote}>Skips are recorded in your project history so your home record stays accurate.</Text>
            {overrideReasons.map((r) => (
              <Pressable key={r.code} testID={`proj-override-${r.code}`} style={styles.overrideRow} onPress={() => submitOverride(r.code)}>
                <MaterialCommunityIcons name="chevron-right-circle-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.overrideLabel}>{r.label}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.modalClose} onPress={() => setOverrideOpen(false)}><Text style={styles.outlineText}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const SAFETY_TONE: Record<string, string> = { GREEN: colors.success, YELLOW: "#F2C94C", ORANGE: "#F2994A", RED: colors.error };

function Meta({ icon, v }: { icon: any; v: string }) {
  return <View style={styles.meta}><MaterialCommunityIcons name={icon} size={16} color={colors.brandPrimary} /><Text style={styles.metaText} numberOfLines={1}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: type["2xl"] },
  ctx: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm, marginTop: 2 },
  summary: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: spacing.sm },
  safetyBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  safetyText: { color: colors.onError, fontFamily: font.bold, fontSize: type.base },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  metaText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.xs, maxWidth: 120 },
  progressWrap: { marginTop: spacing.lg },
  progressBar: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: colors.brandPrimary },
  progressText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, marginTop: 4 },
  proBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.error, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  proText: { color: colors.onError, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  li: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: 2 },
  stepCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  stepLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  stepInstr: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg, lineHeight: 24, marginTop: spacing.xs },
  stepSafety: { color: colors.warning, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.sm },
  stepBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  primaryBtn: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  primaryBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  outlineBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  outlineText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  phase: { marginBottom: spacing.md },
  phaseName: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.xs },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 3 },
  stepRowText: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  strike: { color: colors.onSurfaceTertiary, textDecorationLine: "line-through" },
  wideBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  wideText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  wideBtnFill: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.md },
  wideFillText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  doneNote: { color: colors.success, fontFamily: font.medium, fontSize: type.sm, textAlign: "center", marginTop: spacing.lg },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  modalTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.sm },
  modalInput: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, minHeight: 70, textAlignVertical: "top" },
  answer: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, padding: spacing.md },
  modalClose: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
  offlineBanner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.warning + "14", borderColor: colors.warning + "55", borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  offlineText: { flex: 1, color: colors.warning, fontFamily: font.medium, fontSize: type.xs, lineHeight: 16 },
  briefCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  briefHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  briefLabel: { flex: 1, color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  briefState: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs },
  briefSpoken: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 22, marginTop: spacing.sm },
  briefSafety: { color: colors.warning, fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.xs },
  briefIssue: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  briefStyleRow: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  briefChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
  briefChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  briefChipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  nextCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  nextLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  nextRec: { marginTop: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.brandPrimary, paddingLeft: spacing.sm },
  nextRecTitle: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 20 },
  nextRecWhy: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 2, lineHeight: 16 },
  nowWhy: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs, lineHeight: 20 },
  toolChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  toolChip: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  toolChipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  safetyStrip: { borderLeftWidth: 3, paddingLeft: spacing.sm, marginTop: spacing.sm },
  safetyStripText: { fontFamily: font.medium, fontSize: type.xs, lineHeight: 16 },
  nextPreview: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.sm, fontStyle: "italic" },
  overrideNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginBottom: spacing.sm },
  overrideRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, minHeight: 48 },
  overrideLabel: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
});
