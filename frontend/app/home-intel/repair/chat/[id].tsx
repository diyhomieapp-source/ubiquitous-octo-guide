import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState } from "@/src/components/ui";

export default function RepairChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try { setMessages((await api<any>(`/hi/repair/issues/${id}/messages`)).messages || []); } catch {} finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText("");
    const optimistic = { id: `tmp-${Date.now()}`, role: "user", text: t };
    setMessages((m) => [...m, optimistic]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const res = await api<any>(`/hi/repair/issues/${id}/chat`, { method: "POST", body: { text: t } });
      setMessages((m) => [...m, res.assistant]);
    } catch {
      setMessages((m) => [...m, { id: `err-${Date.now()}`, role: "assistant", text: "I couldn't respond just now — please try again." }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="rc-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back">
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Ask Homie</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
        {loading ? <LoadingState /> : (
          <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {messages.length === 0 ? (
              <Text style={styles.empty}>{"Ask about this repair — what to check, whether a step is safe, or what a photo shows. I'll be straight with you."}</Text>
            ) : null}
            {messages.map((m) => (
              <View key={m.id} testID={`rc-msg-${m.role}`} style={[styles.bubble, m.role === "user" ? styles.user : styles.assistant, m.emergency && styles.emergency]}>
                <Text style={[styles.msgText, m.role === "user" && styles.userText]}>{m.text}</Text>
                {m.suggested_next_action ? <Text style={styles.next}>Next: {m.suggested_next_action}</Text> : null}
              </View>
            ))}
            {sending ? <View style={[styles.bubble, styles.assistant]}><ActivityIndicator size="small" color={colors.brandPrimary} /></View> : null}
          </ScrollView>
        )}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <TextInput testID="rc-input" value={text} onChangeText={setText} placeholder="Type a question…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} multiline onSubmitEditing={send} />
          <Pressable testID="rc-send" onPress={send} style={styles.send} disabled={sending}>
            <MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, textAlign: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  bubble: { maxWidth: "88%", borderRadius: radius.lg, padding: spacing.md },
  user: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary },
  assistant: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  emergency: { borderColor: colors.error, borderWidth: 1, backgroundColor: colors.error + "14" },
  msgText: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  userText: { color: colors.onBrandPrimary, fontFamily: font.medium },
  next: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 12, marginTop: spacing.xs },
  inputBar: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end", padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxHeight: 120, minHeight: 44 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
});
