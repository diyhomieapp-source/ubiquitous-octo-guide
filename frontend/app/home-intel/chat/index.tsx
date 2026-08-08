import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { track } from "@/src/utils/analytics";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { UpgradeNudge } from "@/src/components/UpgradeNudge";

type Conv = { id: string; title: string; last_preview?: string | null; message_count: number; updated_at: string };

export default function ChatList() {
  const router = useRouter();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api<{ conversations: Conv[] }>("/hi/chat/conversations"); setConvs(d.conversations); } catch {} finally { setLoading(false); }
    track("homie_opened", { source: "chat_list" });
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const newChat = async () => {
    setCreating(true);
    try { const c = await api<{ id: string }>("/hi/chat/conversations", { method: "POST", body: { title: "New chat" } }); router.push(`/home-intel/chat/${c.id}`); }
    catch (e: any) { Alert.alert("Couldn't start", e?.message || "Try again."); }
    finally { setCreating(false); }
  };

  const remove = (id: string) => {
    Alert.alert("Delete chat?", "This removes the whole conversation.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/hi/chat/conversations/${id}`, { method: "DELETE" }); setConvs((c) => c.filter((x) => x.id !== id)); } catch {} } },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Ask Homie" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <UpgradeNudge feature="chat" />
        <Pressable testID="chat-new" style={[styles.newBtn, creating && { opacity: 0.6 }]} disabled={creating} onPress={newChat}>
          {creating ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <><MaterialCommunityIcons name="message-plus-outline" size={20} color={colors.onBrandPrimary} /><Text style={styles.newText}>New chat</Text></>
          )}
        </Pressable>
        <Text style={styles.intro}>Homie can use your rooms, assets, projects and documents as context. Nothing is saved to your home unless you approve it.</Text>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          convs.length === 0 ? <Text style={styles.empty}>No chats yet. Start one to ask Homie anything about your home.</Text> :
          convs.map((c) => (
            <Pressable key={c.id} testID={`chat-${c.id}`} style={styles.row} onPress={() => router.push(`/home-intel/chat/${c.id}`)} onLongPress={() => remove(c.id)}>
              <MaterialCommunityIcons name="robot-happy-outline" size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{c.title}</Text>
                <Text style={styles.preview} numberOfLines={1}>{c.last_preview || "No messages yet"}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md },
  newText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg },
  intro: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19, marginTop: spacing.md, marginBottom: spacing.md },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  preview: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
});
