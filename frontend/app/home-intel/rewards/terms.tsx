import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

export default function RewardsTerms() {
  const [terms, setTerms] = useState<{ h: string; b: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const d = await api<{ terms: any[] }>("/hi/rewards/terms"); setTerms(d.terms); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Rewards terms" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> :
          terms.map((t, i) => (
            <View key={i} style={styles.card}>
              <Text style={styles.h}>{t.h}</Text>
              <Text style={styles.b}>{t.b}</Text>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  h: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.xs },
  b: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
});
