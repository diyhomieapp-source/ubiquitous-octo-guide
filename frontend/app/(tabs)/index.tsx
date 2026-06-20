import { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, Modal,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";

type Step = {
  id: string;
  index: number;
  step_title: string;
  text_instruction: string;
  visual_description: string;
  missing_tools: string[];
  code_alert: string | null;
  image_base64: string | null;
  mode: string;
};
type ChatMsg = { id: string; role: "user" | "homie"; text: string };

const STUCK_WORDS = ["i can't", "cant do", "too hard", "flooding", "broken", "give up", "help me", "stuck"];

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useAuth();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [sending, setSending] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);

  const chatRef = useRef<ScrollView>(null);
  const currentStep = steps.length ? steps[steps.length - 1] : null;

  const loadActive = useCallback(async () => {
    try {
      const saved = await storage.getItem<string>("diyhomie_active_project", "");
      if (!saved) return;
      const proj = await api<any>(`/projects/${saved}`);
      setProjectId(proj.id);
      setProjectTitle(proj.title);
      setSteps(proj.steps || []);
      const msgs: ChatMsg[] = [];
      (proj.steps || []).forEach((s: Step) => {
        msgs.push({ id: s.id + "u", role: "user", text: s.user_message || "Next" });
        msgs.push({ id: s.id + "h", role: "homie", text: s.text_instruction });
      });
      setChat(msgs);
    } catch {
      await storage.removeItem("diyhomie_active_project");
    }
  }, []);

  useEffect(() => { loadActive(); }, [loadActive]);

  useEffect(() => {
    setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat]);

  const fetchImage = async (pid: string, stepId: string) => {
    setImageLoading(true);
    try {
      const res = await api<{ image_base64: string }>(`/projects/${pid}/step/${stepId}/image`, { method: "POST", timeout: 120000 });
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, image_base64: res.image_base64 } : s)));
    } catch {
      // leave placeholder
    } finally {
      setImageLoading(false);
    }
  };

  const send = async (rawText: string, isNext = false) => {
    const text = rawText.trim();
    if (!text || sending) return;

    if (!isNext && STUCK_WORDS.some((w) => text.toLowerCase().includes(w))) {
      setHelpVisible(true);
      setInput("");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput("");
    setSending(true);
    const userMsg: ChatMsg = { id: `${Date.now()}u`, role: "user", text };
    setChat((c) => [...c, userMsg]);

    try {
      let pid = projectId;
      if (!pid) {
        const proj = await api<any>("/projects", { method: "POST", body: { title: text, location: user?.location || "" } });
        pid = proj.id;
        setProjectId(proj.id);
        setProjectTitle(proj.title);
        await storage.setItem("diyhomie_active_project", proj.id);
      }
      const res = await api<{ step: Step; credits: number }>(`/projects/${pid}/step`, {
        method: "POST",
        body: { message: text, mode },
        timeout: 90000,
      });
      setSteps((prev) => [...prev, res.step]);
      setChat((c) => [...c, { id: res.step.id + "h", role: "homie", text: res.step.text_instruction }]);
      if (user) setUser({ ...user, credits: res.credits });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchImage(pid!, res.step.id);
    } catch (e: any) {
      if (e.message?.toLowerCase().includes("credit")) {
        setChat((c) => [...c, { id: `${Date.now()}e`, role: "homie", text: "You're out of credits. Tap your balance to upgrade." }]);
        router.push("/paywall");
      } else {
        setChat((c) => [...c, { id: `${Date.now()}e`, role: "homie", text: "Homie hit a snag reaching the knowledge base. Try again." }]);
      }
    } finally {
      setSending(false);
    }
  };

  const newProject = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await storage.removeItem("diyhomie_active_project");
    setProjectId(null);
    setProjectTitle("");
    setSteps([]);
    setChat([]);
  };

  const goSupplies = () => router.push("/(tabs)/supplies");

  const toggleMode = () => {
    Haptics.selectionAsync();
    setMode((m) => (m === "text" ? "voice" : "text"));
  };

  const totalMissing = currentStep?.missing_tools?.length || 0;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* ============ TOP 65% — STEP DRAWER ============ */}
      <View style={[styles.drawer, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.drawerHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brandLabel}>DIYHOMIE</Text>
            <Text style={styles.projectTitle} numberOfLines={1}>
              {projectTitle || "New Project"}
            </Text>
          </View>
          {projectId && (
            <Pressable testID="home-new-project-button" style={styles.newBtn} onPress={newProject}>
              <MaterialCommunityIcons name="plus" size={16} color={colors.onSurface} />
              <Text style={styles.newBtnText}>NEW</Text>
            </Pressable>
          )}
        </View>

        {/* progress tracker */}
        {steps.length > 0 && (
          <View style={styles.progressRow}>
            {steps.map((s, i) => (
              <View key={s.id} style={[styles.progDot, { backgroundColor: i === steps.length - 1 ? colors.brandPrimary : colors.success }]} />
            ))}
            <Text style={styles.progText}>STEP {steps.length}</Text>
          </View>
        )}

        {!currentStep ? (
          <View style={styles.emptyDrawer} testID="home-empty-state">
            <MaterialCommunityIcons name="hard-hat" size={48} color={colors.brandPrimary} />
            <Text style={styles.emptyTitle}>WHAT PROJECT ARE WE{"\n"}TACKLING TODAY, HOMIE?</Text>
            <Text style={styles.emptySub}>Type a repair or project below — like “replace a toilet flapper” — and I’ll guide you one step at a time.</Text>
          </View>
        ) : (
          <View style={styles.stepArea}>
            {/* image */}
            <View style={styles.imageBox}>
              {currentStep.image_base64 ? (
                <Image
                  testID="home-step-image"
                  source={{ uri: `data:image/png;base64,${currentStep.image_base64}` }}
                  style={styles.image}
                  contentFit="cover"
                  transition={300}
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  {imageLoading ? (
                    <>
                      <ActivityIndicator color={colors.brandPrimary} />
                      <Text style={styles.imageHint}>Homie is illustrating this step…</Text>
                    </>
                  ) : (
                    <MaterialCommunityIcons name="image-outline" size={36} color={colors.onSurfaceTertiary} />
                  )}
                </View>
              )}
              {currentStep.code_alert ? (
                <View style={styles.codeAlert}>
                  <MaterialCommunityIcons name="alert" size={16} color={colors.onWarning} />
                  <Text style={styles.codeAlertText} numberOfLines={2}>CODE ALERT: {currentStep.code_alert}</Text>
                </View>
              ) : null}
            </View>

            {/* instruction */}
            <ScrollView style={styles.instructionScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.stepTitle}>{currentStep.step_title}</Text>
              <Text style={styles.instruction} testID="home-step-instruction">{currentStep.text_instruction}</Text>
              {totalMissing > 0 && (
                <Pressable testID="home-missing-supplies-chip" style={styles.suppliesChip} onPress={goSupplies}>
                  <MaterialCommunityIcons name="cart-plus" size={16} color={colors.brandPrimary} />
                  <Text style={styles.suppliesChipText}>{totalMissing} missing suppl{totalMissing === 1 ? "y" : "ies"} — shop now</Text>
                </Pressable>
              )}
            </ScrollView>

            {/* done-next */}
            <Pressable
              testID="home-done-next-button"
              style={[styles.doneBtn, sending && { opacity: 0.6 }]}
              onPress={() => send("Done. What's the next step?", true)}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator color={colors.onSuccess} />
              ) : (
                <>
                  <MaterialCommunityIcons name="check-bold" size={22} color={colors.onSuccess} />
                  <Text style={styles.doneText}>DONE — NEXT STEP</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>

      {/* ============ BOTTOM 35% — LIVE HUB ============ */}
      <View style={styles.hub}>
        {/* floating credit meter */}
        <Pressable
          testID="home-credit-meter"
          onPress={toggleMode}
          style={[
            styles.creditPill,
            mode === "voice" ? styles.pillVoice : styles.pillText,
          ]}
        >
          <MaterialCommunityIcons
            name={mode === "voice" ? "microphone" : "keyboard-outline"}
            size={14}
            color={mode === "voice" ? colors.onBrandPrimary : colors.onEcoMode}
          />
          <Text style={[styles.creditPillText, { color: mode === "voice" ? colors.onBrandPrimary : colors.onEcoMode }]}>
            {mode === "voice" ? "VOICE 2x" : "TEXT ECO"} · {user?.credits ?? 0} cr
          </Text>
        </Pressable>

        <ScrollView
          ref={chatRef}
          style={styles.chatScroll}
          contentContainerStyle={{ paddingTop: spacing.xl, paddingBottom: spacing.sm, gap: spacing.sm }}
          showsVerticalScrollIndicator={false}
        >
          {chat.length === 0 && (
            <View style={styles.homieIntro}>
              <View style={styles.homieAvatar}>
                <MaterialCommunityIcons name="robot-happy-outline" size={20} color={colors.brandPrimary} />
              </View>
              <Text style={styles.homieIntroText}>Hey, I’m Homie 👷 Ask me anything or tell me what we’re building.</Text>
            </View>
          )}
          {chat.map((m) => (
            <View
              key={m.id}
              style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleHomie]}
            >
              <Text style={[styles.bubbleText, m.role === "user" && { color: colors.onBrandPrimary }]}>{m.text}</Text>
            </View>
          ))}
          {sending && (
            <View style={[styles.bubble, styles.bubbleHomie]}>
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            </View>
          )}
        </ScrollView>

        {/* composer */}
        <View style={[styles.composer, { paddingBottom: insets.bottom > 0 ? 0 : spacing.sm }]}>
          <TextInput
            testID="home-input"
            style={styles.composerInput}
            placeholder={projectId ? "Ask Homie or describe a setback…" : "What are we building today?"}
            placeholderTextColor={colors.onSurfaceTertiary}
            value={input}
            onChangeText={setInput}
            multiline
            onSubmitEditing={() => send(input)}
          />
          <Pressable testID="home-mode-toggle" style={styles.micBtn} onPress={toggleMode}>
            <MaterialCommunityIcons
              name={mode === "voice" ? "microphone" : "microphone-outline"}
              size={22}
              color={mode === "voice" ? colors.brandPrimary : colors.onSurfaceTertiary}
            />
          </Pressable>
          <Pressable
            testID="home-send-button"
            style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
            onPress={() => send(input)}
            disabled={!input.trim() || sending}
          >
            <MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>

      {/* Bark.com contingency modal */}
      <Modal visible={helpVisible} transparent animationType="fade" onRequestClose={() => setHelpVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="home-help-modal">
            <View style={styles.modalIcon}>
              <MaterialCommunityIcons name="lifebuoy" size={32} color={colors.brandPrimary} />
            </View>
            <Text style={styles.modalTitle}>NO PRESSURE.</Text>
            <Text style={styles.modalBody}>
              Home improvement can get overwhelming. Want a local, licensed pro to take over from here? We’ll match you with vetted contractors near you.
            </Text>
            <Pressable
              testID="home-help-find-pro"
              style={styles.modalPrimary}
              onPress={() => { setHelpVisible(false); router.push("/(tabs)/supplies"); }}
            >
              <Text style={styles.modalPrimaryText}>FIND A LOCAL PRO</Text>
            </Pressable>
            <Pressable testID="home-help-dismiss" style={styles.modalDismiss} onPress={() => setHelpVisible(false)}>
              <Text style={styles.modalDismissText}>Keep going with Homie</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },

  drawer: { flex: 1.9, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.lg, borderBottomColor: colors.border, borderBottomWidth: 1 },
  drawerHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  brandLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, letterSpacing: 2 },
  projectTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, lineHeight: 28 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  newBtnText: { color: colors.onSurface, fontFamily: font.bold, fontSize: 11, letterSpacing: 1 },

  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.sm },
  progDot: { width: 18, height: 5, borderRadius: radius.pill },
  progText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginLeft: spacing.xs },

  emptyDrawer: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.md },
  emptyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 30, lineHeight: 30, textAlign: "center" },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, textAlign: "center" },

  stepArea: { flex: 1 },
  imageBox: { flex: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceTertiary, marginBottom: spacing.md, minHeight: 120 },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  imageHint: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  codeAlert: { position: "absolute", top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.warning, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  codeAlertText: { flex: 1, color: colors.onWarning, fontFamily: font.bold, fontSize: type.sm },

  instructionScroll: { maxHeight: 130, marginBottom: spacing.sm },
  stepTitle: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1, textTransform: "uppercase" },
  instruction: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, lineHeight: 30, marginTop: spacing.xs },
  suppliesChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, marginTop: spacing.md },
  suppliesChipText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },

  doneBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.success, paddingVertical: spacing.lg, borderRadius: radius.md, marginTop: spacing.sm },
  doneText: { color: colors.onSuccess, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },

  hub: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  creditPill: { position: "absolute", top: -16, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, zIndex: 10 },
  pillVoice: { backgroundColor: colors.brandPrimary, shadowColor: colors.brandPrimary, shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  pillText: { backgroundColor: colors.ecoMode },
  creditPillText: { fontFamily: font.bold, fontSize: 11, letterSpacing: 0.5 },

  chatScroll: { flex: 1 },
  homieIntro: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  homieAvatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  homieIntroText: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  bubble: { maxWidth: "85%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary, borderBottomRightRadius: 4 },
  bubbleHomie: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },

  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingTop: spacing.sm },
  composerInput: { flex: 1, maxHeight: 90, minHeight: 44, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  micBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", paddingHorizontal: spacing.xl },
  modalCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, borderColor: colors.borderStrong, borderWidth: 1, alignItems: "center" },
  modalIcon: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  modalTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 32, letterSpacing: 1 },
  modalBody: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, textAlign: "center", marginVertical: spacing.md },
  modalPrimary: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center", width: "100%" },
  modalPrimaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  modalDismiss: { paddingVertical: spacing.lg },
  modalDismissText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
