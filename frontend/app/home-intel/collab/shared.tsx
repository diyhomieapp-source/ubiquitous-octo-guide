import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function SharedWithMe() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [shared, setShared] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(params.token || "");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api<any>("/hi/collab/shared-with-me"), api<any>("/hi/collab/my-assignments")]);
      setShared(s.properties); setAssignments(a.assignments);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const accept = async () => {
    if (!token.trim()) { Alert.alert("Code needed", "Paste the invite code you were given."); return; }
    setBusy(true);
    try { const r = await api<any>("/hi/collab/invites/accept", { method: "POST", body: { invite_token: token.trim() } }); setToken(""); await load(); Alert.alert("Joined!", `You now have ${r.role_label} access to ${r.property_name}.`); }
    catch (e: any) { Alert.alert("Couldn't accept", e?.message || "This invitation is no longer active."); }
    finally { setBusy(false); }
  };

  const respond = async (aid: string, status: string) => {
    setBusy(true);
    try { await api(`/hi/collab/assignments/${aid}/respond`, { method: "POST", body: { status } }); await load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Shared with me" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Shared with me" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Accept an invite</Text>
        <View style={styles.row}>
          <TextInput testID="sw-token" style={styles.input} value={token} onChangeText={setToken} autoCapitalize="none" placeholder="Paste invite code" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="sw-accept" style={styles.acceptBtn} disabled={busy} onPress={accept}><Text style={styles.acceptText}>Accept</Text></Pressable>
        </View>

        <Text style={styles.section}>Properties shared with you</Text>
        {shared.length === 0 ? <Text style={styles.empty}>Nothing shared with you yet.</Text> :
          shared.map((p) => (
            <View key={p.property_id} testID={`sw-prop-${p.property_id}`} style={styles.card}>
              <MaterialCommunityIcons name="home-account" size={22} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{p.name}</Text>
                <Text style={styles.cardMeta}>{p.role_label}{p.expires_at ? " · temporary access" : ""}</Text>
              </View>
            </View>
          ))}

        {assignments.length > 0 && (
          <>
            <Text style={styles.section}>Tasks assigned to you</Text>
            {assignments.map((a) => (
              <View key={a.id} style={styles.card}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={20} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{a.task_entity_type.replace(/_/g, " ")}</Text>
                  <Text style={styles.cardMeta}>{a.status}{a.due_date ? ` · due ${a.due_date.slice(0, 10)}` : ""}</Text>
                </View>
                {a.status === "assigned" && (
                  <View style={styles.aBtns}>
                    <Pressable disabled={busy} style={styles.smallBtn} onPress={() => respond(a.id, "accepted")}><Text style={styles.smallBtnText}>Accept</Text></Pressable>
                    <Pressable disabled={busy} style={[styles.smallBtn, { borderColor: colors.error }]} onPress={() => respond(a.id, "declined")}><Text style={[styles.smallBtnText, { color: colors.error }]}>Decline</Text></Pressable>
                  </View>
                )}
                {a.status === "accepted" && (
                  <Pressable disabled={busy} style={styles.smallBtn} onPress={() => respond(a.id, "completed")}><Text style={styles.smallBtnText}>Done</Text></Pressable>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  acceptBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  acceptText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textTransform: "capitalize" },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: 1, textTransform: "capitalize" },
  aBtns: { flexDirection: "row", gap: spacing.xs },
  smallBtn: { borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  smallBtnText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 11 },
});
