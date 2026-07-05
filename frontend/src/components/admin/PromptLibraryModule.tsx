import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Row = {
  key: string; name: string; description: string; category: string; role: string; risk: string;
  vars: string[]; status: string; version: number; has_pending: boolean; ab_enabled: boolean;
  variant_count: number; usage: number; feedback_up: number; feedback_down: number; updated_at: string | null;
};
type Variant = { id: string; label: string; content: string; weight: number; enabled: boolean };
type Detail = Row & {
  content: string; pending: string | null; default: string;
  variants: Variant[]; history: { version: number; content: string; at: string; by: string }[];
  audit: { action: string; by: string; note: string; at: string }[];
};

const RISK_COLOR: Record<string, string> = { low: "#27AE60", medium: "#2F80ED", high: "#F2994A", critical: "#EB5757" };

export function PromptLibraryModule() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, an] = await Promise.all([
        api<{ prompts: Row[] }>("/admin/prompts"),
        api<{ totals: any }>("/admin/prompts/analytics"),
      ]);
      setRows(list.prompts); setTotals(an.totals);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>AI Prompt Library</Text>
      <Text style={styles.sub}>Tune, A/B test, pause or roll back every AI behaviour live — no code deploy.</Text>

      {totals && (
        <View style={styles.statRow}>
          <Stat label="Prompts" value={String(totals.prompts)} />
          <Stat label="Live" value={String(totals.live)} />
          <Stat label="Paused" value={String(totals.paused)} />
          <Stat label="AI calls" value={String(totals.usage)} />
          <Stat label="👍 / 👎" value={`${totals.feedback_up}/${totals.feedback_down}`} />
        </View>
      )}

      {rows.map((r) => (
        <Pressable key={r.key} testID={`prompt-${r.key}`} style={styles.card} onPress={() => setSelected(r.key)}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{r.name}</Text>
              <Text style={styles.key}>{r.key} · {r.category}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: (r.status === "live" ? colors.success : "#EB5757") + "22" }]}>
              <Text style={[styles.pillText, { color: r.status === "live" ? colors.success : "#EB5757" }]}>{r.status === "live" ? "LIVE" : "PAUSED"}</Text>
            </View>
          </View>
          <Text style={styles.desc} numberOfLines={2}>{r.description}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.riskDot, { backgroundColor: RISK_COLOR[r.risk] || colors.onSurfaceTertiary }]} />
            <Text style={styles.metaText}>{r.risk} · v{r.version}</Text>
            {r.has_pending && <Text style={styles.pendingTag}>DRAFT PENDING</Text>}
            {r.ab_enabled && <Text style={styles.abTag}>A/B · {r.variant_count}</Text>}
            <View style={{ flex: 1 }} />
            <Text style={styles.metaText}>{r.usage} calls · 👍{r.feedback_up}</Text>
          </View>
        </Pressable>
      ))}

      {selected && <PromptDetail promptKey={selected} onClose={() => setSelected(null)} onChange={load} />}
    </ScrollView>
  );
}

function PromptDetail({ promptKey, onClose, onChange }: { promptKey: string; onClose: () => void; onChange: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "ab" | "history">("editor");

  const reload = useCallback(async () => {
    try { const det = await api<Detail>(`/admin/prompts/${promptKey}`); setD(det); setDraft(det.pending ?? det.content); }
    catch (e: any) { Alert.alert("Load failed", e?.message || "Try again."); }
  }, [promptKey]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try { await fn(); await reload(); onChange(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(null); }
  };

  const saveDraft = () => act("save", () => api(`/admin/prompts/${promptKey}`, { method: "PUT", body: { content: draft, note: "edited in workstation" } }));
  const publish = () => act("publish", () => api(`/admin/prompts/${promptKey}/publish`, { method: "POST", body: { note: "published from workstation" } }));
  const discard = () => act("discard", () => api(`/admin/prompts/${promptKey}/discard`, { method: "POST" }));
  const toggleStatus = () => act("status", () => api(`/admin/prompts/${promptKey}/status`, { method: "POST", body: { status: d?.status === "live" ? "paused" : "live" } }));
  const toggleAb = () => act("ab", () => api(`/admin/prompts/${promptKey}/ab`, { method: "POST", body: { enabled: !d?.ab_enabled } }));
  const rollback = (version: number) => act("rollback", () => api(`/admin/prompts/${promptKey}/rollback`, { method: "POST", body: { version } }));
  const delVariant = (vid: string) => act("delvar", () => api(`/admin/prompts/${promptKey}/variants/${vid}`, { method: "DELETE" }));
  const patchVariant = (vid: string, body: any) => act("patchvar", () => api(`/admin/prompts/${promptKey}/variants/${vid}`, { method: "PUT", body }));

  if (!d) return <View style={styles.overlay}><View style={styles.sheet}><ActivityIndicator color={colors.brandPrimary} /></View></View>;

  const dirty = draft !== (d.pending ?? d.content);
  const hasVars = (d.vars || []).length > 0;

  return (
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{d.name}</Text>
            <Text style={styles.key}>{d.key} · v{d.version} · {d.status}</Text>
          </View>
          <Pressable testID="prompt-close" onPress={onClose} hitSlop={8}><MaterialCommunityIcons name="close" size={22} color={colors.onSurface} /></Pressable>
        </View>

        <View style={styles.tabRow}>
          {(["editor", "ab", "history"] as const).map((t) => (
            <Pressable key={t} testID={`prompt-tab-${t}`} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === "editor" ? "Editor" : t === "ab" ? `A/B (${d.variants.length})` : `History (${d.history.length})`}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {tab === "editor" && (
            <View>
              {hasVars && (
                <Text style={styles.varsHint}>Placeholders: {d.vars.map((v) => `{${v}}`).join("  ")}</Text>
              )}
              <TextInput
                testID="prompt-content"
                style={styles.editor}
                value={draft}
                onChangeText={setDraft}
                multiline
                autoCapitalize="none"
                placeholder="Prompt content…"
                placeholderTextColor={colors.onSurfaceTertiary}
              />
              <View style={styles.btnRow}>
                <Pressable testID="prompt-save" style={[styles.btn, styles.btnOk, !dirty && styles.btnDisabled]} onPress={saveDraft} disabled={!dirty || !!busy}>
                  {busy === "save" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.btnOkText}>Save draft</Text>}
                </Pressable>
                {d.has_pending && (
                  <>
                    <Pressable testID="prompt-publish" style={[styles.btn, styles.btnOk]} onPress={publish} disabled={!!busy}>
                      {busy === "publish" ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.btnOkText}>Approve & publish</Text>}
                    </Pressable>
                    <Pressable testID="prompt-discard" style={styles.btn} onPress={discard} disabled={!!busy}><Text style={styles.btnText}>Discard</Text></Pressable>
                  </>
                )}
              </View>
              {d.has_pending && <Text style={styles.reviewNote}>⚠️ A draft is awaiting approval. The live app still uses v{d.version} until you publish.</Text>}

              <Pressable testID="prompt-status" style={[styles.wideBtn, d.status === "live" ? styles.pauseBtn : styles.resumeBtn]} onPress={toggleStatus} disabled={!!busy}>
                <MaterialCommunityIcons name={d.status === "live" ? "pause-circle-outline" : "play-circle-outline"} size={18} color={d.status === "live" ? "#EB5757" : colors.success} />
                <Text style={[styles.wideBtnText, { color: d.status === "live" ? "#EB5757" : colors.success }]}>{d.status === "live" ? "Pause (fall back to safe default)" : "Resume live"}</Text>
              </Pressable>

              {d.default ? (
                <View style={styles.defaultBox}>
                  <Text style={styles.miniLabel}>SAFE DEFAULT (fallback)</Text>
                  <Text style={styles.defaultText} numberOfLines={4}>{d.default}</Text>
                </View>
              ) : null}
            </View>
          )}

          {tab === "ab" && (
            <View>
              <View style={styles.abHead}>
                <Text style={styles.desc}>Split live traffic across variants to compare clarity & outcomes.</Text>
                <Pressable testID="prompt-ab-toggle" style={[styles.switch, d.ab_enabled && styles.switchOn]} onPress={toggleAb}>
                  <View style={[styles.knob, d.ab_enabled && styles.knobOn]} />
                </Pressable>
              </View>
              {d.variants.length === 0 && <Text style={styles.metaText}>No variants yet. Add one below.</Text>}
              {d.variants.map((v) => (
                <View key={v.id} style={styles.varCard}>
                  <View style={styles.cardTop}>
                    <Text style={styles.name}>{v.label}</Text>
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={() => patchVariant(v.id, { enabled: !v.enabled })} style={[styles.switch, v.enabled && styles.switchOn]}><View style={[styles.knob, v.enabled && styles.knobOn]} /></Pressable>
                    <Pressable onPress={() => delVariant(v.id)} hitSlop={8} style={{ marginLeft: spacing.md }}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
                  </View>
                  <Text style={styles.varContent} numberOfLines={3}>{v.content}</Text>
                  <View style={styles.weightRow}>
                    <Text style={styles.metaText}>Weight {v.weight}</Text>
                    <Pressable style={styles.weightBtn} onPress={() => patchVariant(v.id, { weight: Math.max(0, v.weight - 10) })}><Text style={styles.weightBtnText}>−10</Text></Pressable>
                    <Pressable style={styles.weightBtn} onPress={() => patchVariant(v.id, { weight: v.weight + 10 })}><Text style={styles.weightBtnText}>+10</Text></Pressable>
                  </View>
                </View>
              ))}
              <AddVariant promptKey={promptKey} onAdded={() => { reload(); onChange(); }} />
            </View>
          )}

          {tab === "history" && (
            <View>
              {d.history.length === 0 && <Text style={styles.metaText}>No prior versions yet.</Text>}
              {[...d.history].reverse().map((h) => (
                <View key={h.version} style={styles.histCard}>
                  <View style={styles.cardTop}>
                    <Text style={styles.name}>v{h.version}</Text>
                    <View style={{ flex: 1 }} />
                    <Pressable testID={`prompt-rollback-${h.version}`} style={[styles.btn, styles.btnOk]} onPress={() => rollback(h.version)} disabled={!!busy}><Text style={styles.btnOkText}>Restore</Text></Pressable>
                  </View>
                  <Text style={styles.varContent} numberOfLines={3}>{h.content}</Text>
                  <Text style={styles.metaText}>{(h.at || "").slice(0, 16).replace("T", " ")} · {h.by || "—"}</Text>
                </View>
              ))}
              {d.audit.length > 0 && (
                <>
                  <Text style={styles.miniLabel}>RECENT CHANGES</Text>
                  {d.audit.slice(0, 10).map((a, i) => (
                    <Text key={i} style={styles.auditLine}>{(a.at || "").slice(5, 16).replace("T", " ")} · {a.action} · {a.by || "—"}</Text>
                  ))}
                </>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function AddVariant({ promptKey, onAdded }: { promptKey: string; onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!label.trim() || !content.trim()) { Alert.alert("Missing", "Label and content are required."); return; }
    setBusy(true);
    try { await api(`/admin/prompts/${promptKey}/variants`, { method: "POST", body: { label: label.trim(), content: content.trim(), weight: 50 } }); setLabel(""); setContent(""); onAdded(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Try again."); }
    finally { setBusy(false); }
  };
  return (
    <View style={styles.addForm}>
      <TextInput testID="variant-label" style={styles.input} value={label} onChangeText={setLabel} placeholder="Variant label (e.g. Concise)" placeholderTextColor={colors.onSurfaceTertiary} />
      <TextInput testID="variant-content" style={[styles.editor, { minHeight: 90 }]} value={content} onChangeText={setContent} multiline autoCapitalize="none" placeholder="Variant prompt content…" placeholderTextColor={colors.onSurfaceTertiary} />
      <Pressable testID="variant-add" style={[styles.btn, styles.btnOk, { alignSelf: "flex-start" }]} onPress={add} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <><MaterialCommunityIcons name="plus" size={15} color={colors.onBrandPrimary} /><Text style={styles.btnOkText}>Add variant</Text></>}
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text style={styles.statVal}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 62, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm },
  statVal: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 18 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: 10, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  key: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  desc: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: 2 },
  riskDot: { width: 8, height: 8, borderRadius: 4 },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  pendingTag: { color: "#F2994A", fontFamily: font.bold, fontSize: 9, backgroundColor: "#F2994A22", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  abTag: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: 9, backgroundColor: colors.brandPrimary + "22", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", zIndex: 50 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  tabRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary },
  tabOn: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabTextOn: { color: colors.onBrandPrimary },
  varsHint: { color: colors.brandPrimary, fontFamily: font.medium, fontSize: type.sm, marginBottom: spacing.xs },
  editor: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, minHeight: 180, color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm, lineHeight: 19, textAlignVertical: "top" },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.sm },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  btnOk: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  btnOkText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  reviewNote: { color: "#F2994A", fontFamily: font.medium, fontSize: type.sm, marginTop: spacing.sm },
  wideBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.md },
  pauseBtn: { borderColor: "#EB5757" },
  resumeBtn: { borderColor: colors.success },
  wideBtnText: { fontFamily: font.bold, fontSize: type.sm },
  defaultBox: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  miniLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, marginTop: spacing.sm, marginBottom: spacing.xs },
  defaultText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  abHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.border, padding: 2, justifyContent: "center" },
  switchOn: { backgroundColor: colors.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  varCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  varContent: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, lineHeight: 17 },
  weightRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  weightBtn: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  weightBtnText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  addForm: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, gap: spacing.sm },
  histCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  auditLine: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
});
