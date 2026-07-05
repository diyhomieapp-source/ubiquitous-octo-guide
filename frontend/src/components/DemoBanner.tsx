import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function DemoBanner({ projectId, onCommitted }: { projectId: string; onCommitted?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const commit = async () => {
    setBusy(true);
    try {
      await api(`/demo/commit/${projectId}`, { method: "POST" });
      setDone(true);
      Alert.alert("Saved as a real project! 🎉", "This project is now yours — track progress, log costs and see your ROI.");
      onCommitted?.();
    } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  if (done) return null;
  return (
    <View style={styles.banner} testID="demo-banner">
      <MaterialCommunityIcons name="test-tube" size={18} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>You&apos;re in demo mode</Text>
        <Text style={styles.sub}>Like what you see? Save this as a real project to keep it.</Text>
      </View>
      <Pressable testID="demo-commit" style={styles.btn} onPress={commit} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.btnText}>Save as real</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderColor: colors.warning, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 2 },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  btnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
