import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { HomieFace } from "@/src/components/HomieFace";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, ApiError } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { pickFromLibrary, takePhoto } from "@/src/utils/pickImage";
import { showLimitReached } from "@/src/utils/paywall";

type Action = { type: string; label: string; payload: any; approved: boolean; created_id?: string | null };
type Msg = { id: string; role: "user" | "assistant"; text: string; suggested_actions?: Action[]; emergency?: boolean; photo_identification?: any };
type Options = { rooms: any[]; assets: any[]; projects: any[]; documents: any[] };

const ACTION_ICON: Record<string, any> = { create_asset: "cube-outline", create_maintenance_task: "calendar-check-outline", start_project: "hammer-wrench" };
const ACTION_DONE: Record<string, string> = { create_asset: "Asset added", create_maintenance_task: "Task scheduled", start_project: "Project created" };

export default function ChatThread() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const [conv, setConv] = useState<any>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showCtx, setShowCtx] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [sel, setSel] = useState<{ room_ids: string[]; asset_ids: string[]; project_ids: string[]; document_ids: string[] }>({ room_ids: [], asset_ids: [], project_ids: [], document_ids: [] });

  const load = useCallback(async () => {
    try {
      const d = await api<{ conversation: any; messages: Msg[]; context_labels: Record<string, string> }>(`/hi/chat/conversations/${id}`);
      setConv(d.conversation); setMsgs(d.messages); setLabels(d.context_labels);
      const c = d.conversation.context || {};
      setSel({ room_ids: c.room_ids || [], asset_ids: c.asset_ids || [], project_ids: c.project_ids || [], document_ids: c.document_ids || [] });
    } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openCtx = async () => {
    setShowCtx(true);
    if (!options) { try { setOptions(await api<Options>("/hi/chat/context-options")); } catch {} }
  };
  const toggle = (bucket: keyof typeof sel, itemId: string) => {
    setSel((s) => ({ ...s, [bucket]: s[bucket].includes(itemId) ? s[bucket].filter((x) => x !== itemId) : [...s[bucket], itemId] }));
  };
  const saveCtx = async () => {
    try { await api(`/hi/chat/conversations/${id}`, { method: "PUT", body: sel }); setShowCtx(false); load(); } catch {}
  };

  const attach = () => {
    Alert.alert("Attach a photo", "Let Homie see what you're working with", [
      { text: "Camera", onPress: async () => { const b = await takePhoto("Snap the item or issue."); if (b) setPendingPhoto(b); } },
      { text: "Library", onPress: async () => { const b = await pickFromLibrary("Choose a photo."); if (b) setPendingPhoto(b); } },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text && !pendingPhoto) return;
    setSending(true);
    const optimistic: Msg = { id: `tmp-${Date.now()}`, role: "user", text: text || "📷 Photo" };
    setMsgs((m) => [...m, optimistic]);
    setInput(""); const photo = pendingPhoto; setPendingPhoto(null);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      await api(`/hi/chat/conversations/${id}/message`, { method: "POST", body: { text, image_base64: photo || undefined } });
      await load();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) {
        setMsgs((m) => m.filter((x) => x.id !== optimistic.id));
        showLimitReached(router, "Daily chat limit reached", e.message);
      } else { Alert.alert("Couldn't send", e?.message || "Try again."); load(); }
    }
    finally { setSending(false); }
  };

  const approve = async (messageId: string, actionIndex: number) => {
    try {
      const res = await api<{ kind: string; created_id: string }>(`/hi/chat/conversations/${id}/approve`, { method: "POST", body: { message_id: messageId, action_index: actionIndex } });
      await load();
      if (res.kind === "start_project" && res.created_id) {
        Alert.alert("Project created", "Open it to build the full plan?", [
          { text: "Later", style: "cancel" },
          { text: "Open", onPress: () => router.push(`/home-intel/projects/${res.created_id}`) },
        ]);
      }
    } catch (e: any) { Alert.alert("Couldn't add", e?.message || "Try again."); }
  };

  const ctxCount = sel.room_ids.length + sel.asset_ids.length + sel.project_ids.length + sel.document_ids.length;

  return (
    <View style={styles.root}>
      <ScreenHeader title={conv?.title || "Ask Homie"} />
      <Pressable testID="chat-context-btn" style={styles.ctxBar} onPress={openCtx}>
        <MaterialCommunityIcons name="tune-variant" size={16} color={colors.brandPrimary} />
        <Text style={styles.ctxText} numberOfLines={1}>
          {ctxCount === 0 ? "Add home context (rooms, assets, projects, docs)" :
            [...sel.room_ids, ...sel.asset_ids, ...sel.project_ids, ...sel.document_ids].map((k) => labels[k]).filter(Boolean).join(", ")}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
      </Pressable>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
          {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
            msgs.length === 0 ? (
              <View style={styles.hello}>
                <HomieFace size={56} pose="talking" />
                <Text style={styles.helloText}>Ask me anything about your home — a repair, a plan, a product, or what to maintain next.</Text>
              </View>
            ) : msgs.map((m) => (
              <View key={m.id} style={[styles.bubbleWrap, m.role === "user" ? styles.userWrap : styles.aiWrap]}>
                <View style={[styles.bubble, m.role === "user" ? styles.userBubble : m.emergency ? styles.emergencyBubble : styles.aiBubble]}>
                  <Text style={[styles.bubbleText, m.role === "user" && { color: colors.onBrandPrimary }]}>{m.text}</Text>
                </View>
                {m.role === "assistant" && (m.suggested_actions || []).map((a, i) => (
                  <Pressable key={i} testID={`chat-action-${m.id}-${i}`} disabled={a.approved} style={[styles.action, a.approved && styles.actionDone]} onPress={() => approve(m.id, i)}>
                    <MaterialCommunityIcons name={a.approved ? "check-circle" : ACTION_ICON[a.type] || "plus-circle-outline"} size={18} color={a.approved ? colors.success : colors.brandPrimary} />
                    <Text style={[styles.actionText, a.approved && { color: colors.success }]}>{a.approved ? (ACTION_DONE[a.type] || "Added") : a.label}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
          {sending && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.sm }} />}
        </ScrollView>

        {pendingPhoto && (
          <View style={styles.photoPreview}>
            <Image source={{ uri: `data:image/jpeg;base64,${pendingPhoto}` }} style={styles.thumb} contentFit="cover" />
            <Text style={styles.photoText}>Photo attached</Text>
            <Pressable onPress={() => setPendingPhoto(null)}><MaterialCommunityIcons name="close-circle" size={20} color={colors.onSurfaceTertiary} /></Pressable>
          </View>
        )}
        <View style={styles.inputBar}>
          <Pressable testID="chat-attach" style={styles.iconBtn} onPress={attach}><MaterialCommunityIcons name="camera-outline" size={22} color={colors.brandPrimary} /></Pressable>
          <TextInput testID="chat-input" style={styles.input} value={input} onChangeText={setInput} multiline placeholder="Message Homie…" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="chat-send" style={[styles.sendBtn, (sending || (!input.trim() && !pendingPhoto)) && { opacity: 0.5 }]} disabled={sending || (!input.trim() && !pendingPhoto)} onPress={send}>
            <MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={showCtx} transparent animationType="slide" onRequestClose={() => setShowCtx(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>What should Homie know?</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {!options ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} /> : (
                <>
                  <CtxGroup title="Rooms" items={options.rooms.map((x) => ({ id: x.id, label: x.name }))} bucket="room_ids" sel={sel} toggle={toggle} />
                  <CtxGroup title="Assets" items={options.assets.map((x) => ({ id: x.id, label: x.name }))} bucket="asset_ids" sel={sel} toggle={toggle} />
                  <CtxGroup title="Projects" items={options.projects.map((x) => ({ id: x.id, label: x.title }))} bucket="project_ids" sel={sel} toggle={toggle} />
                  <CtxGroup title="Documents" items={options.documents.map((x) => ({ id: x.id, label: x.title }))} bucket="document_ids" sel={sel} toggle={toggle} />
                </>
              )}
            </ScrollView>
            <Pressable testID="chat-context-save" style={styles.saveBtn} onPress={saveCtx}><Text style={styles.saveText}>Use this context</Text></Pressable>
            <Pressable style={styles.cancel} onPress={() => setShowCtx(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CtxGroup({ title, items, bucket, sel, toggle }: { title: string; items: { id: string; label: string }[]; bucket: any; sel: any; toggle: (b: any, id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chips}>
        {items.map((it) => {
          const on = sel[bucket].includes(it.id);
          return (
            <Pressable key={it.id} testID={`ctx-${bucket}-${it.id}`} style={[styles.chip, on && styles.chipOn]} onPress={() => toggle(bucket, it.id)}>
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{it.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  ctxBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border, borderBottomWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  ctxText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  hello: { alignItems: "center", marginTop: spacing["2xl"], gap: spacing.md, paddingHorizontal: spacing.lg },
  helloText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", lineHeight: 22 },
  bubbleWrap: { marginBottom: spacing.md, maxWidth: "88%" },
  userWrap: { alignSelf: "flex-end", alignItems: "flex-end" },
  aiWrap: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  userBubble: { backgroundColor: colors.brandPrimary, borderTopRightRadius: 4 },
  aiBubble: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderTopLeftRadius: 4 },
  emergencyBubble: { backgroundColor: colors.error + "22", borderColor: colors.error, borderWidth: 1 },
  bubbleText: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 21 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.sm },
  actionDone: { borderColor: colors.success, backgroundColor: colors.success + "18" },
  actionText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  photoPreview: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1 },
  thumb: { width: 36, height: 36, borderRadius: radius.sm },
  photoText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, backgroundColor: colors.surface },
  iconBtn: { padding: spacing.sm },
  input: { flex: 1, maxHeight: 120, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: "#000000AA" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing["2xl"] },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl, marginBottom: spacing.md },
  groupTitle: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginBottom: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, maxWidth: 200 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.md },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  cancel: { alignItems: "center", paddingVertical: spacing.md },
  cancelText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
