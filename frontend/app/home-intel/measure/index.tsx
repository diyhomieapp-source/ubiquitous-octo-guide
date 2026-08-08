import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const ACTIONS = [
  { label: "Measure a Room", type: "Room Length", icon: "floor-plan" },
  { label: "Measure a Wall", type: "Wall Width", icon: "wall" },
  { label: "Door or Window", type: "Door Opening", icon: "door" },
  { label: "Measure an Object", type: "Furniture", icon: "sofa-outline" },
  { label: "Add Manual Measurement", type: "Other", icon: "pencil-ruler" },
];
const SRC_LABEL: Record<string, string> = { manual: "Manual", camera_estimate: "Camera estimate", ar_future: "AR (future)", measureassist_future: "MeasureAssist", imported_future: "Imported" };

export default function MeasureHome() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { const d = await api<{ measurements: any[] }>("/hi/measurements/recent"); setRows(d.measurements); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const fmt = (m: any) => [m.length_value, m.width_value, m.height_value].filter((v: any) => v != null).join(" × ") + " " + m.unit;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Measure Anything" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {ACTIONS.map((a) => (
          <Pressable key={a.label} testID={`measure-${a.type}`} style={styles.action} onPress={() => router.push(`/home-intel/measure/new?type=${encodeURIComponent(a.type)}`)}>
            <MaterialCommunityIcons name={a.icon as any} size={22} color={colors.brandPrimary} />
            <Text style={styles.actionText}>{a.label}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceTertiary} />
          </Pressable>
        ))}

        <Text style={styles.section}>Recent measurements</Text>
        {loading ? <ActivityIndicator color={colors.brandPrimary} /> :
          rows.length === 0 ? <Text style={styles.empty}>No measurements yet.</Text> :
            rows.map((m) => (
              <Pressable key={m.id} testID={`m-${m.id}`} style={styles.card} onPress={() => router.push(`/home-intel/measure/${m.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{m.name}</Text>
                  <Text style={styles.cardMeta}>{fmt(m)} · {SRC_LABEL[m.source] || m.source}</Text>
                </View>
                {m.verification_status === "user_confirmed" ? <MaterialCommunityIcons name="check-decagram" size={18} color="#27AE60" /> :
                  m.source === "camera_estimate" ? <View style={styles.estTag}><Text style={styles.estText}>ESTIMATE</Text></View> : null}
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  action: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  actionText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  estTag: { backgroundColor: "#F2994A22", borderColor: "#F2994A", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  estText: { color: "#F2994A", fontFamily: font.bold, fontSize: 10 },
});
