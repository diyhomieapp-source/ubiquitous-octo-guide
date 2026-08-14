import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { Button, LoadingState, EmptyState } from "@/src/components/ui";

const ISSUE_META: Record<string, { label: string; color: string; icon: string }> = {
  new_information: { label: "New information found", color: "#29B6F6", icon: "information-outline" },
  conflict: { label: "Potential conflict", color: "#FFC400", icon: "alert-outline" },
  duplicate: { label: "Already on file", color: "#A0A0A5", icon: "content-copy" },
  stale_data: { label: "May be outdated", color: "#FF6A00", icon: "clock-alert-outline" },
  incomplete_data: { label: "Needs confirmation", color: "#FF6A00", icon: "help-circle-outline" },
};

export default function PropertyImport() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [config, setConfig] = useState<any>(null);
  const [rows, setRows] = useState<{ field_key: string; observed_value: string }[]>([{ field_key: "year_built", observed_value: "" }]);
  const [issues, setIssues] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, j] = await Promise.all([api<any>("/hi/import/config"), api<any>("/hi/import/jobs")]);
      setConfig(c); setJobs(j.jobs || []);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    const evidence = rows.filter((r) => r.field_key && r.observed_value.trim()).map((r) => ({
      evidence_type: "property_fact", field_key: r.field_key, observed_value: r.observed_value.trim(),
      source_type: "user_document", confidence_level: "high",
    }));
    if (evidence.length === 0) { Alert.alert("Add some details", "Enter at least one value to import."); return; }
    setBusy(true);
    try {
      const res = await api<any>("/hi/import/jobs", { method: "POST", body: { import_type: "manual", source_reference: "Manual entry", evidence } });
      setIssues(res.issues || []); setRows([{ field_key: "year_built", observed_value: "" }]); await load();
    } catch (e: any) { Alert.alert("Import failed", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const resolve = async (issue: any, action: string) => {
    setBusy(true);
    try {
      const body: any = { action };
      if (action === "edit") body.edited_value = editing[issue.id] ?? issue.proposed_value;
      await api(`/hi/import/issues/${issue.id}/resolve`, { method: "POST", body });
      setIssues((prev) => prev.filter((i) => i.id !== issue.id));
    } catch (e: any) { Alert.alert("Couldn't update", e?.message || "Try again."); } finally { setBusy(false); }
  };

  const factLabel = (k: string) => (config?.fact_labels?.[k]) || k;

  if (loading || !config) return <View style={[styles.root, { paddingTop: insets.top }]}><LoadingState /></View>;
  const fields: string[] = Object.keys(config.fact_labels || {});

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="imp-back" onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back"><MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Add Property Info</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.md }}>
        <Text style={styles.intro}>Enrich your home profile from what you know or from a document. Nothing overwrites your confirmed records — you review every change.</Text>

        {rows.map((row, idx) => (
          <View key={idx} style={styles.entryCard}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fieldChips}>
              {fields.map((f) => (
                <Pressable key={f} testID={`imp-field-${idx}-${f}`} style={[styles.fieldChip, row.field_key === f && styles.fieldChipOn]} onPress={() => setRows((prev) => prev.map((r, i) => i === idx ? { ...r, field_key: f } : r))}>
                  <Text style={[styles.fieldChipText, row.field_key === f && { color: colors.brandPrimary }]}>{factLabel(f)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput testID={`imp-value-${idx}`} value={row.observed_value} onChangeText={(v) => setRows((prev) => prev.map((r, i) => i === idx ? { ...r, observed_value: v } : r))} placeholder={`${factLabel(row.field_key)} value`} placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          </View>
        ))}
        <Pressable testID="imp-add-row" style={styles.addRow} onPress={() => setRows((prev) => [...prev, { field_key: "square_footage", observed_value: "" }])}>
          <MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} />
          <Text style={styles.addRowText}>Add another detail</Text>
        </Pressable>
        <Button testID="imp-submit" label="Review changes" icon="text-search" loading={busy} onPress={submit} />
        <Text style={styles.disclaimer}>{config.disclaimer}</Text>

        {issues.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Review what we found</Text>
            {issues.map((issue) => {
              const meta = ISSUE_META[issue.issue_type] || ISSUE_META.new_information;
              return (
                <View key={issue.id} style={[styles.issueCard, { borderLeftColor: meta.color }]}>
                  <View style={styles.issueHead}>
                    <MaterialCommunityIcons name={meta.icon as any} size={16} color={meta.color} />
                    <Text style={[styles.issueType, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.issueField}>{factLabel(issue.field_key)}</Text>
                  {issue.current_value ? <Text style={styles.issueLine}>On file: <Text style={styles.issueVal}>{issue.current_value}</Text>{issue.protected ? " (you confirmed this)" : ""}</Text> : null}
                  <Text style={styles.issueLine}>From document: <Text style={styles.issueVal}>{issue.proposed_value}</Text></Text>

                  {issue.issue_type === "duplicate" ? (
                    <Button testID={`imp-ok-${issue.id}`} label="Got it" variant="secondary" onPress={() => resolve(issue, "ignore")} />
                  ) : (
                    <>
                      <TextInput testID={`imp-edit-${issue.id}`} value={editing[issue.id] ?? issue.proposed_value} onChangeText={(v) => setEditing((e) => ({ ...e, [issue.id]: v }))} style={styles.editInput} placeholderTextColor={colors.onSurfaceTertiary} />
                      <View style={styles.issueActions}>
                        <Button testID={`imp-accept-${issue.id}`} label="Add to My Home" onPress={() => resolve(issue, "edit")} style={{ flex: 1 }} />
                        {issue.current_value ? <Button testID={`imp-keep-${issue.id}`} label="Keep existing" variant="secondary" onPress={() => resolve(issue, "keep")} style={{ flex: 1 }} /> : <Button testID={`imp-ignore-${issue.id}`} label="Ignore" variant="secondary" onPress={() => resolve(issue, "ignore")} style={{ flex: 1 }} />}
                      </View>
                      <Pressable testID={`imp-ask-${issue.id}`} style={styles.askHomie} onPress={() => router.push("/homie")}>
                        <MaterialCommunityIcons name="robot-happy-outline" size={14} color={colors.brandPrimary} />
                        <Text style={styles.askHomieText}>Ask Homie about this</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}
          </>
        ) : null}

        {jobs.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Recent imports</Text>
            {jobs.slice(0, 8).map((j) => (
              <View key={j.id} style={styles.jobRow}>
                <MaterialCommunityIcons name="file-import-outline" size={16} color={colors.onSurfaceTertiary} />
                <Text style={styles.jobText}>{j.import_type} · {j.status.replace("_", " ")}</Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  intro: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  entryCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  fieldChips: { gap: spacing.sm, paddingRight: spacing.md },
  fieldChip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  fieldChipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "14" },
  fieldChipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.sm, minHeight: 44 },
  addRowText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  disclaimer: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.xs, lineHeight: 16 },
  sectionTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginTop: spacing.md },
  issueCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  issueHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  issueType: { fontFamily: font.bold, fontSize: type.sm, textTransform: "uppercase", letterSpacing: 0.3 },
  issueField: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  issueLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  issueVal: { color: colors.onSurface, fontFamily: font.bold },
  editInput: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.xs },
  issueActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  askHomie: { flexDirection: "row", alignItems: "center", gap: spacing.xs, justifyContent: "center", paddingVertical: spacing.sm, minHeight: 40 },
  askHomieText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  jobRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  jobText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, textTransform: "capitalize" },
});
