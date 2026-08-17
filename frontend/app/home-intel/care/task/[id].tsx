import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, SafetyCard } from "@/src/components/ui";
import { pickFromLibrary } from "@/src/utils/pickImage";

export default function CareTask() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { setTask((await api<any>(`/hi/care/tasks/${id}`)).task); } catch (e: any) { Alert.alert("Couldn't load", e?.message || ""); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !task) return <View style={[styles.root, { paddingTop: insets.top }]}><LoadingState /></View>;

  const finish = async (normal: boolean) => {
    let b64: string | null = null;
    if (!normal) { b64 = await pickFromLibrary("Add a photo of what looks off (optional)."); }
    setBusy(normal ? "normal" : "abnormal");
    try {
      const r = await api<any>(`/hi/care/tasks/${id}/complete`, { method: "POST", body: { normal, base64: b64 || undefined } });
      if (r.converted_issue_id) {
        Alert.alert("Turned into a repair", "I've created a repair project with this finding attached.", [
          { text: "Open it", onPress: () => router.replace(`/home-intel/repair/${r.converted_issue_id}` as any) },
        ]);
      } else {
        Alert.alert("Done", "Logged in your home record.");
        router.back();
      }
    } catch (e: any) { Alert.alert("Couldn't save", e?.message || ""); } finally { setBusy(""); }
  };

  const done = task.status === "completed";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="ct-back" onPress={() => router.back()} style={styles.iconBtn}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Maintenance</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        <Text style={styles.title}>{task.title}</Text>
        <Text style={styles.why}>{task.why_now}</Text>
        {task.safety_boundary ? <SafetyCard level="verify" title="Safety" message={task.safety_boundary} /> : null}

        {task.steps?.map((s: any, i: number) => (
          <View key={s.id} style={styles.step}>
            <Text style={styles.stepTitle}>{i + 1}. {s.title}</Text>
            {s.what_to_do ? <Text style={styles.stepBody}>{s.what_to_do}</Text> : null}
            {s.completion_criteria ? <Text style={styles.stepMeta}>Done when: {s.completion_criteria}</Text> : null}
          </View>
        ))}

        {done ? (
          <View style={styles.doneCard}>
            <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
            <Text style={styles.doneText}>Recorded ({task.outcome === "abnormal" ? "flagged for repair" : "normal"}).</Text>
          </View>
        ) : (
          <>
            <Button testID="ct-normal" label="All good — mark done" icon="check" loading={busy === "normal"} onPress={() => finish(true)} />
            <Pressable testID="ct-abnormal" onPress={() => finish(false)} disabled={!!busy} style={styles.abnormalBtn}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.error} />
              <Text style={styles.abnormalText}>Something looks wrong</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl, lineHeight: 26 },
  why: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  step: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  stepTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  stepBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  stepMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 12 },
  abnormalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderColor: colors.error, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  abnormalText: { color: colors.error, fontFamily: font.bold, fontSize: type.base },
  doneCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.success + "14", borderColor: colors.success, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  doneText: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
});
