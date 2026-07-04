import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { PortfolioReport, Portfolio } from "@/src/components/PortfolioReport";

export default function PublicPortfolio() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<Portfolio | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<Portfolio>(`/portfolio/public/${token}`, { auth: false })
      .then(setD).catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons name="lock-outline" size={40} color={colors.onSurfaceTertiary} />
        <Text style={styles.errTitle}>Portfolio unavailable</Text>
        <Text style={styles.errSub}>This home record is private or the link has expired.</Text>
      </View>
    );
  }
  if (!d) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing["3xl"] }} showsVerticalScrollIndicator={false}>
      <View style={styles.brand}>
        <Text style={styles.brandText}>DIY<Text style={{ color: colors.brandPrimary }}>homie</Text></Text>
        <Text style={styles.brandSub}>Verified Home Record</Text>
      </View>
      <PortfolioReport d={d} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  errTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  errSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center" },
  brand: { alignItems: "center", marginBottom: spacing.lg },
  brandText: { color: colors.onSurface, fontFamily: font.bold, fontSize: 28, letterSpacing: -1 },
  brandSub: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 2 },
});
