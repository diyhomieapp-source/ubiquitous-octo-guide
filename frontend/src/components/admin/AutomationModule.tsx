import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Cond = { field: string; op: string; value: any };
type Action = { type: string; amount?: number; tag?: string; template?: string; url?: string };
type Rule = { id: string; name: string; trigger: string; conditions: Cond[]; actions: Action[]; enabled: boolean; runs: number; last_run?: string | null };
type TriggerMeta = { key: string; label: string; fields: string[] };
type ActionMeta = { key: string; label: string; param: string | null; param_type: string | null };
type Recipe = { name: string; trigger: string; conditions: Cond[]; actions: Action[] };
type Meta = { triggers: TriggerMeta[]; actions: ActionMeta[]; recipes: Recipe[] };
type Log = { id: string; rule_name: string; trigger: string; user_email: string; results: { type: string; ok: boolean; detail: string }[]; success: boolean; test: boolean; created_at: string };

const OPS = [{ k: "gte", l: "≥" }, { k: "lte", l: "≤" }, { k: "eq", l: "=" }, { k: "contains", l: "has" }];
const actionSummary = (a: Action) => a.type === "award_credits" ? `+${a.amount || 0} credits` : a.type === "add_tag" ? `tag "${a.tag}"` : a.type === "send_email" ? `email "${a.template}"` : a.type === "webhook" ? `webhook` : "log";

export function AutomationModule() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"rules" | "activity">("rules");
  const [building, setBuilding] = useState(false);

  // builder state
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("signup");
  const [conds, setConds] = useState<Cond[]>([]);
  const [actions, setActions] = useState<Action[]>([]);

  const load = useCallback(async () => {
    try {
      const [m, r, l] = await Promise.all([
        api<Meta>("/admin/automations/meta"),
        api<{ rules: Rule[] }>("/admin/automations"),
        api<{ logs: Log[] }>("/admin/automations/logs"),
      ]);
      setMeta(m); setRules(r.rules); setLogs(l.logs);
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reset = () => { setName(""); setTrigger("signup"); setConds([]); setActions([]); setBuilding(false); };

  const startFromRecipe = (rc: Recipe) => {
    setName(rc.name); setTrigger(rc.trigger); setConds(rc.conditions || []); setActions(rc.actions || []); setBuilding(true); setTab("rules");
  };

  const save = async () => {
    if (!name.trim() || actions.length === 0) { Alert.alert("Automation", "Add a name and at least one action."); return; }
    try {
      await api("/admin/automations", { method: "POST", body: { name: name.trim(), trigger, conditions: conds, actions, enabled: true } });
      reset(); load();
    } catch { Alert.alert("Automation", "Could not save rule."); }
  };

  const toggle = async (r: Rule) => {
    setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)));
    try { await api(`/admin/automations/${r.id}/toggle`, { method: "PATCH", body: { enabled: !r.enabled } }); } catch { load(); }
  };
  const test = async (r: Rule) => {
    try { const res = await api<{ fired: boolean }>(`/admin/automations/${r.id}/test`, { method: "POST" }); Alert.alert("Test run", res.fired ? "Rule fired ✓ — see Activity." : "Conditions not met for sample data."); setTab("activity"); load(); }
    catch { Alert.alert("Test", "Test failed."); }
  };
  const remove = async (r: Rule) => {
    setRules((rs) => rs.filter((x) => x.id !== r.id));
    try { await api(`/admin/automations/${r.id}`, { method: "DELETE" }); } catch { load(); }
  };

  const triggerFields = meta?.triggers.find((t) => t.key === trigger)?.fields || [];

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
      <Text style={styles.h1}>Automations</Text>
      <Text style={styles.sub}>“When ___ happens, do ___.” No code required.</Text>

      <View style={styles.tabs}>
        {(["rules", "activity"] as const).map((t) => (
          <Pressable key={t} testID={`auto-tab-${t}`} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === "rules" ? "Rules" : "Activity"}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "activity" ? (
        logs.length === 0 ? <View style={styles.empty}><MaterialCommunityIcons name="history" size={28} color={colors.onSurfaceTertiary} /><Text style={styles.emptyText}>No automation runs yet.</Text></View> :
        logs.map((l) => (
          <View key={l.id} style={styles.logCard}>
            <View style={styles.logTop}>
              <MaterialCommunityIcons name={l.success ? "check-circle" : "alert-circle"} size={16} color={l.success ? colors.success : colors.error} />
              <Text style={styles.logName}>{l.rule_name}{l.test ? " (test)" : ""}</Text>
              <Text style={styles.logDate}>{new Date(l.created_at).toLocaleTimeString()}</Text>
            </View>
            <Text style={styles.logMeta}>{l.trigger} · {l.user_email}</Text>
            {l.results.map((r, i) => (
              <Text key={i} style={[styles.logResult, { color: r.ok ? colors.onSurfaceSecondary : colors.error }]}>• {r.detail}</Text>
            ))}
          </View>
        ))
      ) : (
        <>
          {!building ? (
            <Pressable testID="auto-new" style={styles.newBtn} onPress={() => setBuilding(true)}>
              <MaterialCommunityIcons name="plus" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.newBtnText}>NEW AUTOMATION</Text>
            </Pressable>
          ) : (
            <View style={styles.builder}>
              <Text style={styles.label}>NAME</Text>
              <TextInput testID="auto-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Reward 5th project" placeholderTextColor={colors.onSurfaceTertiary} />

              <Text style={styles.label}>WHEN THIS HAPPENS</Text>
              <View style={styles.chips}>
                {meta?.triggers.map((t) => (
                  <Pressable key={t.key} testID={`auto-trigger-${t.key}`} style={[styles.chip, trigger === t.key && styles.chipActive]} onPress={() => { setTrigger(t.key); setConds([]); }}>
                    <Text style={[styles.chipText, trigger === t.key && styles.chipTextActive]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              {triggerFields.length > 0 && (
                <>
                  <Text style={styles.label}>ONLY IF (OPTIONAL)</Text>
                  {conds.map((c, i) => (
                    <View key={i} style={styles.condRow}>
                      <Text style={styles.condField}>{c.field}</Text>
                      <View style={styles.opRow}>
                        {OPS.map((o) => (
                          <Pressable key={o.k} style={[styles.opChip, c.op === o.k && styles.opChipActive]} onPress={() => setConds((cs) => cs.map((x, xi) => xi === i ? { ...x, op: o.k } : x))}>
                            <Text style={[styles.opText, c.op === o.k && styles.chipTextActive]}>{o.l}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <TextInput style={styles.condVal} value={String(c.value)} onChangeText={(v) => setConds((cs) => cs.map((x, xi) => xi === i ? { ...x, value: v } : x))} keyboardType="numeric" placeholder="value" placeholderTextColor={colors.onSurfaceTertiary} />
                      <Pressable hitSlop={8} onPress={() => setConds((cs) => cs.filter((_, xi) => xi !== i))}><MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceTertiary} /></Pressable>
                    </View>
                  ))}
                  <View style={styles.chips}>
                    {triggerFields.filter((f) => !conds.some((c) => c.field === f)).map((f) => (
                      <Pressable key={f} testID={`auto-addcond-${f}`} style={styles.addChip} onPress={() => setConds((cs) => [...cs, { field: f, op: "gte", value: "1" }])}>
                        <MaterialCommunityIcons name="plus" size={13} color={colors.brandPrimary} /><Text style={styles.addChipText}>{f}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.label}>DO THIS</Text>
              {actions.map((a, i) => (
                <View key={i} style={styles.actionRow}>
                  <MaterialCommunityIcons name="lightning-bolt" size={16} color={colors.warning} />
                  <Text style={styles.actionType}>{meta?.actions.find((m) => m.key === a.type)?.label}</Text>
                  {a.type === "award_credits" && <TextInput style={styles.actionParam} value={String(a.amount ?? "")} onChangeText={(v) => setActions((as) => as.map((x, xi) => xi === i ? { ...x, amount: parseInt(v) || 0 } : x))} keyboardType="numeric" placeholder="amt" placeholderTextColor={colors.onSurfaceTertiary} />}
                  {a.type === "add_tag" && <TextInput style={styles.actionParam} value={a.tag ?? ""} onChangeText={(v) => setActions((as) => as.map((x, xi) => xi === i ? { ...x, tag: v } : x))} placeholder="tag" placeholderTextColor={colors.onSurfaceTertiary} />}
                  {a.type === "send_email" && <TextInput style={styles.actionParam} value={a.template ?? ""} onChangeText={(v) => setActions((as) => as.map((x, xi) => xi === i ? { ...x, template: v } : x))} placeholder="template" placeholderTextColor={colors.onSurfaceTertiary} />}
                  {a.type === "webhook" && <TextInput style={styles.actionParam} value={a.url ?? ""} onChangeText={(v) => setActions((as) => as.map((x, xi) => xi === i ? { ...x, url: v } : x))} placeholder="https://" placeholderTextColor={colors.onSurfaceTertiary} />}
                  <Pressable hitSlop={8} onPress={() => setActions((as) => as.filter((_, xi) => xi !== i))}><MaterialCommunityIcons name="close" size={18} color={colors.onSurfaceTertiary} /></Pressable>
                </View>
              ))}
              <View style={styles.chips}>
                {meta?.actions.map((m) => (
                  <Pressable key={m.key} testID={`auto-addaction-${m.key}`} style={styles.addChip} onPress={() => setActions((as) => [...as, { type: m.key }])}>
                    <MaterialCommunityIcons name="plus" size={13} color={colors.brandPrimary} /><Text style={styles.addChipText}>{m.label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.builderBtns}>
                <Pressable testID="auto-cancel" style={styles.cancelBtn} onPress={reset}><Text style={styles.cancelText}>Cancel</Text></Pressable>
                <Pressable testID="auto-save" style={styles.saveBtn} onPress={save}><Text style={styles.saveText}>SAVE RULE</Text></Pressable>
              </View>
            </View>
          )}

          {rules.map((r) => (
            <View key={r.id} style={styles.ruleCard}>
              <View style={styles.ruleTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ruleName}>{r.name}</Text>
                  <Text style={styles.ruleTrigger}>when {r.trigger.replace(/_/g, " ")}{r.conditions.length ? ` · if ${r.conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(", ")}` : ""}</Text>
                </View>
                <Switch testID={`auto-toggle-${r.id}`} value={r.enabled} onValueChange={() => toggle(r)} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
              </View>
              <View style={styles.actionPills}>
                {r.actions.map((a, i) => <View key={i} style={styles.actionPill}><Text style={styles.actionPillText}>{actionSummary(a)}</Text></View>)}
              </View>
              <View style={styles.ruleFooter}>
                <Text style={styles.ruleRuns}>{r.runs} runs</Text>
                <View style={styles.ruleActions}>
                  <Pressable testID={`auto-test-${r.id}`} style={styles.ghostBtn} onPress={() => test(r)}><MaterialCommunityIcons name="play-outline" size={15} color={colors.brandPrimary} /><Text style={styles.ghostText}>Test</Text></Pressable>
                  <Pressable testID={`auto-delete-${r.id}`} style={styles.ghostBtn} onPress={() => remove(r)}><MaterialCommunityIcons name="trash-can-outline" size={15} color={colors.error} /><Text style={[styles.ghostText, { color: colors.error }]}>Delete</Text></Pressable>
                </View>
              </View>
            </View>
          ))}

          {!building && meta?.recipes && meta.recipes.length > 0 && (
            <>
              <Text style={styles.section}>RECIPE LIBRARY</Text>
              {meta.recipes.map((rc, i) => (
                <Pressable key={i} testID={`auto-recipe-${i}`} style={styles.recipe} onPress={() => startFromRecipe(rc)}>
                  <MaterialCommunityIcons name="book-open-variant" size={18} color={colors.info} />
                  <Text style={styles.recipeName}>{rc.name}</Text>
                  <MaterialCommunityIcons name="plus-circle-outline" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { paddingTop: spacing["3xl"], alignItems: "center" },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  tabs: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md },
  tab: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabActive: { backgroundColor: colors.onSurface, borderColor: colors.onSurface },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabTextActive: { color: colors.surface },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  newBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  builder: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  chip: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  chipTextActive: { color: colors.onBrandPrimary },
  addChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandTertiary + "44", borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  addChipText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  condRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  condField: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, flex: 1 },
  opRow: { flexDirection: "row", gap: 2 },
  opChip: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  opChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  opText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  condVal: { width: 54, backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm },
  actionType: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm, flex: 1 },
  actionParam: { width: 100, backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  builderBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  saveBtn: { flex: 2, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  ruleCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  ruleTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ruleName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  ruleTrigger: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  actionPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  actionPill: { backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  actionPillText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },
  ruleFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
  ruleRuns: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  ruleActions: { flexDirection: "row", gap: spacing.md },
  ghostBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  ghostText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  section: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  recipe: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  recipeName: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, flex: 1 },
  logCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  logTop: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  logName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, flex: 1 },
  logDate: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 10 },
  logMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  logResult: { fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
});
