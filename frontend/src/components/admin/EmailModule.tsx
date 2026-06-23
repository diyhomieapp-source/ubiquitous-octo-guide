import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Switch, Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Tab = "overview" | "templates" | "automations" | "broadcasts" | "suppression";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "chart-box-outline" },
  { key: "templates", label: "Templates", icon: "file-document-outline" },
  { key: "automations", label: "Automations", icon: "robot-outline" },
  { key: "broadcasts", label: "Broadcasts", icon: "bullhorn-outline" },
  { key: "suppression", label: "Suppression", icon: "email-off-outline" },
];
const TRIGGERS = ["welcome", "purchase", "renewal", "ticket_reply", "manual"];

export function EmailModule() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Email Marketing</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} testID={`email-tab-${t.key}`} style={[styles.tab, on && styles.tabOn]} onPress={() => setTab(t.key)}>
              <MaterialCommunityIcons name={t.icon as any} size={16} color={on ? colors.brandPrimary : colors.onSurfaceTertiary} />
              <Text style={[styles.tabText, on && { color: colors.onSurface }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {tab === "overview" && <OverviewTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "automations" && <AutomationsTab />}
        {tab === "broadcasts" && <BroadcastsTab />}
        {tab === "suppression" && <SuppressionTab />}
      </ScrollView>
    </View>
  );
}

/* ----------------------------------------------------------- Overview */
function OverviewTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setData(await api("/admin/email/overview")); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading) return <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />;
  if (!data) return <Text style={styles.muted}>Couldn't load stats.</Text>;
  const stats = [
    { label: "Sent (total)", value: data.total_sent, icon: "send-check" },
    { label: "Sent today", value: data.sent_today, icon: "calendar-today" },
    { label: "Queued", value: data.queued, icon: "tray-full" },
    { label: "Open rate", value: `${data.open_rate}%`, icon: "email-open-outline" },
    { label: "Delivered", value: data.delivered, icon: "check-all" },
    { label: "Bounces", value: data.bounces, icon: "email-alert-outline" },
    { label: "Complaints", value: data.complaints, icon: "alert-octagon-outline" },
    { label: "Suppressed", value: data.suppressed, icon: "email-off-outline" },
    { label: "Active automations", value: data.active_automations, icon: "robot-outline" },
  ];
  return (
    <View>
      <View style={[styles.banner, { borderColor: data.configured ? colors.success : colors.warning }]}>
        <MaterialCommunityIcons name={data.configured ? "check-circle-outline" : "alert-circle-outline"} size={20} color={data.configured ? colors.success : colors.warning} />
        <Text style={styles.bannerText}>
          {data.configured
            ? `Amazon SES connected · sending as ${data.sender} (${data.region})`
            : "Draft mode — emails queue but won't send until Amazon SES keys are added to backend/.env."}
        </Text>
      </View>
      <View style={styles.statGrid}>
        {stats.map((s) => (
          <View key={s.label} style={styles.statCard}>
            <MaterialCommunityIcons name={s.icon as any} size={18} color={colors.brandPrimary} />
            <Text style={styles.statNum}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ----------------------------------------------------------- Templates */
function TemplatesTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const load = useCallback(async () => {
    try { setItems(await api("/admin/email/templates")); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const blank = { name: "", subject: "", html: "", type: "marketing", key: null, active: true };
  const save = async () => {
    if (!editing.name || !editing.subject) { Alert.alert("Email", "Name and subject are required."); return; }
    const body = { name: editing.name, subject: editing.subject, html: editing.html, type: editing.type, key: editing.key, active: editing.active };
    if (editing.id) await api(`/admin/email/templates/${editing.id}`, { method: "PUT", body });
    else await api("/admin/email/templates", { method: "POST", body });
    setEditing(null); load();
  };
  const del = (t: any) => {
    Alert.alert("Delete template", `Delete "${t.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/admin/email/templates/${t.id}`, { method: "DELETE" }); load(); } catch (e: any) { Alert.alert("Email", e?.message || "Can't delete"); } } },
    ]);
  };

  if (editing) {
    return (
      <Editor title={editing.id ? "Edit template" : "New template"} onCancel={() => setEditing(null)} onSave={save}>
        <Field label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
        <Field label="Subject" value={editing.subject} onChange={(v) => setEditing({ ...editing, subject: v })} />
        <Field label="Body (HTML — use {{name}}, {{plan}}, {{app_url}})" value={editing.html} onChange={(v) => setEditing({ ...editing, html: v })} multiline />
        <View style={styles.rowBetween}>
          <Text style={styles.fieldLabel}>Active</Text>
          <Switch value={!!editing.active} onValueChange={(v) => setEditing({ ...editing, active: v })} trackColor={{ true: colors.brandPrimary }} />
        </View>
        {!!editing.key && <Text style={styles.muted}>Built-in transactional template ({editing.key}). Edit freely; it can't be deleted.</Text>}
      </Editor>
    );
  }
  return (
    <View>
      <Pressable testID="email-new-template" style={styles.addBtn} onPress={() => setEditing(blank)}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.addBtnText}>New template</Text>
      </Pressable>
      {loading ? <ActivityIndicator color={colors.brandPrimary} /> : items.map((t) => (
        <View key={t.id} style={styles.card}>
          <View style={{ flex: 1 }}>
            <View style={styles.rowWrap}>
              <Text style={styles.cardTitle}>{t.name}</Text>
              {!!t.key && <Badge text={t.key} color={colors.info} />}
              <Badge text={t.type} color={colors.onSurfaceTertiary} />
              {!t.active && <Badge text="off" color={colors.error} />}
            </View>
            <Text style={styles.cardSub} numberOfLines={1}>{t.subject}</Text>
          </View>
          <Pressable onPress={() => setEditing(t)} hitSlop={8}><MaterialCommunityIcons name="pencil" size={20} color={colors.onSurfaceSecondary} /></Pressable>
          {!t.key && <Pressable onPress={() => del(t)} hitSlop={8} style={{ marginLeft: spacing.md }}><MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} /></Pressable>}
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------------- Automations */
function AutomationsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const load = useCallback(async () => {
    try { setItems(await api("/admin/email/automations")); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const blank = { name: "", trigger: "welcome", active: true, steps: [{ delay_minutes: 0, subject: "", html: "" }] };
  const save = async () => {
    if (!editing.name || !editing.steps.length) { Alert.alert("Email", "Name and at least one step required."); return; }
    const body = { name: editing.name, trigger: editing.trigger, active: editing.active, steps: editing.steps };
    if (editing.id) await api(`/admin/email/automations/${editing.id}`, { method: "PUT", body });
    else await api("/admin/email/automations", { method: "POST", body });
    setEditing(null); load();
  };
  const del = (a: any) => Alert.alert("Delete automation", `Delete "${a.name}"?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { await api(`/admin/email/automations/${a.id}`, { method: "DELETE" }); load(); } },
  ]);

  if (editing) {
    const upStep = (i: number, patch: any) => { const s = [...editing.steps]; s[i] = { ...s[i], ...patch }; setEditing({ ...editing, steps: s }); };
    return (
      <Editor title={editing.id ? "Edit automation" : "New automation"} onCancel={() => setEditing(null)} onSave={save}>
        <Field label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
        <Text style={styles.fieldLabel}>Trigger</Text>
        <View style={styles.rowWrap}>
          {TRIGGERS.map((tr) => (
            <Pressable key={tr} style={[styles.chip, editing.trigger === tr && styles.chipOn]} onPress={() => setEditing({ ...editing, trigger: tr })}>
              <Text style={[styles.chipText, editing.trigger === tr && { color: colors.onBrandPrimary }]}>{tr}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.fieldLabel}>Active</Text>
          <Switch value={!!editing.active} onValueChange={(v) => setEditing({ ...editing, active: v })} trackColor={{ true: colors.brandPrimary }} />
        </View>
        {editing.steps.map((s: any, i: number) => (
          <View key={i} style={styles.stepBox}>
            <View style={styles.rowBetween}>
              <Text style={styles.stepTitle}>Step {i + 1}</Text>
              {editing.steps.length > 1 && <Pressable onPress={() => setEditing({ ...editing, steps: editing.steps.filter((_: any, j: number) => j !== i) })}><MaterialCommunityIcons name="close" size={18} color={colors.error} /></Pressable>}
            </View>
            <Field label="Delay (minutes after trigger / previous step)" value={String(s.delay_minutes)} onChange={(v) => upStep(i, { delay_minutes: parseInt(v || "0", 10) || 0 })} keyboardType="numeric" />
            <Field label="Subject" value={s.subject} onChange={(v) => upStep(i, { subject: v })} />
            <Field label="Body (HTML)" value={s.html} onChange={(v) => upStep(i, { html: v })} multiline />
          </View>
        ))}
        <Pressable style={styles.addStep} onPress={() => setEditing({ ...editing, steps: [...editing.steps, { delay_minutes: 1440, subject: "", html: "" }] })}>
          <MaterialCommunityIcons name="plus" size={16} color={colors.brandPrimary} />
          <Text style={styles.addStepText}>Add step</Text>
        </Pressable>
      </Editor>
    );
  }
  return (
    <View>
      <Pressable testID="email-new-automation" style={styles.addBtn} onPress={() => setEditing(blank)}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.addBtnText}>New automation</Text>
      </Pressable>
      <Text style={styles.muted}>Sequences fire automatically when their trigger event happens (e.g. welcome on signup).</Text>
      {loading ? <ActivityIndicator color={colors.brandPrimary} /> : items.map((a) => (
        <View key={a.id} style={styles.card}>
          <View style={{ flex: 1 }}>
            <View style={styles.rowWrap}>
              <Text style={styles.cardTitle}>{a.name}</Text>
              <Badge text={a.trigger} color={colors.info} />
              {!a.active && <Badge text="off" color={colors.error} />}
            </View>
            <Text style={styles.cardSub}>{a.steps?.length || 0} step(s) · {a.enrolled || 0} enrolled · {a.active_runs || 0} in progress</Text>
          </View>
          <Pressable onPress={() => setEditing(a)} hitSlop={8}><MaterialCommunityIcons name="pencil" size={20} color={colors.onSurfaceSecondary} /></Pressable>
          <Pressable onPress={() => del(a)} hitSlop={8} style={{ marginLeft: spacing.md }}><MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} /></Pressable>
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------------- Broadcasts */
function BroadcastsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<any>(null);
  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([api("/admin/email/campaigns"), api("/admin/email/segments")]);
      setItems(c); setSegments(s.segments || []);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const blank = { name: "", segment: "All Users", subject: "", html: "" };
  const create = async () => {
    if (!creating.name || !creating.subject) { Alert.alert("Email", "Name and subject required."); return; }
    await api("/admin/email/campaigns", { method: "POST", body: creating });
    setCreating(null); load();
  };
  const send = (c: any) => {
    const seg = segments.find((s) => s.name === c.segment);
    Alert.alert("Send broadcast", `Send "${c.name}" to ${seg?.count ?? "?"} contacts in "${c.segment}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Send", onPress: async () => { try { const r = await api(`/admin/email/campaigns/${c.id}/send`, { method: "POST" }); Alert.alert("Email", `Queued ${r.queued} emails.`); load(); } catch (e: any) { Alert.alert("Email", e?.message || "Failed"); } } },
    ]);
  };
  const del = (c: any) => Alert.alert("Delete", `Delete "${c.name}"?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { await api(`/admin/email/campaigns/${c.id}`, { method: "DELETE" }); load(); } },
  ]);

  if (creating) {
    return (
      <Editor title="New broadcast" onCancel={() => setCreating(null)} onSave={create} saveLabel="Save draft">
        <Field label="Campaign name" value={creating.name} onChange={(v) => setCreating({ ...creating, name: v })} />
        <Text style={styles.fieldLabel}>Audience segment</Text>
        <View style={styles.rowWrap}>
          {segments.map((s) => (
            <Pressable key={s.name} style={[styles.chip, creating.segment === s.name && styles.chipOn]} onPress={() => setCreating({ ...creating, segment: s.name })}>
              <Text style={[styles.chipText, creating.segment === s.name && { color: colors.onBrandPrimary }]}>{s.name} ({s.count})</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Subject" value={creating.subject} onChange={(v) => setCreating({ ...creating, subject: v })} />
        <Field label="Body (HTML — {{name}}, {{app_url}})" value={creating.html} onChange={(v) => setCreating({ ...creating, html: v })} multiline />
      </Editor>
    );
  }
  return (
    <View>
      <Pressable testID="email-new-broadcast" style={styles.addBtn} onPress={() => setCreating(blank)}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.addBtnText}>New broadcast</Text>
      </Pressable>
      {loading ? <ActivityIndicator color={colors.brandPrimary} /> : items.map((c) => (
        <View key={c.id} style={styles.card}>
          <View style={{ flex: 1 }}>
            <View style={styles.rowWrap}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Badge text={c.status} color={c.status === "sent" ? colors.success : colors.onSurfaceTertiary} />
            </View>
            <Text style={styles.cardSub} numberOfLines={1}>To {c.segment} · {c.subject}{c.status === "sent" ? ` · ${c.stats?.queued || 0} queued` : ""}</Text>
          </View>
          {c.status !== "sent" && <Pressable onPress={() => send(c)} hitSlop={8} style={styles.sendBtn}><MaterialCommunityIcons name="send" size={16} color={colors.onBrandPrimary} /></Pressable>}
          <Pressable onPress={() => del(c)} hitSlop={8} style={{ marginLeft: spacing.md }}><MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} /></Pressable>
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------------- Suppression */
function SuppressionTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const load = useCallback(async () => {
    try { setItems(await api("/admin/email/suppression")); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!email.trim()) return;
    await api("/admin/email/suppression", { method: "POST", body: { email: email.trim(), reason: "manual" } });
    setEmail(""); load();
  };
  const remove = async (e: string) => {
    const b64 = btoa(e).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await api(`/admin/email/suppression/${b64}`, { method: "DELETE" }); load();
  };
  return (
    <View>
      <Text style={styles.muted}>Bounced, complained and unsubscribed addresses never receive mail. Protects your sender reputation.</Text>
      <View style={styles.suppressRow}>
        <TextInput style={styles.suppressInput} placeholder="email@to-suppress.com" placeholderTextColor={colors.onSurfaceTertiary} value={email} onChangeText={setEmail} autoCapitalize="none" />
        <Pressable style={styles.addBtnSm} onPress={add}><Text style={styles.addBtnText}>ADD</Text></Pressable>
      </View>
      {loading ? <ActivityIndicator color={colors.brandPrimary} /> : items.length === 0 ? <Text style={styles.muted}>No suppressed addresses.</Text> : items.map((s) => (
        <View key={s.email} style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{s.email}</Text>
            <Text style={styles.cardSub}>{s.reason}</Text>
          </View>
          <Pressable onPress={() => remove(s.email)} hitSlop={8}><MaterialCommunityIcons name="close" size={20} color={colors.onSurfaceSecondary} /></Pressable>
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------------- shared bits */
function Editor({ title, children, onCancel, onSave, saveLabel = "Save" }: any) {
  return (
    <View>
      <View style={styles.rowBetween}>
        <Text style={styles.editorTitle}>{title}</Text>
        <Pressable onPress={onCancel}><Text style={styles.cancel}>Cancel</Text></Pressable>
      </View>
      {children}
      <Pressable testID="email-editor-save" style={styles.saveBtn} onPress={onSave}>
        <Text style={styles.addBtnText}>{saveLabel}</Text>
      </Pressable>
    </View>
  );
}
function Field({ label, value, onChange, multiline, keyboardType }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textarea]}
        value={value} onChangeText={onChange} multiline={multiline} keyboardType={keyboardType}
        placeholderTextColor={colors.onSurfaceTertiary}
      />
    </View>
  );
}
function Badge({ text, color }: { text: string; color: string }) {
  return <View style={[styles.badge, { borderColor: color }]}><Text style={[styles.badgeText, { color }]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 30 },
  tabs: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  tab: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabOn: { borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  body: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  muted: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, marginBottom: spacing.lg },
  bannerText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { width: "31%", minWidth: 100, flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, gap: 2 },
  statNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 26 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, marginBottom: spacing.lg },
  addBtnSm: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  addBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  rowWrap: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  badge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  editorTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  cancel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.base },
  fieldLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  textarea: { minHeight: 120, textAlignVertical: "top" },
  chip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  stepBox: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  stepTitle: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base },
  addStep: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.brandPrimary, borderWidth: 1.5, borderStyle: "dashed" },
  addStepText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  saveBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center", marginTop: spacing.lg },
  sendBtn: { backgroundColor: colors.brandPrimary, width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  suppressRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  suppressInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
});
