import { useCallback, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Status = { overall: string; message?: string | null };

/** Doc 34 graceful degradation: quiet banner shown ONLY when a service tier is degraded. */
export function SystemStatusBanner() {
  const [status, setStatus] = useState<Status | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    api<Status>("/hi/system/status").then((s) => { if (mounted) setStatus(s); }).catch(() => {});
    return () => { mounted = false; };
  }, []));

  if (!status || status.overall === "ok") return null;
  return (
    <View testID="system-status-banner" style={styles.banner}>
      <MaterialCommunityIcons name="wrench-clock" size={18} color={colors.warning} />
      <Text style={styles.text}>{status.message || "Some features are recovering. Your projects and safety guidance are unaffected."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.warning, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  text: { flex: 1, fontFamily: font.medium, fontSize: type.sm, color: colors.onSurfaceSecondary },
});
