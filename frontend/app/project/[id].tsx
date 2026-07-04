import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";
import { AvatarThinking } from "@/src/components/AvatarThinking";
import { CalculatorSheet } from "@/src/components/CalculatorSheet";
import { SupplyDrawer } from "@/src/components/SupplyDrawer";
import { CompletionModal } from "@/src/components/CompletionModal";
import { CodeCheckCard, projectNeedsCode } from "@/src/components/CodeCheckCard";
import { calculatorForProject } from "@/src/calculators/registry";

type Step = { id: string; index: number; title: string; instruction: string; visual_description: string; image_base64: string | null; done: boolean; added?: boolean };
type IntakeQ = { key: string; question: string; placeholder?: string; examples?: string[] };
type Guide = {
  overview: string; tools: string[]; materials: string[]; safety_warnings: string[];
  code_alert: string | null; common_mistakes: string[]; troubleshooting: string[];
  inspection_checklist: string[]; owned_tools: string[];
};
type Project = { id: string; title: string; status: string; favorite: boolean; guide: Guide | null; steps: Step[]; missing_supplies: string[]; notes: string };

function Section({ title, icon, children, defaultOpen = false }: any) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.section}>
      <Pressable style={styles.sectionHead} onPress={() => setOpen((o) => !o)}>
        <MaterialCommunityIcons name={icon} size={18} color={colors.brandPrimary} />
        <Text style={styles.sectionTitle}>{title}</Text>
        <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.onSurfaceTertiary} />
      </Pressable>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

export default function Workspace() {
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [generating, setGenerating] = useState(false);
  const [imgLoading, setImgLoading] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [chat, setChat] = useState<{ id: string; role: "user" | "homie"; text: string }[]>([]);
  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [calcOpen, setCalcOpen] = useState(false);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [proSug, setProSug] = useState<{ suggest: boolean; reason: string | null; suggested_trade: string } | null>(null);
  const askRef = useRef<ScrollView>(null);
  const [intake, setIntake] = useState<IntakeQ[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loadingIntake, setLoadingIntake] = useState(false);
  const [changedIds, setChangedIds] = useState<string[]>([]);
  const [remembers, setRemembers] = useState(false);

  const buildGuide = useCallback(async (pid: string, context?: Record<string, string>) => {
    setIntake(null);
    setGenerating(true);
    try {
      const full = await api<Project>(`/projects/${pid}/guide`, { method: "POST", body: context ? { context } : undefined, timeout: 120000 });
      setProject(full);
      if (user) setUser({ ...user, credits: Math.max(0, (user.credits ?? 0) - 3) });
    } catch (e: any) {
      if (e.message?.toLowerCase().includes("credit")) router.replace("/paywall");
    } finally {
      setGenerating(false);
    }
  }, [user, setUser, router]);

  const startIntake = useCallback(async (pid: string) => {
    setLoadingIntake(true);
    try {
      const res = await api<{ questions: IntakeQ[]; remembers?: boolean }>(`/projects/${pid}/intake`, { method: "POST", timeout: 60000 });
      setRemembers(!!res.remembers);
      if (res.questions?.length) setIntake(res.questions);
      else buildGuide(pid);
    } catch { buildGuide(pid); }
    finally { setLoadingIntake(false); }
  }, [buildGuide]);

  const load = useCallback(async () => {
    try {
      const p = await api<Project>(`/projects/${id}`);
      setProject(p);
      api(`/projects/${id}`, { method: "PATCH", body: { touch: true } }).catch(() => {});
      if (!p.guide) { if (isNew === "1") startIntake(p.id); else buildGuide(p.id); }
    } catch {}
  }, [id, isNew, buildGuide, startIntake]);

  useEffect(() => { if (id) load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (id) api<{ suggest: boolean; reason: string | null; suggested_trade: string }>(`/projects/${id}/pro-suggestion`).then(setProSug).catch(() => {});
  }, [id]);

  useEffect(() => { setTimeout(() => askRef.current?.scrollToEnd({ animated: true }), 60); }, [chat]);

  const total = project?.steps?.length || 0;
  const done = project?.steps?.filter((s) => s.done).length || 0;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const toggleDone = async (step: Step) => {
    if (!project) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const next = !step.done;
    setProject({ ...project, steps: project.steps.map((s) => (s.id === step.id ? { ...s, done: next } : s)) });
    try { await api(`/projects/${project.id}/steps/${step.id}/done`, { method: "POST", body: { done: next } }); } catch {}
  };

  const illustrate = async (step: Step) => {
    if (!project) return;
    setImgLoading(step.id);
    try {
      const res = await api<{ image_base64: string }>(`/projects/${project.id}/step/${step.id}/image`, { method: "POST", timeout: 120000 });
      setProject((p) => p ? { ...p, steps: p.steps.map((s) => (s.id === step.id ? { ...s, image_base64: res.image_base64 } : s)) } : p);
    } catch {} finally { setImgLoading(null); }
  };

  const toggleFav = async () => {
    if (!project) return;
    Haptics.selectionAsync();
    setProject({ ...project, favorite: !project.favorite });
    api(`/projects/${project.id}`, { method: "PATCH", body: { favorite: !project.favorite } }).catch(() => {});
  };

  const goSupplies = async () => {
    if (!project) return;
    await storage.setItem("diyhomie_active_project", project.id);
    router.push("/(tabs)/supplies");
  };

  const sendAsk = async () => {
    const text = askInput.trim();
    if (!text || asking || !project) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAskInput("");
    setChat((c) => [...c, { id: `${Date.now()}u`, role: "user", text }]);
    setAsking(true);
    try {
      const res = await api<{ answer: string; credits: number }>(`/projects/${project.id}/ask`, { method: "POST", body: { message: text, mode } });
      setChat((c) => [...c, { id: `${Date.now()}h`, role: "homie", text: res.answer }]);
      if (user) setUser({ ...user, credits: res.credits });
    } catch (e: any) {
      const msg = e.message?.toLowerCase().includes("credit") ? "You're out of credits — upgrade to keep chatting." : "Homie couldn't answer right now.";
      setChat((c) => [...c, { id: `${Date.now()}e`, role: "homie", text: msg }]);
    } finally { setAsking(false); }
  };

  const sendAdapt = async () => {
    const text = askInput.trim();
    if (!text || asking || !project) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAskInput("");
    setChat((c) => [...c, { id: `${Date.now()}u`, role: "user", text }]);
    setAsking(true);
    try {
      const res = await api<{ reply: string; project: Project; changed_ids: string[]; credits: number }>(`/projects/${project.id}/adapt`, { method: "POST", body: { problem: text }, timeout: 120000 });
      setProject(res.project);
      setChangedIds(res.changed_ids || []);
      setChat((c) => [...c, { id: `${Date.now()}h`, role: "homie", text: res.reply || "I've updated your plan." }]);
      if (user) setUser({ ...user, credits: res.credits });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setAskOpen(false), 1000);
    } catch (e: any) {
      const msg = e.message?.toLowerCase().includes("credit") ? "You're out of credits — upgrade to keep going." : "Homie couldn't update the plan right now.";
      setChat((c) => [...c, { id: `${Date.now()}e`, role: "homie", text: msg }]);
    } finally { setAsking(false); }
  };

  const g = project?.guide;

  return (
    <View style={styles.root}>
      {/* header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="workspace-back" hitSlop={10} onPress={() => router.back()}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.title || "Project"}</Text>
          <Text style={styles.headerMeta}>{g ? `${done}/${total} steps · ${progress}%` : "Drafting plan…"}</Text>
        </View>
        <Pressable testID="workspace-fav" hitSlop={10} onPress={toggleFav}>
          <MaterialCommunityIcons name={project?.favorite ? "star" : "star-outline"} size={24} color={project?.favorite ? colors.warning : colors.onSurfaceTertiary} />
        </Pressable>
      </View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>

      {generating ? (
        <View style={styles.center}>
          <AvatarThinking />
        </View>
      ) : loadingIntake ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={styles.genSub}>Getting a few details so your plan is exact…</Text>
        </View>
      ) : intake ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.intakeTitle}>A FEW QUICK DETAILS</Text>
          <Text style={styles.intakeSub}>The more Homie knows, the more your plan matches your exact situation — your specific model, your floor, your space. Skip anything you're unsure of.</Text>
          {remembers && (
            <View style={styles.memBanner} testID="intake-remembers">
              <MaterialCommunityIcons name="brain" size={18} color={colors.brandPrimary} />
              <Text style={styles.memText}>Homie remembers your past work in this space and will factor it in.</Text>
            </View>
          )}
          {intake.map((q) => (
            <View key={q.key} style={styles.intakeCard}>
              <Text style={styles.intakeQ}>{q.question}</Text>
              <TextInput
                testID={`intake-${q.key}`}
                style={styles.intakeInput}
                placeholder={q.placeholder || "Type here…"}
                placeholderTextColor={colors.onSurfaceTertiary}
                value={answers[q.key] || ""}
                onChangeText={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
              />
              {!!q.examples?.length && (
                <View style={styles.exRow}>
                  {q.examples.slice(0, 3).map((ex) => (
                    <Pressable key={ex} style={styles.exChip} onPress={() => setAnswers((a) => ({ ...a, [q.key]: ex }))}>
                      <Text style={styles.exText}>{ex}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ))}
          <Pressable testID="intake-build" style={styles.intakeBuild} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); buildGuide(project!.id, answers); }}>
            <Text style={styles.intakeBuildText}>BUILD MY EXACT PLAN</Text>
            <MaterialCommunityIcons name="arrow-right" size={20} color={colors.onBrandPrimary} />
          </Pressable>
          <Pressable testID="intake-skip" style={styles.intakeSkip} onPress={() => buildGuide(project!.id)}>
            <Text style={styles.intakeSkipText}>Skip — just build it</Text>
          </Pressable>
        </ScrollView>
      ) : !project ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 90, gap: spacing.md }} showsVerticalScrollIndicator={false}>
          {!!g?.overview && (
            <View style={styles.overview}>
              <MaterialCommunityIcons name="robot-happy-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.overviewText}>{g.overview}</Text>
            </View>
          )}
          {!!g?.code_alert && (
            <View style={styles.codeAlert}>
              <MaterialCommunityIcons name="gavel" size={16} color={colors.onWarning} />
              <Text style={styles.codeAlertText}>CODE ALERT: {g.code_alert}</Text>
            </View>
          )}
          {project.missing_supplies?.length > 0 && (
            <Pressable testID="workspace-supplies" style={styles.suppliesBtn} onPress={goSupplies}>
              <MaterialCommunityIcons name="cart-plus" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.suppliesText}>SHOP {project.missing_supplies.length} MISSING SUPPLIES</Text>
            </Pressable>
          )}

          {/* PREP — Smart Supply List (State B drawer) */}
          <Pressable testID="open-supply-drawer" style={styles.calcBanner} onPress={() => setSupplyOpen(true)}>
            <MaterialCommunityIcons name="clipboard-list-outline" size={22} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.calcBannerTitle}>Supply List</Text>
              <Text style={styles.calcBannerSub}>{(g?.tools?.length || 0) + (g?.materials?.length || 0)} items · shop & check off what you own</Text>
            </View>
            <MaterialCommunityIcons name="arrow-right" size={20} color={colors.brandPrimary} />
          </Pressable>
          <SupplyDrawer projectId={id} visible={supplyOpen} onClose={() => setSupplyOpen(false)} />

          {calculatorForProject(project?.title) && (
            <Pressable testID="project-calc-banner" style={styles.calcBanner} onPress={() => setCalcOpen(true)}>
              <MaterialCommunityIcons name="calculator-variant-outline" size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.calcBannerTitle}>Estimate materials for this project</Text>
                <Text style={styles.calcBannerSub}>Get exact quantities before you shop</Text>
              </View>
              <MaterialCommunityIcons name="arrow-right" size={20} color={colors.brandPrimary} />
            </Pressable>
          )}
          <CalculatorSheet calcId={calculatorForProject(project?.title)} visible={calcOpen} onClose={() => setCalcOpen(false)} />

          {projectNeedsCode(project?.title) && (
            <CodeCheckCard projectTitle={project?.title} projectId={id} />
          )}

          {(g?.safety_warnings?.length || 0) > 0 && (
            <Section title="SAFETY FIRST" icon="shield-alert-outline">
              {g!.safety_warnings.map((s, i) => (
                <View key={i} style={styles.listRow}><MaterialCommunityIcons name="alert" size={16} color={colors.warning} /><Text style={styles.listText}>{s}</Text></View>
              ))}
            </Section>
          )}

          {/* STEPS */}
          <Text style={styles.stepsHeading}>STEP-BY-STEP</Text>
          {project.steps.map((s) => (
            <View key={s.id} style={[styles.stepCard, s.done && styles.stepCardDone, changedIds.includes(s.id) && styles.stepCardChanged]} testID={`step-card-${s.index}`}>
              <View style={styles.stepTop}>
                <View style={[styles.stepNum, s.done && { backgroundColor: colors.success }]}>
                  <Text style={styles.stepNumText}>{s.index}</Text>
                </View>
                <Text style={styles.stepTitle}>{s.title}</Text>
                {changedIds.includes(s.id) && <Text style={styles.updatedBadge}>UPDATED</Text>}
                <Pressable testID={`step-done-${s.index}`} hitSlop={8} onPress={() => toggleDone(s)}>
                  <MaterialCommunityIcons name={s.done ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={26} color={s.done ? colors.success : colors.onSurfaceTertiary} />
                </Pressable>
              </View>
              <Text style={styles.stepInstruction}>{s.instruction}</Text>
              {s.image_base64 ? (
                <Image source={{ uri: `data:image/png;base64,${s.image_base64}` }} style={styles.stepImage} contentFit="cover" transition={250} />
              ) : (
                <Pressable testID={`step-illustrate-${s.index}`} style={styles.illBtn} onPress={() => illustrate(s)} disabled={imgLoading === s.id}>
                  {imgLoading === s.id ? <ActivityIndicator color={colors.brandPrimary} /> : (
                    <>
                      <MaterialCommunityIcons name="image-plus" size={16} color={colors.brandPrimary} />
                      <Text style={styles.illText}>Show me this step</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          ))}

          {(g?.common_mistakes?.length || 0) > 0 && (
            <Section title="COMMON MISTAKES" icon="alert-octagon-outline">
              {g!.common_mistakes.map((m, i) => (<View key={i} style={styles.listRow}><Text style={styles.bullet}>•</Text><Text style={styles.listText}>{m}</Text></View>))}
            </Section>
          )}
          {(g?.troubleshooting?.length || 0) > 0 && (
            <Section title="TROUBLESHOOTING" icon="wrench-clock">
              {g!.troubleshooting.map((m, i) => (<View key={i} style={styles.listRow}><Text style={styles.bullet}>•</Text><Text style={styles.listText}>{m}</Text></View>))}
            </Section>
          )}
          {(g?.inspection_checklist?.length || 0) > 0 && (
            <Section title="FINAL INSPECTION" icon="clipboard-check-outline">
              {g!.inspection_checklist.map((m, i) => (<View key={i} style={styles.listRow}><MaterialCommunityIcons name="check" size={16} color={colors.success} /><Text style={styles.listText}>{m}</Text></View>))}
            </Section>
          )}

          {/* Contextual "above-DIY" pro suggestion (Sheet #18) */}
          {proSug?.suggest && project?.status !== "completed" && (
            <Pressable testID="project-get-pro" style={styles.proBanner} onPress={() => router.push(`/pros?trade=${encodeURIComponent(proSug.suggested_trade)}&projectId=${id}`)}>
              <MaterialCommunityIcons name="account-hard-hat" size={22} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.proTitle}>{proSug.reason}</Text>
                <Text style={styles.proSub}>Browse vetted {proSug.suggested_trade} pros — we'll pre-fill your project.</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          )}

          {/* Finish & log — Homeowner Journey (Sheet #7/#11) */}
          {g && (
            project.status === "completed" ? (
              <Pressable testID="project-view-journey" style={styles.doneBanner} onPress={() => router.push("/journey")}>
                <MaterialCommunityIcons name="trophy" size={22} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.doneTitle}>Project complete 🎉</Text>
                  <Text style={styles.doneSub}>It's in your Homeowner Timeline. Tap to view your journey.</Text>
                </View>
                <MaterialCommunityIcons name="arrow-right" size={20} color={colors.success} />
              </Pressable>
            ) : (
              <Pressable testID="project-finish" style={styles.finishBanner} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setCompleteOpen(true); }}>
                <MaterialCommunityIcons name="flag-checkered" size={22} color={colors.onBrandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.finishTitle}>{progress === 100 ? "All steps done — finish it!" : "Finish & log this project"}</Text>
                  <Text style={styles.finishSub}>Get your story, savings & achievements.</Text>
                </View>
              </Pressable>
            )
          )}
        </ScrollView>
      )}

      {project && (
        <CompletionModal
          visible={completeOpen}
          projectId={project.id}
          projectTitle={project.title}
          onClose={() => setCompleteOpen(false)}
          onDone={() => { setCompleteOpen(false); router.push("/journey"); }}
        />
      )}


      {/* Ask Homie FAB */}
      {!generating && project && (
        <Pressable testID="workspace-ask-fab" style={[styles.fab, { bottom: insets.bottom + spacing.md }]} onPress={() => setAskOpen(true)}>
          <MaterialCommunityIcons name="chat-question" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.fabText}>ASK HOMIE</Text>
        </Pressable>
      )}

      {/* Ask sheet */}
      <Modal visible={askOpen} transparent animationType="slide" onRequestClose={() => setAskOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>ASK HOMIE</Text>
              <Pressable testID="ask-mode-toggle" onPress={() => { Haptics.selectionAsync(); setMode((m) => m === "text" ? "voice" : "text"); }} style={[styles.modePill, mode === "voice" ? styles.modeVoice : styles.modeText]}>
                <MaterialCommunityIcons name={mode === "voice" ? "microphone" : "keyboard-outline"} size={13} color={mode === "voice" ? colors.onBrandPrimary : colors.onEcoMode} />
                <Text style={[styles.modePillText, { color: mode === "voice" ? colors.onBrandPrimary : colors.onEcoMode }]}>{mode === "voice" ? "VOICE 2x" : "TEXT"} · {user?.credits ?? 0}cr</Text>
              </Pressable>
            </View>
            <ScrollView ref={askRef} style={{ maxHeight: 300 }} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.sm }} showsVerticalScrollIndicator={false}>
              {chat.length === 0 && <Text style={styles.askHint}>Hit a snag? Ask me anything about “{project?.title}”. If something changed mid-job, tap “Update my plan with this” and I'll rewrite your steps.</Text>}
              {chat.map((m) => (
                <View key={m.id} style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleHomie]}>
                  <Text style={[styles.bubbleText, m.role === "user" && { color: colors.onBrandPrimary }]}>{m.text}</Text>
                </View>
              ))}
              {asking && <View style={[styles.bubble, styles.bubbleHomie]}><ActivityIndicator size="small" color={colors.brandPrimary} /></View>}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput testID="ask-input" style={styles.composerInput} placeholder="Ask Homie…" placeholderTextColor={colors.onSurfaceTertiary} value={askInput} onChangeText={setAskInput} multiline />
              <Pressable testID="ask-send" style={[styles.sendBtn, (!askInput.trim() || asking) && { opacity: 0.5 }]} onPress={sendAsk} disabled={!askInput.trim() || asking}>
                <MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} />
              </Pressable>
            </View>
            <Pressable testID="ask-adapt" style={[styles.adaptBtn, (!askInput.trim() || asking) && { opacity: 0.5 }]} onPress={sendAdapt} disabled={!askInput.trim() || asking}>
              <MaterialCommunityIcons name="auto-fix" size={16} color={colors.brandPrimary} />
              <Text style={styles.adaptText}>Update my plan with this</Text>
            </Pressable>
            <Pressable style={styles.closeBtn} onPress={() => setAskOpen(false)}><Text style={styles.closeText}>Close</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  headerTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, lineHeight: 26 },
  headerMeta: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  progressTrack: { height: 4, backgroundColor: colors.surfaceTertiary },
  progressFill: { height: 4, backgroundColor: colors.brandPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  genTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, lineHeight: 30, textAlign: "center" },
  genSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center" },
  overview: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  overviewText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, lineHeight: 21 },
  codeAlert: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.warning, borderRadius: radius.sm, padding: spacing.md },
  codeAlertText: { flex: 1, color: colors.onWarning, fontFamily: font.bold, fontSize: type.sm },
  suppliesBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  suppliesText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1, overflow: "hidden" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg },
  sectionTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1 },
  sectionBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  listRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  listText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  needTag: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1 },
  calcBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  calcBannerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  calcBannerSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  bullet: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.lg, width: 14 },
  stepsHeading: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 2, marginTop: spacing.sm },
  finishBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.md },
  finishTitle: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  finishSub: { color: colors.onBrandPrimary, fontFamily: font.regular, fontSize: type.sm, opacity: 0.9, marginTop: 1 },
  doneBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.success, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.md },
  doneTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  doneSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  proBanner: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.warning, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.md },
  proTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  proSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  stepCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, gap: spacing.sm },
  stepCardDone: { borderColor: colors.success, opacity: 0.85 },
  stepTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepNum: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  stepNumText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  stepTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  stepInstruction: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, lineHeight: 23 },
  stepImage: { width: "100%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, marginTop: spacing.xs },
  illBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, paddingVertical: spacing.md, marginTop: spacing.xs },
  illText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  fab: { position: "absolute", right: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, shadowColor: colors.brandPrimary, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 },
  fabText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetHandle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, letterSpacing: 1 },
  modePill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  modeVoice: { backgroundColor: colors.brandPrimary },
  modeText: { backgroundColor: colors.ecoMode },
  modePillText: { fontFamily: font.bold, fontSize: 11 },
  askHint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, paddingVertical: spacing.sm },
  bubble: { maxWidth: "88%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleHomie: { alignSelf: "flex-start", backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  composerInput: { flex: 1, maxHeight: 90, minHeight: 44, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  sendBtn: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  closeBtn: { alignItems: "center", paddingVertical: spacing.md },
  closeText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  intakeTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 30, letterSpacing: 1 },
  intakeSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginBottom: spacing.sm },
  memBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md },
  memText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  intakeCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, gap: spacing.sm },
  intakeQ: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  intakeInput: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  exRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  exChip: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  exText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  intakeBuild: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.sm },
  intakeBuildText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  intakeSkip: { alignItems: "center", paddingVertical: spacing.md },
  intakeSkipText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  stepCardChanged: { borderColor: colors.brandPrimary, borderWidth: 2 },
  updatedBadge: { color: colors.onBrandPrimary, backgroundColor: colors.brandPrimary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  adaptBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.surface, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.sm },
  adaptText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
});
