import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Quiz = { id: string; topic: string; title: string; question_count: number };

export function SkillCheckBanner({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [passed, setPassed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ quiz: Quiz | null; passed?: boolean }>(`/quizzes/for-project/${projectId}`);
      setQuiz(r.quiz); setPassed(!!r.passed);
    } catch {}
  }, [projectId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!quiz || passed || dismissed) return null;

  return (
    <View style={styles.banner} testID="skillcheck-banner">
      <View style={styles.icon}><MaterialCommunityIcons name="school-outline" size={20} color={colors.brandPrimary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>New skill area: {quiz.topic}</Text>
        <Text style={styles.sub}>Take a {quiz.question_count}-question check before you start — build confidence & avoid rookie mistakes.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable testID="skillcheck-take" style={styles.take} onPress={() => router.push(`/skills?quizId=${quiz.id}`)}><Text style={styles.takeText}>Take it</Text></Pressable>
        <Pressable testID="skillcheck-dismiss" hitSlop={8} onPress={() => setDismissed(true)}><Text style={styles.skip}>Skip</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary + "12", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 2 },
  actions: { alignItems: "center", gap: 4 },
  take: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  takeText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  skip: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 11 },
});
