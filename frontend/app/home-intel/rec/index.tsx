import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Linking } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const COMPAT_COLOR: Record<string, string> = { compatible: colors.success, likely_compatible: colors.info, needs_verification: colors.warning };
const COMPAT_LABEL: Record<string, string> = { compatible: "Compatible", likely_compatible: "Likely fits", needs_verification: "Verify first" };

export default function ProjectRecommendations() {
  const { project_id } = useLocalSearchParams<{ project_id: string }>();
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { const d = await api<any>(`/hi/rec/for-project/${project_id}`); setGroups(d.groups); } catch {} finally { setLoading(false); }
  }, [project_id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const viewProduct = async (rid: string) => {
    setBusy(true);
    try {
      const d = await api<any>(`/hi/rec/recommendations/${rid}/click`, { method: "POST" });
      if (d.product_url) { Linking.openURL(d.product_url).catch(() => Alert.alert("Couldn't open", "Try again later.")); }
      else Alert.alert("Link unavailable", "You can still use the product details to shop elsewhere.");
    } catch (e: any) { Alert.alert("Partner unavailable", e?.message || "You can still use the product details to shop elsewhere."); }
    finally { setBusy(false); }
  };
  const act = async (rid: string, action: string) => {
    setBusy(true);
    try { await api(`/hi/rec/recommendations/${rid}/action`, { method: "POST", body: { action } }); setDismissed((m) => ({ ...m, [rid]: action })); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Recommended" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Recommended products" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text style={styles.intro}>Options for the materials you still need. Safety and fit come first — never commission.</Text>
        {groups.length === 0 ? (
          <View style={styles.emptyWrap}>
            <MaterialCommunityIcons name="cart-check" size={36} color={colors.onSurfaceTertiary} />
            <Text style={styles.empty}>Nothing to shop for right now. Mark materials as needed on your project to see options.</Text>
          </View>
        ) : groups.map((g) => (
          <View key={g.need_id} style={{ marginBottom: spacing.lg }}>
            <Text style={styles.groupTitle}>For: {g.material}</Text>
            {g.recommendations.map((rc: any) => (
              dismissed[rc.id] ? (
                <View key={rc.id} style={styles.dismissedRow}><Text style={styles.dismissedText}>{rc.title} · {dismissed[rc.id].replace(/_/g, " ")}</Text></View>
              ) : (
                <View key={rc.id} testID={`rec-${rc.id}`} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{rc.title}</Text>
                    <View style={[styles.compat, { borderColor: COMPAT_COLOR[rc.compatibility_status] }]}>
                      <Text style={[styles.compatText, { color: COMPAT_COLOR[rc.compatibility_status] }]}>{COMPAT_LABEL[rc.compatibility_status]}</Text>
                    </View>
                  </View>
                  <Text style={styles.reason}>{rc.recommendation_reason}</Text>
                  {rc.price_reference && <Text style={styles.price}>{rc.price_reference} · {rc.partner_name}</Text>}
                  {!rc.price_reference && <Text style={styles.noPrice}>Price not verified · {rc.partner_name}</Text>}
                  {rc.verify_note && <View style={styles.verifyRow}><MaterialCommunityIcons name="alert-outline" size={14} color={colors.warning} /><Text style={styles.verifyText}>{rc.verify_note}</Text></View>}
                  {rc.safety_warning && <Text style={styles.safety}>⚠︎ {rc.safety_warning}</Text>}
                  {rc.disclosure_text && <Text style={styles.disclosure}>{rc.disclosure_text}</Text>}
                  <Pressable testID={`rec-view-${rc.id}`} disabled={busy} style={styles.viewBtn} onPress={() => viewProduct(rc.id)}>
                    <MaterialCommunityIcons name="open-in-new" size={16} color={colors.onBrandPrimary} /><Text style={styles.viewText}>View Product</Text>
                  </Pressable>
                  <View style={styles.actions}>
                    <Pressable testID={`rec-save-${rc.id}`} disabled={busy} style={styles.actChip} onPress={() => act(rc.id, "save")}><Text style={styles.actText}>Save</Text></Pressable>
                    <Pressable disabled={busy} style={styles.actChip} onPress={() => act(rc.id, "already_have")}><Text style={styles.actText}>I have this</Text></Pressable>
                    <Pressable disabled={busy} style={styles.actChip} onPress={() => act(rc.id, "not_relevant")}><Text style={styles.actText}>Not relevant</Text></Pressable>
                    <Pressable testID={`rec-report-${rc.id}`} disabled={busy} style={styles.actChip} onPress={() => act(rc.id, "report_mismatch")}><Text style={styles.actText}>Report</Text></Pressable>
                  </View>
                </View>
              )
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 20, marginBottom: spacing.md },
  emptyWrap: { alignItems: "center", paddingTop: spacing["3xl"], gap: spacing.md },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", paddingHorizontal: spacing.lg },
  groupTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  compat: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  compatText: { fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  reason: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.xs },
  price: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, marginTop: spacing.xs },
  noPrice: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, marginTop: spacing.xs },
  verifyRow: { flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: spacing.xs },
  verifyText: { flex: 1, color: colors.warning, fontFamily: font.medium, fontSize: type.xs, lineHeight: 16 },
  safety: { color: colors.warning, fontFamily: font.bold, fontSize: type.xs, marginTop: 4, lineHeight: 16 },
  disclosure: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 11, fontStyle: "italic", marginTop: spacing.sm, lineHeight: 15 },
  viewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingVertical: spacing.sm, marginTop: spacing.sm },
  viewText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  actChip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  actText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.xs },
  dismissedRow: { paddingVertical: spacing.sm, opacity: 0.5 },
  dismissedText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textDecorationLine: "line-through", textTransform: "capitalize" },
});
