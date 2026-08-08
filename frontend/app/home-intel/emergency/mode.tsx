import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { ScreenHeader } from "@/src/components/ScreenHeader";

const CAT_ICON: Record<string, string> = { fire_smoke: "fire", gas_smell: "gas-cylinder", water_flood: "water", electrical: "flash", medical: "medical-bag", severe_weather: "weather-lightning-rainy", other: "alert-circle-outline" };

export default function EmergencyMode() {
  const router = useRouter();
  const [cats, setCats] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api<any>("/hi/emergency/categories"); setCats(r.categories || []); }
    catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const start = async (key: string) => {
    setBusy(true);
    try { const r = await api<any>("/hi/emergency/mode/start", { method: "POST", body: { category: key } }); setActive(r); }
    catch (e: any) { Alert.alert("Couldn't open", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.root}><ScreenHeader title="Emergency Mode" /><ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /></View>;

  if (active) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={active.label} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}>
          <View style={styles.callBanner}><MaterialCommunityIcons name="phone-alert" size={22} color="#fff" /><Text style={styles.callText}>{active.call_emergency}</Text></View>
          <Text style={styles.section}>Do this now</Text>
          {active.steps.map((s: string, i: number) => (
            <View key={i} style={styles.step}><Text style={styles.stepNum}>{i + 1}</Text><Text style={styles.stepText}>{s}</Text></View>
          ))}

          {active.your_locations?.length > 0 && (
            <>
              <Text style={styles.section}>Your saved locations</Text>
              {active.your_locations.map((l: any) => <View key={l.id} style={styles.card}><Text style={styles.cardTitle}>{l.location_type.replace(/_/g, " ")}</Text><Text style={styles.cardBody}>{l.description}</Text></View>)}
            </>
          )}

          <Text style={styles.section}>Your contacts</Text>
          {active.your_contacts?.length > 0 ? active.your_contacts.map((c: any) => (
            <View key={c.id} style={styles.card}><Text style={styles.cardTitle}>{c.name}</Text><Text style={styles.cardBody}>{c.contact_type.replace(/_/g, " ")}{c.phone ? ` · ${c.phone}` : ""}</Text></View>
          )) : <Text style={styles.empty}>No saved contacts. Add them in Property Risk for faster access next time.</Text>}

          <Text style={styles.note}>{active.note}</Text>
          {active.incident_id ? (
            <Pressable testID="er-mode-document" style={styles.docBtn} onPress={() => router.replace(`/home-intel/emergency/incident/${active.incident_id}`)}>
              <MaterialCommunityIcons name="clipboard-text-outline" size={18} color="#fff" />
              <Text style={styles.docText}>Once safe, document this incident</Text>
            </Pressable>
          ) : null}
          <Pressable testID="er-mode-back" style={styles.backBtn} onPress={() => setActive(null)}><Text style={styles.backText}>Choose a different emergency</Text></Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Emergency Mode" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.lead}>What's happening? Tap for immediate safety steps and your saved info.</Text>
        <View style={styles.grid}>
          {cats.map((c) => (
            <Pressable key={c.key} testID={`er-cat-${c.key}`} disabled={busy} style={styles.tile} onPress={() => start(c.key)}>
              <MaterialCommunityIcons name={(CAT_ICON[c.key] || "alert") as any} size={30} color="#EB5757" />
              <Text style={styles.tileText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>If anyone is in danger, call your local emergency number (911) first. DIYhomie doesn't replace emergency services.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  lead: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, marginBottom: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: { width: "47%", aspectRatio: 1.3, backgroundColor: colors.surfaceSecondary, borderColor: "#EB575744", borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  tileText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textAlign: "center" },
  callBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#EB5757", borderRadius: radius.md, padding: spacing.md },
  callText: { flex: 1, color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  step: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#EB5757", color: "#fff", textAlign: "center", lineHeight: 24, fontFamily: font.bold, fontSize: type.sm, overflow: "hidden" },
  stepText: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, lineHeight: 22 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  cardBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.lg },
  docBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.lg },
  docText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  backBtn: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
  backText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
});
