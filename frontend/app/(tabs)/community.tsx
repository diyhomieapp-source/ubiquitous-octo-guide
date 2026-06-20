import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal,
  TextInput, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

type Reply = { id: string; author: string; body: string; verified: boolean; user_id: string };
type Post = { id: string; author: string; title: string; body: string; replies: Reply[]; solved: boolean; user_id: string };

export default function Community() {
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [active, setActive] = useState<Post | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<Post[]>("/community/posts");
      setPosts(res);
    } catch {} finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const createPost = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api("/community/posts", { method: "POST", body: { title: title.trim(), body: body.trim() } });
      setTitle(""); setBody(""); setComposeOpen(false);
      await load();
    } finally { setBusy(false); }
  };

  const sendReply = async () => {
    if (!active || !reply.trim()) return;
    setBusy(true);
    try {
      await api(`/community/posts/${active.id}/reply`, { method: "POST", body: { body: reply.trim() } });
      setReply("");
      const res = await api<Post[]>("/community/posts");
      setPosts(res);
      setActive(res.find((p) => p.id === active.id) || null);
    } finally { setBusy(false); }
  };

  const verify = async (replyId: string) => {
    if (!active) return;
    setBusy(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await api(`/community/posts/${active.id}/verify/${replyId}`, { method: "POST" });
      const res = await api<Post[]>("/community/posts");
      setPosts(res);
      setActive(res.find((p) => p.id === active.id) || null);
      await refresh();
    } finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>PRO-EARN</Text>
          <Text style={styles.sub}>Solve problems. Earn free credits.</Text>
        </View>
        <View style={styles.rewardPill}>
          <MaterialCommunityIcons name="lightning-bolt" size={14} color={colors.onBrandPrimary} />
          <Text style={styles.rewardText}>+10 cr / solution</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : posts.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="account-group-outline" size={56} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>NO POSTS YET</Text>
          <Text style={styles.emptySub}>Be the first to ask the community for a second pair of eyes.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ gap: spacing.md, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}
        >
          {posts.map((p) => (
            <Pressable key={p.id} testID={`post-${p.id}`} style={styles.postCard} onPress={() => setActive(p)}>
              <View style={styles.postTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{p.author.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.author}>{p.author}</Text>
                {p.solved && (
                  <View style={styles.solvedTag}>
                    <MaterialCommunityIcons name="check-decagram" size={14} color={colors.success} />
                    <Text style={styles.solvedText}>SOLVED</Text>
                  </View>
                )}
              </View>
              <Text style={styles.postTitle}>{p.title}</Text>
              <Text style={styles.postBody} numberOfLines={2}>{p.body}</Text>
              <View style={styles.postMeta}>
                <MaterialCommunityIcons name="message-reply-text-outline" size={15} color={colors.onSurfaceTertiary} />
                <Text style={styles.postMetaText}>{p.replies.length} repl{p.replies.length === 1 ? "y" : "ies"}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Pressable testID="community-new-post-fab" style={[styles.fab, { bottom: spacing.lg }]} onPress={() => setComposeOpen(true)}>
        <MaterialCommunityIcons name="pencil-plus" size={24} color={colors.onBrandPrimary} />
      </Pressable>

      {/* compose modal */}
      <Modal visible={composeOpen} transparent animationType="slide" onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>ASK THE COMMUNITY</Text>
            <TextInput testID="post-title-input" style={styles.input} placeholder="Title (e.g. Is this tile straight?)" placeholderTextColor={colors.onSurfaceTertiary} value={title} onChangeText={setTitle} />
            <TextInput testID="post-body-input" style={[styles.input, { height: 100, textAlignVertical: "top" }]} placeholder="Describe your problem…" placeholderTextColor={colors.onSurfaceTertiary} value={body} onChangeText={setBody} multiline />
            <Pressable testID="post-submit" style={styles.primaryBtn} onPress={createPost} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>POST</Text>}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setComposeOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* detail modal */}
      <Modal visible={!!active} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.detailSheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHandle} />
            {active && (
              <>
                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 360 }}>
                  <Text style={styles.detailTitle}>{active.title}</Text>
                  <Text style={styles.detailAuthor}>by {active.author}</Text>
                  <Text style={styles.detailBody}>{active.body}</Text>
                  <Text style={styles.repliesLabel}>SOLUTIONS</Text>
                  {active.replies.length === 0 && <Text style={styles.noReplies}>No solutions yet — be the helpful one.</Text>}
                  {active.replies.map((r) => (
                    <View key={r.id} style={[styles.replyCard, r.verified && styles.replyVerified]}>
                      <View style={styles.replyHead}>
                        <Text style={styles.replyAuthor}>{r.author}</Text>
                        {r.verified && <View style={styles.verifiedTag}><MaterialCommunityIcons name="check-decagram" size={13} color={colors.success} /><Text style={styles.verifiedText}>VERIFIED</Text></View>}
                      </View>
                      <Text style={styles.replyBody}>{r.body}</Text>
                      {!active.solved && active.user_id === user?.id && (
                        <Pressable testID={`verify-${r.id}`} style={styles.verifyBtn} onPress={() => verify(r.id)} disabled={busy}>
                          <Text style={styles.verifyText}>MARK AS VERIFIED SOLUTION (+10 cr)</Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </ScrollView>
                <View style={styles.replyComposer}>
                  <TextInput testID="reply-input" style={styles.replyInput} placeholder="Write a solution…" placeholderTextColor={colors.onSurfaceTertiary} value={reply} onChangeText={setReply} />
                  <Pressable testID="reply-send" style={styles.replySend} onPress={sendReply} disabled={busy || !reply.trim()}>
                    <MaterialCommunityIcons name="send" size={18} color={colors.onBrandPrimary} />
                  </Pressable>
                </View>
                <Pressable style={styles.cancelBtn} onPress={() => setActive(null)}><Text style={styles.cancelText}>Close</Text></Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: spacing.lg },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 36, lineHeight: 38 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: 2 },
  rewardPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  rewardText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 1 },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center" },
  postCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  postTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  avatar: { width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },
  author: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  solvedTag: { flexDirection: "row", alignItems: "center", gap: 3 },
  solvedText: { color: colors.success, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  postTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: 2 },
  postBody: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 19 },
  postMeta: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.md },
  postMetaText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", shadowColor: colors.brandPrimary, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  detailSheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetHandle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.lg },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, letterSpacing: 1, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  cancelBtn: { alignItems: "center", paddingVertical: spacing.md },
  cancelText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  detailTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  detailAuthor: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  detailBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21, marginVertical: spacing.md },
  repliesLabel: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1, marginBottom: spacing.sm },
  noReplies: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  replyCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderColor: colors.border, borderWidth: 1 },
  replyVerified: { borderColor: colors.success },
  replyHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
  replyAuthor: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  verifiedTag: { flexDirection: "row", alignItems: "center", gap: 3 },
  verifiedText: { color: colors.success, fontFamily: font.bold, fontSize: 10 },
  replyBody: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  verifyBtn: { backgroundColor: colors.brandTertiary, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: "center", marginTop: spacing.sm },
  verifyText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },
  replyComposer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  replyInput: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  replySend: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
});
