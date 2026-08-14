import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, EmptyState } from "@/src/components/ui";

const HEALTH: Record<string, string> = { green: "#00E676", yellow: "#FFC400", orange: "#FF6A00", red: "#FF3D00" };

export default function OrchestratorHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setProjects((await api<any>("/hi/orchestrator/projects")).projects || []); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!intent.trim()) { Alert.alert("Tell Homie what you want to do", "e.g. 'Epoxy my garage floor and add storage'"); return; }
    setBusy(true);
    try {
      const res = await api<any>("/hi/orchestrator/projects", { method: "POST", body: { intent_text: intent.trim() } });
      setIntent("");
      router.push(`/home-intel/orchestrator/${res.project.id}` as any);
    } catch (e: any) { Alert.alert("Couldn't start project", e?.message || "Try again."); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="orch-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Projects</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        <View style={styles.createCard}>
          <View style={styles.homieRow}>
            <MaterialCommunityIcons name="robot-happy-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.createTitle}>What do you want to accomplish?</Text>
          </View>
          <TextInput testID="orch-intent" value={intent} onChangeText={setIntent} placeholder="e.g. Epoxy my garage floor and add built-in storage" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} multiline />
          <Button testID="orch-create" label="Start a project" icon="rocket-launch-outline" loading={busy} onPress={create} />
        </View>

        {loading ? <LoadingState /> : projects.length === 0 ? (
          <EmptyState icon="clipboard-list-outline" title="No active projects" message="Tell Homie what you want to do and it will build a plan, track every step, and tell you what's next." />
        ) : (
          <>
            <Text style={styles.sectionTitle}>Active projects</Text>
            {projects.map((p) => (
              <Pressable key={p.id} testID={`orch-project-${p.id}`} style={styles.card} onPress={() => router.push(`/home-intel/orchestrator/${p.id}` as any)}>
                <View style={styles.cardHead}>
                  <View style={[styles.dot, { backgroundColor: HEALTH[p.health] || colors.onSurfaceTertiary }]} />
                  <Text style={styles.cardTitle} numberOfLines={1}>{p.title}</Text>
                  <View style={styles.statusTag}><Text style={styles.statusText}>{p.status?.replace(/_/g, " ")}</Text></View>
                </View>
                <Text style={styles.cardPhase}>{p.phase?.replace(/_/g, " ")}</Text>
                <View style={styles.nextRow}>
                  <MaterialCommunityIcons name="arrow-right-circle-outline" size={15} color={colors.brandPrimary} />
                  <Text style={styles.nextText} numberOfLines={1}>Next: {p.next_action}</Text>
                </View>
              </Pressable>
            ))}
          </>
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
  createCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  homieRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  createTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  input: { minHeight: 70, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, textAlignVertical: "top" },
  sectionTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  statusTag: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  statusText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, textTransform: "uppercase" },
  cardPhase: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.xs, textTransform: "capitalize" },
  nextRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
  nextText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
});
