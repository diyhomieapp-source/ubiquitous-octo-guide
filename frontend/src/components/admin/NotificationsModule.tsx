import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Campaign = { id: string; title: string; body: string; segment: string; ntype: string; priority: string; recipients: number; read_count: number; read_rate: number; created_at: string };

const SEGMENTS = [
  { key: "all", label: "All users" }, { key: "pro", label: "Pros" }, { key: "paying", label: "Paying" },
];
const TYPES = ["promo", "system", "safety"];

export function NotificationsModule() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [segment, setSegment] = useState("all");
  const [ntype, setNtype] = useState("promo");
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try { setCampaigns(await api<Campaign[]>("/admin/notifications/campaigns")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    if (!title.trim() || !body.trim() || sending) return;
    setSending(true);
    try {
      const r = await api<{ recipients: number }>("/admin/notifications/broadcast", { method: "POST", body: {
        title: title.trim(), body: body.trim(), segment, ntype, priority: urgent ? "urgent" : "normal",
      } });
      Alert.alert("Sent", `Delivered to ${r.recipients} users.`);
      setTitle(""); setBody(""); load();
    } catch (e: any) { Alert.alert("Error", e?.message || "Try again."); }
    finally { setSending(false); }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Broadcast</Text>
      <Text style={styles.sub}>Send an in-app notice to a segment. Urgent messages show a persistent banner.</Text>

      <View style={styles.composer}>
        <TextInput testID="bcast-title" style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.onSurfaceTertiary} />
        <TextInput testID="bcast-body" style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={body} onChangeText={setBody} placeholder="Message" placeholderTextColor={colors.onSurfaceTertiary} multiline />
        <Text style={styles.lbl}>Segment</Text>
        <View style={styles.chipRow}>{SEGMENTS.map((s) => (
          <Pressable key={s.key} testID={`bcast-seg-${s.key}`} style={[styles.chip, segment === s.key && styles.chipOn]} onPress={() => setSegment(s.key)}><Text style={[styles.chipText, segment === s.key && styles.chipTextOn]}>{s.label}</Text></Pressable>
        ))}</View>
        <Text style={styles.lbl}>Type</Text>
        <View style={styles.chipRow}>{TYPES.map((tp) => (
          <Pressable key={tp} testID={`bcast-type-${tp}`} style={[styles.chip, ntype === tp && styles.chipOn]} onPress={() => setNtype(tp)}><Text style={[styles.chipText, ntype === tp && styles.chipTextOn]}>{tp}</Text></Pressable>
        ))}</View>
        <Pressable style={styles.urgentToggle} onPress={() => setUrgent((u) => !u)}>
          <MaterialCommunityIcons name={urgent ? "checkbox-marked" : "checkbox-blank-outline"} size={20} color={urgent ? colors.error : colors.onSurfaceTertiary} />
          <Text style={styles.urgentLabel}>Mark urgent (overrides preferences)</Text>
        </Pressable>
        <Pressable testID="bcast-send" style={[styles.sendBtn, (!title.trim() || !body.trim() || sending) && { opacity: 0.5 }]} onPress={send} disabled={!title.trim() || !body.trim() || sending}>
          {sending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.sendText}>SEND BROADCAST</Text>}
        </Pressable>
      </View>

      <Text style={styles.h1}>Campaigns</Text>
      {loading ? <ActivityIndicator color={colors.brandPrimary} /> : campaigns.length === 0 ? (
        <Text style={styles.sub}>No campaigns sent yet.</Text>
      ) : campaigns.map((c) => (
        <View key={c.id} style={styles.card}>
          <Text style={styles.cTitle}>{c.title}</Text>
          <Text style={styles.cBody} numberOfLines={2}>{c.body}</Text>
          <View style={styles.cStats}>
            <Text style={styles.cStat}>{c.segment} · {c.ntype}</Text>
            <Text style={styles.cStat}>{c.recipients} sent</Text>
            <Text style={[styles.cStat, { color: colors.success }]}>{c.read_rate}% read</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, marginTop: spacing.md },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  composer: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg, gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  lbl: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, marginTop: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12, textTransform: "capitalize" },
  chipTextOn: { color: colors.onBrandPrimary },
  urgentToggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 },
  urgentLabel: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  sendBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  sendText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  cStats: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  cStat: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
});
