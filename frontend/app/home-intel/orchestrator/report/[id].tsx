import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Share } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { LoadingState, Button } from "@/src/components/ui";

export default function HomeReport() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rep, setRep] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRep((await api<any>(`/hi/handoff/report/${id}`)).report); } catch { setRep(null); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const share = async () => {
    if (!rep) return;
    try { await Share.share({ message: rep.share_text, title: `${rep.title} — Home Report` }); } catch {}
  };

  if (loading) return <View style={[styles.root, { paddingTop: insets.top }]}><LoadingState /></View>;
  if (!rep) return <View style={[styles.root, { paddingTop: insets.top }]}><Text style={styles.err}>Report unavailable.</Text></View>;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="rep-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Home Report</Text>
        <Pressable testID="rep-share" onPress={share} style={styles.iconBtn} accessibilityLabel="Share report"><MaterialCommunityIcons name="share-variant" size={20} color={colors.brandPrimary} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        <View style={styles.hero}>
          <MaterialCommunityIcons name="certificate-outline" size={26} color={rep.completed ? colors.success : colors.brandPrimary} />
          <Text style={styles.title}>{rep.title}</Text>
          <Text style={styles.status}>{rep.completed ? "Completed project" : rep.status.replace(/_/g, " ")}</Text>
          {rep.property_name ? <Text style={styles.prop}>{rep.property_name}</Text> : null}
        </View>

        <Section title="Summary">
          <Line k="Type" v={(rep.project_type || "").replace(/_/g, " ")} />
          <Line k="Tasks completed" v={String(rep.tasks_completed)} />
          <Line k="Approx. cost" v={`$${Number(rep.approx_cost).toFixed(2)}`} />
          {rep.confirmed_savings ? <Line k="Confirmed savings" v={`$${Number(rep.confirmed_savings).toFixed(2)}`} /> : null}
        </Section>

        {rep.materials_used?.length ? <Section title="Materials used"><Text style={styles.body}>{rep.materials_used.join(", ")}</Text></Section> : null}
        {rep.tools_used?.length ? <Section title="Tools used"><Text style={styles.body}>{rep.tools_used.join(", ")}</Text></Section> : null}
        {rep.committed_decisions?.length ? <Section title="Decisions"><Text style={styles.body}>{rep.committed_decisions.join(", ")}</Text></Section> : null}
        {rep.known_limitations?.length ? <Section title="Notes & limitations">{rep.known_limitations.map((l: string, i: number) => <Text key={i} style={styles.body}>• {l}</Text>)}</Section> : null}

        <Text style={styles.disclaimer}>Homeowner-maintained record. Not a certification of code compliance, permits, or structural condition.</Text>
        <Button testID="rep-share-btn" label="Share report" icon="share-variant" onPress={share} />
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;
}
function Line({ k, v }: { k: string; v: string }) {
  return <View style={styles.line}><Text style={styles.lineK}>{k}</Text><Text style={styles.lineV}>{v}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  err: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, padding: spacing.lg },
  hero: { alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, textAlign: "center" },
  status: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  prop: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  lineK: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
  lineV: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20 },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16 },
});
