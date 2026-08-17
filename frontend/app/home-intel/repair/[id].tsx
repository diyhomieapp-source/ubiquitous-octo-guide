import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, SafetyCard, AIResponseCard } from "@/src/components/ui";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";
import { ContextRequestCard } from "@/src/components/ContextRequestCard";
import { CATEGORY_LABELS, PHASE_LABELS } from "./index";

const RISK_TO_SAFETY: Record<string, "safe" | "verify" | "stop" | "emergency"> = {
  normal: "safe", caution: "verify", elevated: "stop", emergency_review: "emergency",
};
const CONF_TO_LEVEL: Record<string, "low" | "medium" | "high"> = {
  verified: "high", high_confidence: "high", conditional: "medium", uncertain: "low",
};

export default function RepairWorkspace() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [cpNote, setCpNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { setData(await api<any>(`/hi/repair/issues/${id}`)); } catch (e: any) { Alert.alert("Couldn't load", e?.message || ""); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) {
    return <View style={[styles.root, { paddingTop: insets.top }]}><LoadingState /></View>;
  }
  const { issue, evidence, assessment, questions, plan, position, decisions } = data;
  const triage = issue.triage || {};
  const hardStop = !!triage.hard_stop;

  const run = async (key: string, fn: () => Promise<any>, reload = true) => {
    setBusy(key);
    try { const r = await fn(); if (reload) await load(); return r; }
    catch (e: any) { Alert.alert("Something went wrong", e?.message || "Try again."); }
    finally { setBusy(""); }
  };

  const generateAssessment = () => run("assess", () => api(`/hi/repair/issues/${id}/assess`, { method: "POST" }));
  const createPlan = () => run("plan", async () => {
    try { await api(`/hi/repair/issues/${id}/plan`, { method: "POST" }); }
    catch (e: any) { Alert.alert("Can't build a plan", e?.message || ""); throw e; }
  });

  const answer = async (qid: string) => {
    const a = (answers[qid] || "").trim();
    if (!a) return;
    await run(`q-${qid}`, () => api(`/hi/repair/questions/${qid}/answer`, { method: "POST", body: { answer: a } }));
    setAnswers((s) => ({ ...s, [qid]: "" }));
  };

  const addPhoto = async (fromCamera: boolean) => {
    const b64 = fromCamera ? await takePhoto("Add a photo of the issue so Homie can assess it.") : await pickFromLibrary("Add a photo of the issue so Homie can assess it.");
    if (!b64) return;
    await run("photo", () => api(`/hi/repair/issues/${id}/evidence`, { method: "POST", body: { type: "photo", base64: b64 } }));
  };
  const addNote = async () => {
    if (!note.trim()) return;
    await run("note", () => api(`/hi/repair/issues/${id}/evidence`, { method: "POST", body: { type: "observation", note: note.trim() } }));
    setNote("");
  };

  const taskAction = async (taskId: string, action: string, extraNote?: string) => {
    const r = await run(`t-${taskId}-${action}`, () => api(`/hi/repair/plan-tasks/${taskId}/action`, { method: "POST", body: { action, note: extraNote } }));
    if (r?.help) Alert.alert("Homie", r.help);
    if (r?.needs_checkpoint) Alert.alert("Quick check needed", r.message || "This step needs a verification before we continue.");
    if (r?.revised) Alert.alert("Plan updated", r.message || "I've re-assessed based on what you found.");
    if (r?.all_done) Alert.alert("Nice work", "All steps are done. Tap 'Verify & record outcome' when ready.");
  };
  const confirmMismatch = (taskId: string, action: string, label: string) => {
    if (Platform.OS === "ios" && Alert.prompt) {
      Alert.prompt(label, "Tell me what you found (optional):", [
        { text: "Cancel", style: "cancel" },
        { text: "Submit", onPress: (txt) => taskAction(taskId, action, txt || undefined) },
      ]);
    } else {
      taskAction(taskId, action);
    }
  };

  const submitCheckpoint = async (taskId: string, withPhoto: boolean) => {
    let b64: string | null = null;
    if (withPhoto) { b64 = await pickFromLibrary("Add a verification photo for this step."); if (!b64) return; }
    await run(`cp-${taskId}`, () => api(`/hi/repair/plan-tasks/${taskId}/checkpoint`, {
      method: "POST", body: { confirmation: true, note: cpNote[taskId] || undefined, observation: cpNote[taskId] || undefined, base64: b64 || undefined },
    })).then((r) => { if (r && !r.satisfied) Alert.alert("Still needed", `Please add: ${(r.missing || []).join(", ")}`); });
    setCpNote((s) => ({ ...s, [taskId]: "" }));
  };

  const coach = async (taskId: string, prompt: string) => {
    const r = await run(`coach-${taskId}`, () => api<any>(`/hi/repair/plan-tasks/${taskId}/coach`, { method: "POST", body: { prompt } }), false);
    if (r?.reply) Alert.alert(r.emergency ? "⚠️ Safety" : "Homie", r.reply + (r.recommend_pause ? "\n\nI'd suggest pausing here." : ""));
  };

  const sessionAction = (action: string, label: string) => Alert.alert(label, "Are you sure?", [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", onPress: () => run(`sess-${action}`, () => api(`/hi/repair/issues/${id}/session-action`, { method: "POST", body: { action } })) },
  ]);

  const cycleMaterial = async (name: string, current: string) => {
    const order = ["unknown", "available", "unavailable", "borrowed", "substituted"];
    const next = order[(order.indexOf(current) + 1) % order.length];
    await run(`mat-${name}`, () => api(`/hi/repair/issues/${id}/materials`, { method: "POST", body: { name, status: next } }));
  };

  const goCloseout = () => router.push(`/home-intel/repair/closeout/${id}` as any);
  const reopen = () => Alert.alert("Reopen project", "Bring this project back to active if the problem returned?", [
    { text: "Cancel", style: "cancel" },
    { text: "Reopen", onPress: () => run("reopen", () => api(`/hi/record/issues/${id}/reopen`, { method: "POST", body: { reason: "Reopened by homeowner" } })) },
  ]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="rw-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back">
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Repair</Text>
        <Pressable testID="rw-chat" onPress={() => router.push(`/home-intel/repair/chat/${id}` as any)} style={styles.iconBtn} accessibilityLabel="Ask Homie">
          <MaterialCommunityIcons name="chat-processing-outline" size={22} color={colors.brandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        {/* Issue summary */}
        <View style={styles.issueCard}>
          <Text style={styles.issueText}>{issue.description}</Text>
          <View style={styles.metaRow}>
            <View style={styles.chip}><Text style={styles.chipText}>{CATEGORY_LABELS[issue.category] || issue.category}</Text></View>
            <View style={styles.chip}><Text style={styles.chipText}>{PHASE_LABELS[issue.phase] || issue.phase}</Text></View>
          </View>
        </View>

        {/* Safety panel */}
        {triage.message ? (
          <SafetyCard testID="rw-safety" level={RISK_TO_SAFETY[triage.risk_level] || "verify"} message={triage.message}>
            {hardStop ? <Text style={styles.safetyNote}>{triage.guidance}</Text> : null}
          </SafetyCard>
        ) : null}

        {/* Assessment */}
        {hardStop ? (
          <View style={styles.blockedCard}>
            <MaterialCommunityIcons name="shield-alert-outline" size={20} color={colors.error} />
            <Text style={styles.blockedText}>{"For your safety, I won't create a DIY plan for this. Please follow the safety guidance above and contact the right professional."}</Text>
          </View>
        ) : !assessment ? (
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Ready when you are</Text>
            <Text style={styles.actionBody}>{"I'll review what you've told me and any evidence, then give you a clear assessment and the safest next step."}</Text>
            <Button testID="rw-assess" label="Assess this" icon="magnify-scan" loading={busy === "assess"} onPress={generateAssessment} />
          </View>
        ) : (
          <>
            <AIResponseCard
              testID="rw-assessment"
              summary={assessment.issue_summary}
              confidence={CONF_TO_LEVEL[assessment.confidence_level] || "low"}
              sections={[
                assessment.possible_causes?.length ? { icon: "help-rhombus-outline", title: "Most likely", body: assessment.possible_causes.map((c: any) => `• ${c.cause} (${c.likelihood})`).join("\n") } : null,
                { icon: "arrow-right-circle-outline", title: "Safe next action", body: assessment.safe_next_action },
                { icon: "hammer-wrench", title: "DIY vs pro", body: assessment.DIY_boundary },
                assessment.missing_information?.length ? { icon: "clipboard-alert-outline", title: "To be more sure I need", body: assessment.missing_information.map((m: string) => `• ${m}`).join("\n") } : null,
              ].filter(Boolean) as any}
            />
            {assessment.professional_verification_required ? (
              <SafetyCard testID="rw-proverify" level="verify" title="Professional verification recommended" message="Based on the evidence so far, have a licensed professional confirm before any invasive work." />
            ) : null}
            <View style={styles.rowBtns}>
              <Pressable testID="rw-reassess" onPress={generateAssessment} style={styles.linkBtn}>
                {busy === "assess" ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Text style={styles.linkText}>Re-assess with new evidence</Text>}
              </Pressable>
            </View>
          </>
        )}

        {/* Open questions */}
        {questions?.filter((q: any) => q.status === "open").length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>A couple of things would help</Text>
            {questions.filter((q: any) => q.status === "open").slice(0, 3).map((q: any) => (
              <View key={q.id} style={styles.qCard}>
                <Text style={styles.qText}>{q.prompt}</Text>
                <View style={styles.qRow}>
                  <TextInput testID={`rw-answer-${q.id}`} value={answers[q.id] || ""} onChangeText={(t) => setAnswers((s) => ({ ...s, [q.id]: t }))} placeholder="Your answer" placeholderTextColor={colors.onSurfaceTertiary} style={styles.qInput} />
                  <Pressable testID={`rw-answer-send-${q.id}`} onPress={() => answer(q.id)} style={styles.qSend}>
                    {busy === `q-${q.id}` ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="send" size={18} color={colors.onBrandPrimary} />}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Evidence workspace */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Evidence ({evidence?.length || 0})</Text>
          <View style={styles.rowBtns}>
            <Pressable testID="rw-photo-cam" onPress={() => addPhoto(true)} style={styles.evBtn}><MaterialCommunityIcons name="camera-outline" size={18} color={colors.onSurface} /><Text style={styles.evBtnText}>Take photo</Text></Pressable>
            <Pressable testID="rw-photo-lib" onPress={() => addPhoto(false)} style={styles.evBtn}><MaterialCommunityIcons name="image-outline" size={18} color={colors.onSurface} /><Text style={styles.evBtnText}>Upload</Text></Pressable>
            <Pressable testID="rw-guided-capture" onPress={() => router.push(`/home-intel/repair/capture/${id}` as any)} style={styles.evBtn}><MaterialCommunityIcons name="camera-plus-outline" size={18} color={colors.brandPrimary} /><Text style={[styles.evBtnText, { color: colors.brandPrimary }]}>Guided capture</Text></Pressable>
          </View>
          <ContextRequestCard issueId={String(id)} />
          <View style={styles.qRow}>
            <TextInput testID="rw-note" value={note} onChangeText={setNote} placeholder="Add an observation…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.qInput} />
            <Pressable testID="rw-note-send" onPress={addNote} style={styles.qSend}>
              {busy === "note" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />}
            </Pressable>
          </View>
          {evidence?.slice(0, 6).map((e: any) => (
            <View key={e.id} style={styles.evRow}>
              <MaterialCommunityIcons name={e.type === "photo" ? "image" : e.type === "measurement" ? "ruler" : "note-text-outline"} size={16} color={colors.onSurfaceTertiary} />
              <Text style={styles.evText} numberOfLines={2}>{e.note || (e.has_media ? `${e.type} attached` : e.type)}</Text>
            </View>
          ))}
        </View>

        {/* Repair plan */}
        {!hardStop && assessment ? (
          !plan ? (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Turn this into a plan</Text>
              <Text style={styles.actionBody}>{"I'll break it into small, safe steps — each with what to do, what to check first, and when to stop."}</Text>
              <Button testID="rw-plan" label="Create repair plan" icon="clipboard-list-outline" loading={busy === "plan"} onPress={createPlan} />
            </View>
          ) : (
            <View style={styles.section}>
              <View style={styles.planHead}>
                <Text style={styles.sectionTitle}>Repair plan · {plan.difficulty?.replace("_", " ")} · {plan.time_estimate}</Text>
                <View style={styles.sessBtns}>
                  <Pressable testID="rw-pause" onPress={() => sessionAction("pause", "Pause project")} style={styles.sessBtn}><MaterialCommunityIcons name="pause" size={16} color={colors.onSurfaceSecondary} /></Pressable>
                  <Pressable testID="rw-pro" onPress={() => router.push(`/home-intel/repair/pro/${id}` as any)} style={styles.sessBtn}><MaterialCommunityIcons name="account-hard-hat" size={16} color={colors.onSurfaceSecondary} /></Pressable>
                </View>
              </View>
              {(() => {
                const total = plan.tasks.length;
                const doneN = plan.tasks.filter((t: any) => ["complete", "superseded"].includes(t.status)).length;
                const pct = total ? Math.round((doneN / total) * 100) : 0;
                return (
                  <View style={styles.progWrap}>
                    <View style={styles.progBar}><View style={[styles.progFill, { width: `${pct}%` }]} /></View>
                    <Text style={styles.progText}>{doneN}/{total} steps</Text>
                  </View>
                );
              })()}
              {plan.safety_notes?.length ? <SafetyCard level="verify" title="Before you start" message={plan.safety_notes.join("\n")} /> : null}
              {plan.tools_materials?.length ? (
                <View style={styles.matWrap}>
                  <Text style={styles.matLabel}>Tools & materials (tap to set status)</Text>
                  <View style={styles.wrap}>
                    {plan.tools_materials.map((m: any) => (
                      <Pressable key={m.name} testID={`rw-mat-${m.name}`} onPress={() => cycleMaterial(m.name, m.status)} style={[styles.matChip, m.status === "available" && styles.matOk, m.status === "unavailable" && styles.matBad]}>
                        <Text style={styles.matChipText}>{m.name}{m.status !== "unknown" ? ` · ${m.status}` : ""}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable testID="rw-readiness" onPress={() => router.push(`/home-intel/repair/readiness/${id}` as any)} style={styles.readinessBanner}>
                    <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={colors.brandPrimary} />
                    <Text style={styles.readinessText}>Materials & Budget — full list, cost range and what you already own</Text>
                    <MaterialCommunityIcons name="chevron-right" size={18} color={colors.brandPrimary} />
                  </Pressable>
                  <Pressable testID="rw-toolpack" onPress={() => router.push(`/home-intel/repair/toolpack/${id}` as any)} style={styles.readinessBanner}>
                    <MaterialCommunityIcons name="toolbox-outline" size={18} color={colors.brandPrimary} />
                    <Text style={styles.readinessText}>{"Today's Tool Pack — what to grab & what's missing"}</Text>
                    <MaterialCommunityIcons name="chevron-right" size={18} color={colors.brandPrimary} />
                  </Pressable>
                </View>
              ) : null}
              {plan.tasks.map((t: any, idx: number) => {
                const done = t.status === "complete";
                const superseded = t.status === "superseded";
                const awaiting = t.status === "awaiting_verification";
                return (
                  <View key={t.id} testID={`rw-task-${t.id}`} style={[styles.taskCard, done && styles.taskDone, superseded && styles.taskSuperseded]}>
                    <View style={styles.taskHead}>
                      <MaterialCommunityIcons name={done ? "check-circle" : superseded ? "close-circle-outline" : awaiting ? "clock-alert-outline" : "circle-outline"} size={18} color={done ? colors.success : superseded ? colors.onSurfaceTertiary : awaiting ? colors.warning : colors.brandPrimary} />
                      <Text style={[styles.taskTitle, (done || superseded) && styles.strike]}>{idx + 1}. {t.title}</Text>
                    </View>
                    {t.preconditions ? <Text style={styles.taskMeta}>Before: {t.preconditions}</Text> : null}
                    {t.tools?.length ? <Text style={styles.taskMeta}>Tools: {t.tools.join(", ")}</Text> : null}
                    {t.what_to_do ? <Text style={styles.taskBody}>{t.what_to_do}</Text> : null}
                    {t.why_it_matters ? <Text style={styles.taskMeta}>Why: {t.why_it_matters}</Text> : null}
                    {t.verification_before_proceeding ? <Text style={styles.taskMeta}>Check first: {t.verification_before_proceeding}</Text> : null}
                    {t.safety_caution ? <View style={styles.cautionRow}><MaterialCommunityIcons name="alert-outline" size={14} color={colors.warning} /><Text style={styles.cautionText}>{t.safety_caution}</Text></View> : null}
                    {t.expected_result ? <Text style={styles.taskMeta}>Expect: {t.expected_result}</Text> : null}
                    {t.completion_criteria ? <Text style={styles.taskMeta}>Done when: {t.completion_criteria}</Text> : null}
                    {awaiting ? (
                      <View style={styles.cpCard}>
                        <Text style={styles.cpTitle}>Verification needed{t.checkpoint?.description ? `: ${t.checkpoint.description}` : ""}</Text>
                        <TextInput testID={`rw-cp-note-${t.id}`} value={cpNote[t.id] || ""} onChangeText={(v) => setCpNote((s) => ({ ...s, [t.id]: v }))} placeholder="What did you observe?" placeholderTextColor={colors.onSurfaceTertiary} style={styles.qInput} />
                        <View style={styles.taskActions}>
                          <Pressable testID={`rw-cp-confirm-${t.id}`} onPress={() => submitCheckpoint(t.id, false)} style={[styles.taskBtn, styles.taskBtnPrimary]}>{busy === `cp-${t.id}` ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.taskBtnPrimaryText}>Confirm</Text>}</Pressable>
                          <Pressable testID={`rw-cp-photo-${t.id}`} onPress={() => submitCheckpoint(t.id, true)} style={styles.taskBtn}><Text style={styles.taskBtnText}>Add photo</Text></Pressable>
                        </View>
                      </View>
                    ) : null}
                    {!done && !superseded && !awaiting ? (
                      <>
                        <View style={styles.taskActions}>
                          <Pressable testID={`rw-task-done-${t.id}`} onPress={() => taskAction(t.id, "done")} style={[styles.taskBtn, styles.taskBtnPrimary]}>
                            {busy === `t-${t.id}-done` ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.taskBtnPrimaryText}>Done</Text>}
                          </Pressable>
                          <Pressable testID={`rw-task-diff-${t.id}`} onPress={() => confirmMismatch(t.id, "found_different", "Found something different")} style={styles.taskBtn}><Text style={styles.taskBtnText}>Found something different</Text></Pressable>
                          <Pressable testID={`rw-task-fail-${t.id}`} onPress={() => confirmMismatch(t.id, "did_not_work", "This didn't work")} style={styles.taskBtn}><Text style={styles.taskBtnText}>{"Didn't work"}</Text></Pressable>
                          <Pressable testID={`rw-task-help-${t.id}`} onPress={() => taskAction(t.id, "need_help")} style={styles.taskBtn}><Text style={styles.taskBtnText}>Need help</Text></Pressable>
                        </View>
                        <View style={styles.wrap}>
                          <Pressable testID={`rw-coach-tool-${t.id}`} onPress={() => coach(t.id, "I don't have this tool. What can I safely use instead?")} style={styles.coachChip}><Text style={styles.coachChipText}>No tool?</Text></Pressable>
                          <Pressable testID={`rw-coach-diff-${t.id}`} onPress={() => coach(t.id, "Mine looks different from what's described. Is that a problem?")} style={styles.coachChip}><Text style={styles.coachChipText}>Looks different?</Text></Pressable>
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
              <Button testID="rw-complete" label="Verify & record outcome" variant="secondary" icon="flag-checkered" loading={busy === "complete"} onPress={goCloseout} />
            </View>
          )
        ) : null}

        {issue.phase === "DOCUMENTED" ? (
          <Button testID="rw-reopen" label="Reopen project" variant="secondary" icon="refresh" loading={busy === "reopen"} onPress={reopen} />
        ) : null}

        {/* Decision ledger */}
        {decisions?.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Decision ledger</Text>
            {decisions.map((d: any) => (
              <View key={d.id} style={styles.decRow}>
                <View style={[styles.decBadge, d.status === "rejected" || d.status === "superseded" ? { backgroundColor: colors.error + "22", borderColor: colors.error } : d.status === "accepted" ? { backgroundColor: colors.success + "22", borderColor: colors.success } : {}]}>
                  <Text style={styles.decBadgeText}>{d.status}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.decText}>{d.decision}</Text>
                  {d.reason ? <Text style={styles.decReason}>{d.reason}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Project position */}
        {position ? (
          <View style={styles.posCard}>
            <Text style={styles.posTitle}>Where this project stands</Text>
            <Text style={styles.posLine}><Text style={styles.posKey}>Next: </Text>{position.next_recommended_action}</Text>
            {position.professional_verification_requirements?.length ? <Text style={styles.posLine}><Text style={styles.posKey}>Note: </Text>{position.professional_verification_requirements[0]}</Text> : null}
          </View>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  issueCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  issueText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.lg, lineHeight: 22 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 11 },
  safetyNote: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginTop: spacing.xs },
  blockedCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.error + "14", borderColor: colors.error, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  blockedText: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  actionCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  actionTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  actionBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginBottom: spacing.xs },
  rowBtns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  linkBtn: { paddingVertical: spacing.xs },
  linkText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { gap: spacing.sm },
  planHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sessBtns: { flexDirection: "row", gap: spacing.xs },
  sessBtn: { width: 34, height: 34, borderRadius: 17, borderColor: colors.borderStrong, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  progWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progBar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progFill: { height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  progText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 12 },
  matWrap: { gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  matLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11 },
  matChip: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  matOk: { backgroundColor: colors.success + "22", borderColor: colors.success },
  matBad: { backgroundColor: colors.error + "22", borderColor: colors.error },
  matChipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 12 },
  cpCard: { backgroundColor: colors.warning + "14", borderColor: colors.warning, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginTop: spacing.sm },
  cpTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: 13 },
  coachChip: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  coachChipText: { color: colors.onBrandTertiary, fontFamily: font.medium, fontSize: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  sectionTitle: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.sm },
  qCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  qText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  qRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  qInput: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44 },
  qSend: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  evBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44 },
  evBtnText: { color: colors.onSurface, fontFamily: font.medium, fontSize: 13 },
  evRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  evText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: 13 },
  taskCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  taskDone: { opacity: 0.7 },
  taskSuperseded: { opacity: 0.55, borderStyle: "dashed" },
  taskHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  taskTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  strike: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  taskBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginTop: 2 },
  taskMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 12, lineHeight: 17 },
  cautionRow: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-start", marginTop: 2 },
  cautionText: { flex: 1, color: colors.warning, fontFamily: font.medium, fontSize: 12, lineHeight: 17 },
  taskActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  taskBtn: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  taskBtnText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: 12 },
  taskBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  taskBtnPrimaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 12 },
  decRow: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm },
  decBadge: { alignSelf: "flex-start", backgroundColor: colors.surfaceTertiary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  decBadgeText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  decText: { color: colors.onSurface, fontFamily: font.medium, fontSize: 13 },
  decReason: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 12, marginTop: 2 },
  posCard: { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  posTitle: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.base },
  posLine: { color: colors.onSurface, fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  posKey: { fontFamily: font.bold, color: colors.onBrandTertiary },
});
