import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CONF_COLOR: Record<string, string> = { low: colors.warning, medium: colors.info, high: colors.success };
const SRC_LABEL: Record<string, string> = {
  manual: "Manual", walkthrough: "Walkthrough", photo_detected: "Photo", document_imported: "Document",
  ai_estimate: "AI estimate", ar_future: "AR", lidar_future: "LiDAR",
};

export default function TwinHome() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api("/hi/twin/overview")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.root}><ScreenHeader title="Digital Twin" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  const t = data.twin;
  const c = data.counts;
  const sources = Object.entries(data.sources || {});

  return (
    <View style={styles.root}>
      <ScreenHeader title="Property Digital Twin" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.intro}>One evolving model of your home. Every capture — manual, photo, walkthrough — makes it smarter, and Homie always keeps your confirmed measurements safe.</Text>

        <View style={styles.heroCard}>
          <View style={[styles.confRing, { borderColor: CONF_COLOR[t.confidence_level] || colors.warning }]}>
            <MaterialCommunityIcons name="home-analytics" size={26} color={CONF_COLOR[t.confidence_level] || colors.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{t.model_status.replace("_", " ")}</Text>
            <Text style={[styles.heroConf, { color: CONF_COLOR[t.confidence_level] || colors.warning }]}>{t.confidence_level} confidence</Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <Stat label="Rooms" value={c.rooms} />
          <Stat label="Elements" value={c.elements} />
          <Stat label="Links" value={c.connections} />
          <Stat label="Conflicts" value={c.open_conflicts} accent={c.open_conflicts > 0} />
        </View>

        {c.open_conflicts > 0 && (
          <Pressable testID="twin-conflicts" style={styles.conflictBanner} onPress={() => router.push("/home-intel/twin/conflicts")}>
            <MaterialCommunityIcons name="alert-decagram" size={20} color={colors.warning} />
            <Text style={styles.conflictText}>{c.open_conflicts} measurement{c.open_conflicts > 1 ? "s" : ""} need your review</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.warning} />
          </Pressable>
        )}

        <Pressable testID="twin-start-capture" style={styles.primary} onPress={() => router.push("/home-intel/twin/capture")}>
          <MaterialCommunityIcons name="camera-plus-outline" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.primaryText}>Start a capture</Text>
        </Pressable>

        {sources.length > 0 && (
          <>
            <Text style={styles.section}>Capture sources</Text>
            <View style={styles.wrap}>
              {sources.map(([k, v]) => (
                <View key={k} style={styles.srcChip}><Text style={styles.srcText}>{SRC_LABEL[k] || k}: {String(v)}</Text></View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.section}>Rooms in this twin</Text>
        {data.rooms.length === 0 ? <Text style={styles.empty}>No rooms captured yet. Start a walkthrough to build your twin.</Text> :
          data.rooms.map((rm: any) => (
            <View key={rm.id} style={styles.roomRow}>
              <MaterialCommunityIcons name="floor-plan" size={18} color={colors.brandPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.roomName}>{rm.display_name}</Text>
                <Text style={styles.roomMeta}>{rm.room_type} · {rm.boundary_status}{rm.area_estimate ? ` · ~${rm.area_estimate} sq ft` : ""}</Text>
              </View>
              <View style={[styles.confDot, { backgroundColor: CONF_COLOR[rm.confidence_level] || colors.warning }]} />
            </View>
          ))}

        <Text style={styles.note}>Early geometry is approximate unless you verify it. Future AR, LiDAR and MeasureAssist captures will enrich this same twin.</Text>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 21 },
  heroCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  confRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  heroTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, textTransform: "capitalize" },
  heroConf: { fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize", marginTop: 2 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 22 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  conflictBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderColor: colors.warning + "66", borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  conflictText: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  srcChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  srcText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
  roomRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.xs },
  roomName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  roomMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2, textTransform: "capitalize" },
  confDot: { width: 10, height: 10, borderRadius: 5 },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.xl },
});
