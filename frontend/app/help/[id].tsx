import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState } from "@/src/components/ui";

const STATUS_COLOR: Record<string, string> = { open: "#FF6A00", in_progress: "#29B6F6", waiting_user: "#FFC400", resolved: "#00E676", closed: "#A0A0A5" };

export default function TicketDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<any>(`/hi/help/tickets/${id}`)); } catch { setData(null); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try { await api(`/hi/help/tickets/${id}/messages`, { method: "POST", body: { body: reply.trim() } }); setReply(""); await load(); }
    catch (e: any) { Alert.alert("Couldn't send", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const reopen = async () => {
    setBusy(true);
    try { await api(`/hi/help/tickets/${id}/reopen`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Couldn't reopen", e?.message || "Try again."); } finally { setBusy(false); }
  };
  const submitFeedback = async (r: number) => {
    setRating(r); setBusy(true);
    try { await api(`/hi/help/tickets/${id}/feedback`, { method: "POST", body: { rating: r } }); Alert.alert("Thanks", "Your feedback helps us improve support."); }
    catch (e: any) { Alert.alert("Couldn't submit", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={[styles.root, { paddingTop: insets.top }]}><LoadingState /></View>;
  if (!data) return <View style={[styles.root, { paddingTop: insets.top }]}><Text style={styles.err}>Ticket not found.</Text></View>;

  const t = data.ticket;
  const resolved = t.status === "resolved" || t.status === "closed";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="td-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{t.subject}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.sm }}>
        <View style={styles.metaRow}>
          <View style={[styles.tag, { borderColor: STATUS_COLOR[t.status] }]}><Text style={[styles.tagText, { color: STATUS_COLOR[t.status] }]}>{t.status.replace("_", " ")}</Text></View>
          <Text style={styles.metaText}>{t.category?.replace("_", " ")} · {t.priority}</Text>
        </View>

        {(data.messages || []).map((m: any) => (
          <View key={m.id} style={[styles.bubble, m.sender_type === "user" ? styles.userBubble : styles.agentBubble]}>
            <Text style={styles.sender}>{m.sender_type === "user" ? "You" : m.sender_type === "admin" ? "Support" : "System"}</Text>
            <Text style={styles.bubbleBody}>{m.body}</Text>
          </View>
        ))}

        {(data.resolutions || []).map((r: any) => (
          <View key={r.id} style={styles.resolution}>
            <MaterialCommunityIcons name="check-decagram-outline" size={16} color={colors.success} />
            <Text style={styles.resText}>Resolved ({r.resolution_type.replace("_", " ")}): {r.summary}</Text>
          </View>
        ))}

        {resolved ? (
          <View style={styles.fbCard}>
            <Text style={styles.fbTitle}>Was this helpful?</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Pressable key={s} testID={`td-star-${s}`} onPress={() => submitFeedback(s)} hitSlop={6}>
                  <MaterialCommunityIcons name={s <= rating ? "star" : "star-outline"} size={26} color={colors.warning} />
                </Pressable>
              ))}
            </View>
            <Button testID="td-reopen" label="Reopen ticket" variant="secondary" icon="refresh" onPress={reopen} loading={busy} />
          </View>
        ) : null}
      </ScrollView>

      {!resolved ? (
        <View style={[styles.replyBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput testID="td-reply" value={reply} onChangeText={setReply} placeholder="Reply…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.replyInput} />
          <Pressable testID="td-send" disabled={busy} style={styles.sendBtn} onPress={send}><MaterialCommunityIcons name="send" size={20} color="#fff" /></Pressable>
        </View>
      ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  err: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, padding: spacing.lg },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, textTransform: "capitalize" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  tagText: { fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  bubble: { borderRadius: radius.md, padding: spacing.md, maxWidth: "90%" },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary + "44", borderWidth: 1 },
  agentBubble: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  sender: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase", marginBottom: 2 },
  bubbleBody: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  resolution: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.success + "14", borderColor: colors.success + "44", borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  resText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  fbCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, alignItems: "center", marginTop: spacing.md },
  fbTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  stars: { flexDirection: "row", gap: spacing.xs },
  replyBar: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, alignItems: "center" },
  replyInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, height: 44, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
});
