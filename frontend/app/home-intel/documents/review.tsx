import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

type Doc = { id: string; title: string; category: string; pending: number };

export default function ReviewQueue() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const d = await api<{ documents: Doc[] }>("/hi/documents/review-queue"); setDocs(d.documents); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Needs Review" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.lead}>Homie found details in these documents. Confirm what&apos;s correct so it can help you accurately.</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          docs.length === 0 ? <Text style={styles.empty}>All caught up — nothing to review.</Text> :
          docs.map((d) => (
            <Pressable key={d.id} testID={`review-doc-${d.id}`} style={styles.row} onPress={() => router.push(`/home-intel/documents/${d.id}`)}>
              <MaterialCommunityIcons name="clipboard-alert-outline" size={18} color={colors.warning} />
              <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{d.title}</Text><Text style={styles.meta}>{d.pending} detail{d.pending === 1 ? "" : "s"} to review · {d.category.replace(/_/g, " ")}</Text></View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  lead: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginBottom: spacing.md },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  meta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
});
