import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const ROLLOUTS = ["all", "optin", "user_type", "region", "off"];
const ROLLOUT_LABEL: Record<string, string> = { all: "Everyone", optin: "Opt-in", user_type: "User type", region: "Region", off: "Off" };
const USER_TYPES = ["pro", "paying", "admin"];

type Flag = { key: string; label: string; description: string; icon: string; enabled: boolean; rollout_type: string; rollout_value: string | null; optin_count: number; feedback_count: number };

export function FeaturesModule() {
  const [rows, setRows] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [analytics, setAnalytics] = useState<any | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api<Flag[]>("/admin/features")); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patch = async (key: string, body: any) => {
    try { await api(`/admin/features/${key}`, { method: "PATCH", body }); load(); } catch (e: any) { Alert.alert("Update failed", e?.message || "Try again."); }
  };
  const remove = async (key: string) => {
    try { await api(`/admin/features/${key}`, { method: "DELETE" }); load(); } catch {}
  };
  const viewAnalytics = async (key: string) => {
    try { setAnalytics(await api(`/admin/features/${key}/analytics`)); } catch {}
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Feature Flags</Text>
          <Text style={styles.sub}>{rows.length} flags · {rows.filter((r) => r.enabled).length} live. Roll out safely, no deploy needed.</Text>
        </View>
        <Pressable testID="feat-add-toggle" style={[styles.btn, styles.btnOk]} onPress={() => setAdding((a) => !a)}>
          <MaterialCommunityIcons name={adding ? "close" : "plus"} size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>{adding ? "Close" : "New"}</Text>
        </Pressable>
      </View>

      {adding && <AddFlagForm onCreated={() => { setAdding(false); load(); }} />}

      {rows.map((f) => (
        <View key={f.key} style={styles.card}>
          <View style={styles.cardTop}>
            <MaterialCommunityIcons name={f.icon as any} size={20} color={colors.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{f.label}</Text>
              <Text style={styles.key}>{f.key}</Text>
            </View>
            <Pressable testID={`feat-enable-${f.key}`} style={[styles.switch, f.enabled && styles.switchOn]} onPress={() => patch(f.key, { enabled: !f.enabled })}>
              <View style={[styles.knob, f.enabled && styles.knobOn]} />
            </Pressable>
          </View>
          <Text style={styles.desc}>{f.description}</Text>

          <Text style={styles.miniLabel}>ROLLOUT</Text>
          <View style={styles.chipRow}>
            {ROLLOUTS.map((r) => (
              <Pressable key={r} testID={`feat-rollout-${f.key}-${r}`} style={[styles.chip, f.rollout_type === r && styles.chipOn]} onPress={() => patch(f.key, { rollout_type: r })}>
                <Text style={[styles.chipText, f.rollout_type === r && styles.chipTextOn]}>{ROLLOUT_LABEL[r]}</Text>
              </Pressable>
            ))}
          </View>
          {f.rollout_type === "user_type" && (
            <View style={styles.chipRow}>
              {USER_TYPES.map((v) => (
                <Pressable key={v} style={[styles.chip, f.rollout_value === v && styles.chipOn]} onPress={() => patch(f.key, { rollout_value: v })}>
                  <Text style={[styles.chipText, f.rollout_value === v && styles.chipTextOn]}>{v}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {f.rollout_type === "region" && (
            <RegionInput value={f.rollout_value || ""} onSave={(v) => patch(f.key, { rollout_value: v })} />
          )}

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{f.optin_count} opt-ins · {f.feedback_count} feedback</Text>
            <View style={{ flex: 1 }} />
            <Pressable testID={`feat-analytics-${f.key}`} onPress={() => viewAnalytics(f.key)} hitSlop={8}><MaterialCommunityIcons name="chart-box-outline" size={18} color={colors.brandPrimary} /></Pressable>
            <Pressable testID={`feat-del-${f.key}`} onPress={() => remove(f.key)} hitSlop={8} style={{ marginLeft: spacing.md }}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
          </View>
        </View>
      ))}

      {analytics && <AnalyticsSheet data={analytics} onClose={() => setAnalytics(null)} />}
    </ScrollView>
  );
}

function RegionInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <View style={styles.regionRow}>
      <TextInput style={styles.regionInput} value={v} onChangeText={setV} autoCapitalize="none" placeholder="city or zip fragment (e.g. austin)" placeholderTextColor={colors.onSurfaceTertiary} />
      <Pressable style={[styles.btn, styles.btnOk]} onPress={() => onSave(v.trim())}><Text style={styles.btnOkText}>Set</Text></Pressable>
    </View>
  );
}

function AddFlagForm({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [desc, setDesc] = useState("");
  const [rollout, setRollout] = useState("optin");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const k = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!k || !label.trim() || busy) { if (!k || !label.trim()) Alert.alert("Missing fields", "Key and label are required."); return; }
    setBusy(true);
    try {
      await api("/admin/features", { method: "POST", body: { key: k, label: label.trim(), description: desc.trim(), rollout_type: rollout, enabled: true } });
      onCreated();
    } catch (e: any) { Alert.alert("Couldn't create", e?.message || "Try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.form}>
      <TextInput testID="feat-new-key" style={styles.input} value={key} onChangeText={setKey} autoCapitalize="none" placeholder="key (e.g. smart_tool_rental)" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput testID="feat-new-label" style={styles.input} value={label} onChangeText={setLabel} placeholder="Label" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput style={[styles.input, { minHeight: 54, textAlignVertical: "top" }]} value={desc} onChangeText={setDesc} placeholder="Description" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <Text style={styles.miniLabel}>ROLLOUT</Text>
      <View style={styles.chipRow}>
        {ROLLOUTS.map((r) => (
          <Pressable key={r} style={[styles.chip, rollout === r && styles.chipOn]} onPress={() => setRollout(r)}>
            <Text style={[styles.chipText, rollout === r && styles.chipTextOn]}>{ROLLOUT_LABEL[r]}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable testID="feat-new-create" style={[styles.btn, styles.btnOk, { alignSelf: "flex-start", marginTop: spacing.sm }]} onPress={create} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><MaterialCommunityIcons name="check" size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Create flag</Text></>}
      </Pressable>
    </View>
  );
}

function AnalyticsSheet({ data, onClose }: { data: any; onClose: () => void }) {
  const tags = data.tag_breakdown || {};
  return (
    <View style={styles.analytics}>
      <View style={styles.cardTop}>
        <Text style={styles.name}>{data.flag?.label} · insights</Text>
        <View style={{ flex: 1 }} />
        <Pressable testID="feat-analytics-close" onPress={onClose} hitSlop={8}><MaterialCommunityIcons name="close" size={20} color={colors.onSurface} /></Pressable>
      </View>
      <View style={styles.aRow}>
        <AStat label="Opt-ins" value={String(data.optin_count)} />
        <AStat label="Feedback" value={String(data.feedback_count)} />
        <AStat label="Avg ★" value={String(data.avg_rating)} />
        <AStat label="Useful %" value={`${data.useful_pct}%`} />
      </View>
      {Object.keys(tags).length > 0 && (
        <Text style={styles.tagsLine}>{Object.entries(tags).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}</Text>
      )}
      {(data.recent || []).slice(0, 8).map((f: any) => (
        <View key={f.id} style={styles.fbItem}>
          <Text style={styles.fbTag}>{f.tag}{f.rating ? ` · ${f.rating}★` : ""}</Text>
          <Text style={styles.fbComment} numberOfLines={2}>{f.comment || "(no comment)"}</Text>
        </View>
      ))}
    </View>
  );
}

function AStat({ label, value }: { label: string; value: string }) {
  return <View style={styles.aStat}><Text style={styles.aValue}>{value}</Text><Text style={styles.aLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  key: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  desc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  miniLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, marginTop: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  chipTextOn: { color: colors.onBrandPrimary },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xs, paddingTop: spacing.xs, borderTopColor: colors.border, borderTopWidth: 1 },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  regionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  regionInput: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  form: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  analytics: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: spacing.sm },
  aRow: { flexDirection: "row", gap: spacing.sm },
  aStat: { flex: 1, alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.sm, paddingVertical: spacing.sm },
  aValue: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 20 },
  aLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10 },
  tagsLine: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  fbItem: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm },
  fbTag: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase" },
  fbComment: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
});
