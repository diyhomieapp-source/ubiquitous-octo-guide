import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Share } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Summary = { counts: Record<string, number>; ownership_notice: string; recent_audit: { action: string; at: string }[] };

const LABELS: Record<string, string> = { projects: "Projects", timeline: "Log entries", community_posts: "Community posts", material_listings: "Marketplace listings", credentials: "Credentials" };

export default function DataPortability() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sum, setSum] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [importCode, setImportCode] = useState("");
  const [deleteText, setDeleteText] = useState("");

  const load = useCallback(async () => {
    try { setSum(await api<Summary>("/portability/summary")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportData = async () => {
    setBusy("export"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const bundle = await api<any>("/portability/export");
      const json = JSON.stringify(bundle, null, 2);
      await Clipboard.setStringAsync(json);
      Alert.alert("Export ready", `Your full data bundle (${Object.values(bundle.summary).reduce((a: any, b: any) => a + b, 0)} records) was copied as JSON. Paste it anywhere to save your Home Ownership Log.`);
    } catch (e: any) { Alert.alert("Export failed", e?.message || "Try again."); }
    finally { setBusy(null); }
  };

  const transfer = async () => {
    setBusy("transfer");
    try {
      const r = await api<{ token: string; note: string }>("/portability/transfer", { method: "POST" });
      await Share.share({ message: `I'm transferring my DIYhomie home history to you. Import this code in DIYhomie → Data & Portability:\n\n${r.token}\n\n(Valid 14 days.)` });
      load();
    } catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(null); }
  };

  const doImport = async () => {
    if (!importCode.trim()) { Alert.alert("Enter a code", "Paste the transfer code from the previous owner."); return; }
    setBusy("import");
    try {
      const r = await api<{ note: string }>("/portability/import", { method: "POST", body: { token: importCode.trim() } });
      Alert.alert("Imported ✅", r.note); setImportCode(""); load();
    } catch (e: any) { Alert.alert("Import failed", e?.message || "Check the code."); }
    finally { setBusy(null); }
  };

  const requestDelete = async () => {
    setBusy("delete");
    try {
      const r = await api<{ note: string }>("/portability/delete-request", { method: "POST", body: { confirm: deleteText.trim() } });
      Alert.alert("Request logged", r.note); setDeleteText("");
    } catch (e: any) { Alert.alert("Not confirmed", e?.message || "Type DELETE to confirm."); }
    finally { setBusy(null); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="data-back" hitSlop={10} onPress={() => router.back()}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Data & Portability</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading || !sum ? <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          <View style={styles.pledge}>
            <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.success} />
            <Text style={styles.pledgeText}>{sum.ownership_notice}</Text>
          </View>

          <Text style={styles.section}>Your data</Text>
          <View style={styles.statGrid}>
            {Object.entries(sum.counts).map(([k, v]) => (
              <View key={k} style={styles.statCard}><Text style={styles.statVal}>{v}</Text><Text style={styles.statLabel}>{LABELS[k] || k}</Text></View>
            ))}
          </View>

          <Pressable testID="data-export" style={styles.actionBtn} onPress={exportData} disabled={busy === "export"}>
            {busy === "export" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="download-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.actionText}>Export my full data (JSON)</Text></>}
          </Pressable>

          <Text style={styles.section}>Transfer to a new owner</Text>
          <Text style={styles.help}>Selling or handing off your home? Generate a secure code — the new owner imports your entire history. Your originals stay intact.</Text>
          <Pressable testID="data-transfer" style={styles.outlineBtn} onPress={transfer} disabled={busy === "transfer"}>
            {busy === "transfer" ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.outlineText}>Generate transfer code</Text>}
          </Pressable>

          <Text style={styles.section}>Import previous owner's history</Text>
          <TextInput testID="data-import-code" style={styles.input} value={importCode} onChangeText={setImportCode} autoCapitalize="none" placeholder="Paste transfer code (xfer_…)" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="data-import" style={styles.outlineBtn} onPress={doImport} disabled={busy === "import"}>
            {busy === "import" ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.outlineText}>Import records</Text>}
          </Pressable>

          <Text style={styles.section}>Delete my data</Text>
          <Text style={styles.help}>You can request full deletion anytime (GDPR/CCPA). We export a final copy and remove your data within 30 days. Type DELETE to confirm.</Text>
          <TextInput testID="data-delete-confirm" style={styles.input} value={deleteText} onChangeText={setDeleteText} autoCapitalize="characters" placeholder="Type DELETE" placeholderTextColor={colors.onSurfaceTertiary} />
          <Pressable testID="data-delete" style={styles.dangerBtn} onPress={requestDelete} disabled={busy === "delete"}>
            {busy === "delete" ? <ActivityIndicator color={colors.error} /> : <Text style={styles.dangerText}>Request data deletion</Text>}
          </Pressable>
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
  pledge: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.success + "18", borderRadius: radius.md, padding: spacing.md },
  pledgeText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm, lineHeight: 18 },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xl, marginBottom: spacing.sm },
  help: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 18, marginBottom: spacing.sm },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { width: "31%", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 22 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, textAlign: "center", marginTop: 2 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  actionText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },
  outlineBtn: { alignItems: "center", borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xs },
  outlineText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.sm },
  dangerBtn: { alignItems: "center", borderColor: colors.error, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md },
  dangerText: { color: colors.error, fontFamily: font.bold, fontSize: type.base },
});
