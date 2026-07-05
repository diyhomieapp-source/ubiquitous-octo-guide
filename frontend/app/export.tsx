import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform, Linking } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Options = { types: string[]; counts: Record<string, number>; formats: string[] };
const LABELS: Record<string, string> = {
  projects: "Projects", timeline: "Completed projects & ROI", events: "Activity events",
  skills: "Learning & skills", campaigns: "Sponsored campaigns", certificates: "Certificates", notifications: "Notifications",
};

export default function ExportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [options, setOptions] = useState<Options | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const o = await api<Options>("/export/options");
      setOptions(o);
      const init: Record<string, boolean> = {};
      o.types.forEach((t) => { init[t] = true; });
      setSelected(init);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (t: string) => setSelected((s) => ({ ...s, [t]: !s[t] }));
  const chosen = () => Object.keys(selected).filter((t) => selected[t]);

  const generate = async (share: boolean) => {
    const types = chosen();
    if (types.length === 0) { Alert.alert("Pick at least one", "Select what to include in your export."); return; }
    setBusy(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const r = await api<any>("/export/generate", { method: "POST", body: { types, format, share } });
      if (share && r.share) {
        const base = process.env.EXPO_PUBLIC_BACKEND_URL;
        const reportUrl = `${base}${r.share.report_url}`;
        await Clipboard.setStringAsync(`${base}${r.share.download_url}`);
        Alert.alert("Share link ready", `A secure, expiring link (until ${String(r.share.expires_at).slice(0, 10)}) was copied. Opening your printable report…`);
        if (Platform.OS === "web") { if (typeof window !== "undefined") window.open(reportUrl, "_blank"); }
        else { await Linking.openURL(reportUrl); }
      } else {
        const payload = format === "csv" ? r.csv : JSON.stringify(r, null, 2);
        await Clipboard.setStringAsync(payload);
        Alert.alert(`${format.toUpperCase()} export ready`, `Your ${types.length}-section export was copied to the clipboard. Saved $${r.summary.money_saved_usd?.toLocaleString?.() || r.summary.money_saved_usd} across ${r.summary.completed_logged} logged projects.`);
      }
    } catch (e: any) { Alert.alert("Export failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="export-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Reports & Export</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading || !options ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          <Text style={styles.help}>Select what to include, then download it or create a secure, expiring share link with a printable report — perfect for insurance, resale, taxes or a pro handoff.</Text>

          <Text style={styles.section}>What to include</Text>
          {options.types.map((t) => (
            <Pressable key={t} testID={`export-type-${t}`} style={styles.row} onPress={() => toggle(t)}>
              <MaterialCommunityIcons name={selected[t] ? "checkbox-marked" : "checkbox-blank-outline"} size={22} color={selected[t] ? colors.brandPrimary : colors.onSurfaceTertiary} />
              <Text style={styles.rowLabel}>{LABELS[t] || t}</Text>
              <Text style={styles.rowCount}>{options.counts[t] ?? 0}</Text>
            </Pressable>
          ))}

          <Text style={styles.section}>Format</Text>
          <View style={styles.segment}>
            {(["json", "csv"] as const).map((f) => (
              <Pressable key={f} testID={`export-format-${f}`} style={[styles.segBtn, format === f && styles.segOn]} onPress={() => setFormat(f)}>
                <Text style={[styles.segText, format === f && styles.segTextOn]}>{f.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable testID="export-download" style={styles.primaryBtn} onPress={() => generate(false)} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="download-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.primaryText}>Copy {format.toUpperCase()} export</Text></>}
          </Pressable>
          <Pressable testID="export-share" style={styles.secondaryBtn} onPress={() => generate(true)} disabled={busy}>
            <MaterialCommunityIcons name="link-variant" size={18} color={colors.brandPrimary} />
            <Text style={styles.secondaryText}>Create secure share link + report</Text>
          </Pressable>

          <Text style={styles.footNote}>Every export is logged to your activity history and share links expire automatically. No one sees your data without your link.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  help: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  rowLabel: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  rowCount: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  segment: { flexDirection: "row", gap: spacing.sm },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surfaceSecondary },
  segOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  segTextOn: { color: colors.onSurface },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xl },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.sm },
  secondaryText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  footNote: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 17, marginTop: spacing.xl, textAlign: "center" },
});
