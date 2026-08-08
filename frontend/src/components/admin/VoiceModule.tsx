import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch, TextInput } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

export function VoiceModule() {
  const [dash, setDash] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api<any>("/hi/admin/voice/dashboard"); setDash(d); setLimit(String(d.settings?.free_voice_daily_limit ?? "")); }
    catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setSetting = async (key: string, value: any) => {
    setBusy(true);
    try { await api("/hi/admin/voice/settings", { method: "PUT", body: { [key]: value } }); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  if (loading || !dash) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const s = dash.settings || {};

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>Voice & Avatar</Text>
        <Pressable testID="voice-admin-refresh" style={styles.refreshBtn} onPress={load}><MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} /></Pressable>
      </View>

      <View style={styles.statRow}>
        <Stat label="Sessions" value={dash.total_sessions} />
        <Stat label="Voice replies" value={dash.voice_responses} />
        <Stat label="Playback fails" value={dash.failed_playback} accent={dash.failed_playback > 0} />
        <Stat label="Low-conf STT" value={dash.low_confidence_transcripts} accent={dash.low_confidence_transcripts > 0} />
      </View>

      <Text style={styles.section}>Providers & controls</Text>
      <View style={styles.card}>
        <Row label="Voice input (speech-to-text)" value={!!s.voice_input_enabled} onToggle={(v) => setSetting("voice_input_enabled", v)} busy={busy} tid="voice-toggle-input" />
        <Row label="Voice output (spoken replies)" value={!!s.voice_output_enabled} onToggle={(v) => setSetting("voice_output_enabled", v)} busy={busy} tid="voice-toggle-output" />
        <Row label="Avatar runtime (feature flag)" value={!!s.avatar_enabled} onToggle={(v) => setSetting("avatar_enabled", v)} busy={busy} tid="voice-toggle-avatar" />
        <Row label="Disable avatar for high-risk work" value={!!s.high_risk_avatar_disabled} onToggle={(v) => setSetting("high_risk_avatar_disabled", v)} busy={busy} tid="voice-toggle-highrisk" />
      </View>

      <Text style={styles.section}>Free-plan voice limit (per day)</Text>
      <View style={styles.card}>
        <View style={styles.limitRow}>
          <TextInput testID="voice-limit-input" value={limit} onChangeText={setLimit} keyboardType="number-pad" style={styles.input} />
          <Pressable testID="voice-limit-save" disabled={busy} style={styles.saveBtn} onPress={() => setSetting("free_voice_daily_limit", parseInt(limit || "0", 10))}><Text style={styles.saveText}>Save</Text></Pressable>
        </View>
      </View>

      <Text style={styles.section}>Sessions by mode</Text>
      <View style={styles.card}>
        {Object.entries(dash.sessions_by_mode || {}).map(([k, v]) => <View key={k} style={styles.rowBetween}><Text style={styles.k}>{k.replace(/_/g, " ")}</Text><Text style={styles.v}>{v as number}</Text></View>)}
      </View>
      <Text style={styles.note}>Voice & avatar are UI layers over the same property-aware Homie intelligence and safety gateway. They always fall back to text, and never bypass safety, privacy or confidence rules.</Text>
    </ScrollView>
  );
}

function Row({ label, value, onToggle, busy, tid }: any) {
  return <View style={styles.rowBetween}><Text style={styles.k}>{label}</Text><Switch testID={tid} value={value} disabled={busy} onValueChange={onToggle} trackColor={{ true: colors.brandPrimary }} /></View>;
}
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statVal, accent && value > 0 && { color: colors.warning }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  refreshBtn: { padding: spacing.xs },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, minWidth: 70, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 9, marginTop: 2, textAlign: "center" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  k: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize", flex: 1, paddingRight: spacing.sm },
  v: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  limitRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  saveText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  note: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16, marginTop: spacing.sm },
});
