import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, EmptyState } from "@/src/components/ui";

const PRIO_COLOR: Record<string, string> = { critical: "#FF3D00", high: "#FF6A00", normal: "#29B6F6", low: "#A0A0A5" };
const STATUS_COLOR: Record<string, string> = { open: "#FF6A00", in_progress: "#29B6F6", waiting_user: "#FFC400", resolved: "#00E676", closed: "#A0A0A5" };

export default function HelpCenter() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"help" | "tickets">("help");
  const [cats, setCats] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [assist, setAssist] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState("");
  const [showTicketForm, setShowTicketForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([api<any>("/hi/help/categories"), api<any>("/hi/help/tickets")]);
      setCats(c.categories || []); setTickets(t.tickets || []);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const runAssist = async (cat?: string) => {
    if (!message.trim()) { Alert.alert("Tell us more", "Describe your issue so we can help."); return; }
    setBusy(true);
    try {
      const res = await api<any>("/hi/help/assist", { method: "POST", body: { message: message.trim(), category: cat || category } });
      setAssist(res); setCategory(res.category);
    } catch (e: any) { Alert.alert("Couldn't load help", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const createTicket = async () => {
    if (!subject.trim()) { Alert.alert("Add a subject", "A short subject helps us route your ticket."); return; }
    setBusy(true);
    try {
      await api("/hi/help/tickets", { method: "POST", body: { subject: subject.trim(), description: message.trim(), category: category || "other" } });
      setSubject(""); setMessage(""); setAssist(null); setShowTicketForm(false); setTab("tickets"); await load();
      Alert.alert("Ticket created", "A person from our team will follow up in your Support inbox.");
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="help-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back" accessibilityRole="button">
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Support</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabs}>{(["help", "tickets"] as const).map((t) => (
        <Pressable key={t} testID={`help-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
          <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === "help" ? "Get help" : "My tickets"}</Text>
        </Pressable>
      ))}</View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        {tab === "help" && (
          <>
            <Text style={styles.label}>What do you need help with?</Text>
            <View style={styles.catGrid}>
              {cats.map((c) => (
                <Pressable key={c.key} testID={`help-cat-${c.key}`} style={[styles.catChip, category === c.key && styles.catChipOn]} onPress={() => { setCategory(c.key); }}>
                  <Text style={[styles.catText, category === c.key && { color: colors.brandPrimary }]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput testID="help-message" value={message} onChangeText={setMessage} placeholder="Describe your issue in a sentence or two…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.textarea} multiline />
            <Button testID="help-ask" label="Get quick help" icon="lightning-bolt" loading={busy} onPress={() => runAssist()} />

            {assist ? (
              <View style={styles.assistCard}>
                <View style={styles.assistHead}>
                  <MaterialCommunityIcons name="lifebuoy" size={18} color={colors.brandPrimary} />
                  <Text style={styles.assistTitle}>{assist.category_label}</Text>
                  <View style={[styles.prio, { borderColor: PRIO_COLOR[assist.priority] }]}><Text style={[styles.prioText, { color: PRIO_COLOR[assist.priority] }]}>{assist.priority}</Text></View>
                </View>
                {assist.known_incident ? <Text style={styles.incident}>⚠ Known issue: {assist.known_incident.title}. Our team is on it — no need to troubleshoot.</Text> : null}
                <Text style={styles.assistBody}>{assist.answer}</Text>
                {(assist.articles || []).map((a: any) => (
                  <Pressable key={a.id} testID={`help-article-${a.id}`} style={styles.articleRow} onPress={() => Alert.alert(a.title, "Open the full article in the help center.")}>
                    <MaterialCommunityIcons name="file-document-outline" size={16} color={colors.onSurfaceTertiary} />
                    <Text style={styles.articleText}>{a.title}</Text>
                  </Pressable>
                ))}
                {assist.possible_duplicate ? <Text style={styles.dup}>You already have an open ticket about this: “{assist.possible_duplicate.subject}”.</Text> : null}
                <Text style={styles.disclaimer}>{assist.disclaimer}</Text>
                <View style={styles.assistActions}>
                  <Button testID="help-solved" label="That solved it" variant="secondary" icon="check" onPress={() => { setAssist(null); setMessage(""); Alert.alert("Great!", "Glad that helped."); }} style={{ flex: 1 }} />
                  <Button testID="help-still" label="I still need help" onPress={() => { setSubject(message.slice(0, 60)); setShowTicketForm(true); }} style={{ flex: 1 }} />
                </View>
              </View>
            ) : null}

            {showTicketForm ? (
              <View style={styles.assistCard}>
                <Text style={styles.label}>Create a ticket</Text>
                <TextInput testID="help-subject" value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                <Text style={styles.reviewNote}>We'll attach only your app version, screen, and error code — never your documents, photos, or payment details.</Text>
                <Button testID="help-submit-ticket" label="Submit ticket" icon="send" loading={busy} onPress={createTicket} />
              </View>
            ) : null}

            <Pressable testID="help-contact" style={styles.contactRow} onPress={() => { setShowTicketForm(true); if (!subject) setSubject(message.slice(0, 60) || "Support request"); }}>
              <MaterialCommunityIcons name="headset" size={18} color={colors.brandPrimary} />
              <Text style={styles.contactText}>Contact Support directly</Text>
            </Pressable>
          </>
        )}

        {tab === "tickets" && (
          tickets.length === 0 ? (
            <EmptyState icon="ticket-outline" title="No tickets yet" message="When you contact support, your tickets and replies show up here." />
          ) : tickets.map((t) => (
            <Pressable key={t.id} testID={`help-ticket-${t.id}`} style={styles.ticketCard} onPress={() => router.push(`/help/${t.id}` as any)}>
              <View style={styles.labelRow}>
                <Text style={styles.ticketSubject} numberOfLines={1}>{t.subject}</Text>
                <View style={[styles.tag, { borderColor: STATUS_COLOR[t.status] }]}><Text style={[styles.tagText, { color: STATUS_COLOR[t.status] }]}>{t.status.replace("_", " ")}</Text></View>
              </View>
              <Text style={styles.ticketMeta}>{t.category?.replace("_", " ")} · <Text style={{ color: PRIO_COLOR[t.priority] }}>{t.priority}</Text></Text>
            </Pressable>
          ))
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  tabs: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1 },
  tabOn: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.brandPrimary },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  catChip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 40, justifyContent: "center" },
  catChipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "14" },
  catText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  textarea: { minHeight: 90, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, textAlignVertical: "top" },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  assistCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  assistHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  assistTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  prio: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  prioText: { fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  incident: { color: colors.warning, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  assistBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  articleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  articleText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  dup: { color: colors.info, fontFamily: font.medium, fontSize: type.sm },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16 },
  assistActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  reviewNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16 },
  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.md, minHeight: 44 },
  contactText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  ticketCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  ticketSubject: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  ticketMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  tagText: { fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
});
