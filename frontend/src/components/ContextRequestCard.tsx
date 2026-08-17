import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

/**
 * Build Doc 11 — contextual property context-request shown inside a project workspace.
 * Optional by design: user can answer or dismiss; answering also files issue evidence.
 */
export function ContextRequestCard({ issueId }: { issueId: string }) {
  const [request, setRequest] = useState<any>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<any>(`/hi/brain/context-request?issue_id=${issueId}`);
      setRequest(r.request);
    } catch {}
  }, [issueId]);
  useEffect(() => { load(); }, [load]);

  if (!request || done) return null;

  const submit = async (dismiss?: boolean) => {
    setBusy(true);
    try {
      await api("/hi/brain/context-request/answer", { method: "POST", body: { request_id: request.id, value: dismiss ? "" : value.trim() } });
      setDone(true);
    } catch {} finally { setBusy(false); }
  };

  return (
    <View testID="ctx-request" style={styles.card}>
      <View style={styles.head}>
        <MaterialCommunityIcons name="home-search-outline" size={18} color={colors.info} />
        <Text style={styles.title}>One detail would sharpen this</Text>
        <Pressable testID="ctx-dismiss" onPress={() => submit(true)} hitSlop={8}>
          <MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>
      </View>
      <Text style={styles.question}>{request.question}</Text>
      <Text style={styles.why}>{request.why} (Optional — Homie remembers it for every future project.)</Text>
      <View style={styles.row}>
        <TextInput testID="ctx-input" value={value} onChangeText={setValue} placeholder="Your answer" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
        <Pressable testID="ctx-save" disabled={busy || !value.trim()} onPress={() => submit()} style={[styles.saveBtn, (!value.trim() || busy) && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="check" size={18} color={colors.onBrandPrimary} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.info + "12", borderColor: colors.info, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginTop: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, fontFamily: font.bold, fontSize: type.sm, color: colors.info },
  question: { fontFamily: font.medium, fontSize: type.base, color: colors.onSurface },
  why: { fontFamily: font.regular, fontSize: type.sm, color: colors.onSurfaceTertiary },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: font.regular, fontSize: type.base },
  saveBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.info, alignItems: "center", justifyContent: "center" },
});
