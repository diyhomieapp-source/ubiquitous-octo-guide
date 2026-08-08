import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Tab = "dashboard" | "users" | "templates" | "safety" | "support" | "flags" | "admins" | "audit";
const TABS: { key: Tab; label: string; icon: string; perm?: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "view-dashboard-outline", perm: "dashboard.read" },
  { key: "users", label: "Users", icon: "account-multiple-outline", perm: "users.read" },
  { key: "templates", label: "Content", icon: "file-document-edit-outline", perm: "content.read" },
  { key: "safety", label: "Safety", icon: "shield-alert-outline", perm: "safety.read" },
  { key: "support", label: "Support", icon: "lifebuoy", perm: "support.read" },
  { key: "flags", label: "Feature Flags", icon: "flag-outline", perm: "flags.read" },
  { key: "admins", label: "Admin Roles", icon: "shield-account-outline", perm: "*" },
  { key: "audit", label: "Audit Log", icon: "clipboard-text-clock-outline", perm: "audit.read" },
];

const TT = ["project", "maintenance", "safety", "issue", "tool_list", "material_list"];

export function HomeOpsModule() {
  const [me, setMe] = useState<{ permissions: string[]; role_label: string; is_super: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => { try { setMe(await api("/hi/admin/me")); } catch {} finally { setLoading(false); } })(); }, []);

  const can = (p?: string) => !p || me?.is_super || me?.permissions.includes(p) || me?.permissions.includes("*");
  const visibleTabs = TABS.filter((t) => can(t.perm));

  if (loading) return <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />;
  if (!me) return <Text style={styles.err}>You don&apos;t have Home Intelligence Ops access.</Text>;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.roleBar}>
        <MaterialCommunityIcons name="shield-check-outline" size={16} color={colors.brandPrimary} />
        <Text style={styles.roleText}>Signed in as {me.role_label}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}>
        {visibleTabs.map((t) => (
          <Pressable key={t.key} testID={`ops-tab-${t.key}`} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setTab(t.key)}>
            <MaterialCommunityIcons name={t.icon as any} size={16} color={tab === t.key ? colors.brandPrimary : colors.onSurfaceTertiary} />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flex: 1 }}>
        {tab === "dashboard" && <Dashboard />}
        {tab === "users" && <Users can={can} />}
        {tab === "templates" && <Templates can={can} />}
        {tab === "safety" && <Safety can={can} />}
        {tab === "support" && <Support can={can} />}
        {tab === "flags" && <Flags can={can} />}
        {tab === "admins" && <Admins />}
        {tab === "audit" && <Audit />}
      </View>
    </View>
  );
}

function Dashboard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { (async () => { try { setD(await api("/hi/admin/dashboard")); } catch {} })(); }, []);
  if (!d) return <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />;
  const c = d.cards;
  const cards = [
    { label: "Total Users", v: c.total_users, icon: "account-group" },
    { label: "Active Properties", v: c.active_properties, icon: "home-city-outline" },
    { label: "Active Projects", v: c.active_projects, icon: "hammer-wrench" },
    { label: "Open Safety", v: c.open_safety, icon: "shield-alert-outline" },
    { label: "Doc Reviews", v: c.pending_document_reviews, icon: "file-search-outline" },
    { label: "Subscriptions", v: c.active_subscriptions, icon: "star-circle-outline" },
    { label: "Open Tickets", v: c.open_support_tickets, icon: "lifebuoy" },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      <View style={styles.cardGrid}>
        {cards.map((x) => (
          <View key={x.label} style={styles.statCard}>
            <MaterialCommunityIcons name={x.icon as any} size={20} color={colors.brandPrimary} />
            <Text style={styles.statNum}>{x.v}</Text>
            <Text style={styles.statLabel}>{x.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.section}>Recent users</Text>
      {d.recent_users.map((u: any) => (
        <View key={u.id} style={styles.row}><Text style={styles.rowMain}>{u.name || u.email}</Text><Text style={styles.rowMeta}>{u.subscription_tier || "free"}</Text></View>
      ))}
      <Text style={styles.section}>Recent safety events</Text>
      {d.recent_safety.length === 0 ? <Text style={styles.empty}>None</Text> : d.recent_safety.map((s: any) => (
        <View key={s.id} style={styles.row}><Text style={styles.rowMain}>{s.trigger_type}</Text><Text style={[styles.rowMeta, { color: colors.error }]}>{s.risk_level}</Text></View>
      ))}
    </ScrollView>
  );
}

function Users({ can }: { can: (p?: string) => boolean }) {
  const [q, setQ] = useState(""); const [users, setUsers] = useState<any[]>([]); const [sel, setSel] = useState<any>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const d = await api<{ users: any[] }>(`/hi/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`); setUsers(d.users); } catch {} }, [q]);
  useEffect(() => { load(); }, [load]);
  const open = async (id: string) => { try { setSel(await api(`/hi/admin/users/${id}`)); } catch {} };
  const act = async (path: string, needReason: boolean, event: string) => {
    let body: any = {};
    if (needReason) {
      const reason = typeof prompt !== "undefined" ? prompt("Reason (required):") : "admin action";
      if (!reason || reason.length < 4) { Alert.alert("Reason required"); return; }
      body = { confirm: true, reason };
    }
    setBusy(true);
    try { await api(path, { method: "POST", body }); Alert.alert("Done", event); if (sel) open(sel.profile.id); load(); }
    catch (e: any) { Alert.alert("Failed", e?.message || "Error"); } finally { setBusy(false); }
  };
  if (sel) {
    const p = sel.profile;
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
        <Pressable onPress={() => setSel(null)} style={styles.back}><MaterialCommunityIcons name="chevron-left" size={18} color={colors.brandPrimary} /><Text style={styles.backText}>Back to users</Text></Pressable>
        <Text style={styles.detailName}>{p.name || p.email}</Text>
        <Text style={styles.rowMeta}>{p.email} · {p.subscription_tier || "free"} · {p.account_status || "active"}</Text>
        <View style={styles.cardGrid}>
          {Object.entries(sel.counts).map(([k, v]: any) => (
            <View key={k} style={styles.statCard}><Text style={styles.statNum}>{v}</Text><Text style={styles.statLabel}>{k}</Text></View>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.md }}>
          {can("users.suspend") && <Pressable testID="ops-user-suspend" style={styles.dangerBtn} disabled={busy} onPress={() => act(`/hi/admin/users/${p.id}/suspend`, true, "Suspended")}><Text style={styles.dangerText}>Suspend</Text></Pressable>}
          {can("users.restore") && <Pressable testID="ops-user-restore" style={styles.okBtn} disabled={busy} onPress={() => act(`/hi/admin/users/${p.id}/restore`, false, "Restored")}><Text style={styles.okText}>Restore</Text></Pressable>}
        </View>
        <Text style={styles.section}>Recent activity</Text>
        {sel.activity.map((a: any, i: number) => (<View key={i} style={styles.row}><Text style={styles.rowMain}>{a.event}</Text><Text style={styles.rowMeta}>{(a.at || "").slice(0, 10)}</Text></View>))}
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      <TextInput testID="ops-user-search" style={styles.input} value={q} onChangeText={setQ} placeholder="Search name or email" placeholderTextColor={colors.onSurfaceTertiary} />
      {users.map((u) => (
        <Pressable key={u.id} testID={`ops-user-${u.id}`} style={styles.row} onPress={() => open(u.id)}>
          <View style={{ flex: 1 }}><Text style={styles.rowMain}>{u.name || u.email}</Text><Text style={styles.rowMeta}>{u.email} · {u.subscription_tier || "free"}{u.account_status === "suspended" ? " · suspended" : ""}</Text></View>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Templates({ can }: { can: (p?: string) => boolean }) {
  const [items, setItems] = useState<any[]>([]); const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ template_type: "project", title: "", category: "General", content: "", safety_notes: "" });
  const load = useCallback(async () => { try { setItems((await api<{ templates: any[] }>("/hi/admin/templates")).templates); } catch {} }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => { if (!form.title.trim()) { Alert.alert("Title required"); return; } try { await api("/hi/admin/templates", { method: "POST", body: form }); setCreating(false); setForm({ template_type: "project", title: "", category: "General", content: "", safety_notes: "" }); load(); } catch (e: any) { Alert.alert("Failed", e?.message); } };
  const publish = async (id: string) => { const reason = typeof prompt !== "undefined" ? prompt("Publish reason (required):") : "reviewed"; if (!reason || reason.length < 4) { Alert.alert("Reason required"); return; } try { await api(`/hi/admin/templates/${id}/publish`, { method: "POST", body: { confirm: true, reason } }); load(); } catch (e: any) { Alert.alert("Failed", e?.message); } };
  const archive = async (id: string) => { try { await api(`/hi/admin/templates/${id}/archive`, { method: "POST", body: {} }); load(); } catch (e: any) { Alert.alert("Failed", e?.message); } };
  const SC: Record<string, string> = { draft: colors.onSurfaceTertiary, review: colors.warning, published: colors.success, archived: colors.borderStrong };
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      {can("content.write") && (creating ? (
        <View style={styles.formCard}>
          <View style={styles.chips}>{TT.map((t) => (<Pressable key={t} testID={`ops-tpl-type-${t}`} style={[styles.chip, form.template_type === t && styles.chipOn]} onPress={() => setForm({ ...form, template_type: t })}><Text style={[styles.chipText, form.template_type === t && styles.chipTextOn]}>{t}</Text></Pressable>))}</View>
          <TextInput testID="ops-tpl-title" style={styles.input} value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="Title" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput testID="ops-tpl-content" style={[styles.input, { minHeight: 70 }]} value={form.content} onChangeText={(v) => setForm({ ...form, content: v })} multiline placeholder="Instructions / content" placeholderTextColor={colors.onSurfaceTertiary} />
          <TextInput style={styles.input} value={form.safety_notes} onChangeText={(v) => setForm({ ...form, safety_notes: v })} placeholder="Safety notes (optional)" placeholderTextColor={colors.onSurfaceTertiary} />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="ops-tpl-save" style={styles.okBtn} onPress={create}><Text style={styles.okText}>Create draft</Text></Pressable>
            <Pressable style={styles.ghost} onPress={() => setCreating(false)}><Text style={styles.ghostText}>Cancel</Text></Pressable>
          </View>
        </View>
      ) : (
        <Pressable testID="ops-tpl-new" style={styles.okBtn} onPress={() => setCreating(true)}><Text style={styles.okText}>+ New template</Text></Pressable>
      ))}
      {items.map((t) => (
        <View key={t.id} style={styles.tCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={[styles.tag, { color: SC[t.status] || colors.info, borderColor: SC[t.status] || colors.info }]}>{t.status}</Text>
            <Text style={styles.rowMain}>{t.title}</Text>
          </View>
          <Text style={styles.rowMeta}>{t.template_type} · v{t.version_number}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
            {can("content.publish") && t.status !== "published" && <Pressable testID={`ops-tpl-publish-${t.id}`} style={styles.miniBtn} onPress={() => publish(t.id)}><Text style={styles.miniText}>Publish</Text></Pressable>}
            {can("content.archive") && t.status !== "archived" && <Pressable style={styles.miniGhost} onPress={() => archive(t.id)}><Text style={styles.miniGhostText}>Archive</Text></Pressable>}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Safety({ can }: { can: (p?: string) => boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(async () => { try { setItems((await api<{ escalations: any[] }>("/hi/admin/safety")).escalations); } catch {} }, []);
  useEffect(() => { load(); }, [load]);
  const review = async (id: string, status: string) => { const note = typeof prompt !== "undefined" ? prompt("Internal note (optional):") || "" : ""; try { await api(`/hi/admin/safety/${id}/review`, { method: "POST", body: { status, note } }); load(); } catch (e: any) { Alert.alert("Failed", e?.message); } };
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      <Text style={styles.disc}>Admins review flagged safety events — they do not provide emergency services or professional advice.</Text>
      {items.length === 0 ? <Text style={styles.empty}>No escalations.</Text> : items.map((s) => (
        <View key={s.id} style={styles.tCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={[styles.tag, { color: colors.error, borderColor: colors.error }]}>{s.risk_level}</Text>
            <Text style={styles.rowMeta}>{(s.created_at || "").slice(0, 16)}</Text>
          </View>
          <Text style={styles.rowMain}>{s.trigger_type}</Text>
          {s.ai_response_reference ? <Text style={styles.rowMeta} numberOfLines={2}>{s.ai_response_reference}</Text> : null}
          <Text style={[styles.rowMeta, { marginTop: 4 }]}>Status: {s.status}</Text>
          {can("safety.review") && (
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
              <Pressable style={styles.miniBtn} onPress={() => review(s.id, "resolved")}><Text style={styles.miniText}>Resolve</Text></Pressable>
              <Pressable style={styles.miniGhost} onPress={() => review(s.id, "false_positive")}><Text style={styles.miniGhostText}>False positive</Text></Pressable>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Support({ can }: { can: (p?: string) => boolean }) {
  const [items, setItems] = useState<any[]>([]); const [sel, setSel] = useState<any>(null); const [reply, setReply] = useState("");
  const load = useCallback(async () => { try { setItems((await api<{ tickets: any[] }>("/hi/admin/support")).tickets); } catch {} }, []);
  useEffect(() => { load(); }, [load]);
  const open = async (id: string) => { try { setSel(await api(`/hi/admin/support/${id}`)); } catch {} };
  const send = async () => { if (!reply.trim() || !sel) return; try { await api(`/hi/admin/support/${sel.ticket.id}/reply`, { method: "POST", body: { message: reply } }); setReply(""); open(sel.ticket.id); } catch (e: any) { Alert.alert("Failed", e?.message); } };
  const setStatus = async (status: string) => { if (!sel) return; try { await api(`/hi/admin/support/${sel.ticket.id}`, { method: "PUT", body: { status } }); open(sel.ticket.id); load(); } catch {} };
  if (sel) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
        <Pressable onPress={() => setSel(null)} style={styles.back}><MaterialCommunityIcons name="chevron-left" size={18} color={colors.brandPrimary} /><Text style={styles.backText}>Back</Text></Pressable>
        <Text style={styles.detailName}>{sel.ticket.subject}</Text>
        <Text style={styles.rowMeta}>{sel.ticket.category} · {sel.ticket.priority} · {sel.ticket.status}</Text>
        {sel.messages.map((m: any) => (
          <View key={m.id} style={[styles.msg, m.sender_type === "admin" ? styles.msgAdmin : styles.msgUser]}>
            <Text style={styles.msgWho}>{m.sender_type}</Text><Text style={styles.rowMain}>{m.message}</Text>
          </View>
        ))}
        {can("support.reply") && (
          <>
            <TextInput style={[styles.input, { minHeight: 60 }]} value={reply} onChangeText={setReply} multiline placeholder="Reply…" placeholderTextColor={colors.onSurfaceTertiary} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Pressable testID="ops-ticket-reply" style={styles.okBtn} onPress={send}><Text style={styles.okText}>Send reply</Text></Pressable>
              <Pressable style={styles.miniGhost} onPress={() => setStatus("resolved")}><Text style={styles.miniGhostText}>Resolve</Text></Pressable>
            </View>
          </>
        )}
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      {items.length === 0 ? <Text style={styles.empty}>No tickets.</Text> : items.map((t) => (
        <Pressable key={t.id} testID={`ops-ticket-${t.id}`} style={styles.row} onPress={() => open(t.id)}>
          <View style={{ flex: 1 }}><Text style={styles.rowMain}>{t.subject}</Text><Text style={styles.rowMeta}>{t.category} · {t.priority} · {t.status}</Text></View>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Flags({ can }: { can: (p?: string) => boolean }) {
  const [flags, setFlags] = useState<any[]>([]);
  const load = useCallback(async () => { try { setFlags((await api<{ flags: any[] }>("/hi/admin/flags")).flags); } catch {} }, []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (f: any) => {
    const next = !f.enabled; let body: any = { enabled: next };
    if (!next && f.environment === "production") { const reason = typeof prompt !== "undefined" ? prompt("Reason to disable (required):") : ""; if (!reason || reason.length < 4) { Alert.alert("Reason required"); return; } body = { enabled: next, confirm: true, reason }; }
    try { await api(`/hi/admin/flags/${f.feature_key}`, { method: "PUT", body }); load(); } catch (e: any) { Alert.alert("Failed", e?.message); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      {flags.map((f) => (
        <View key={f.feature_key} style={styles.row}>
          <View style={{ flex: 1 }}><Text style={styles.rowMain}>{f.name}</Text><Text style={styles.rowMeta}>{f.environment} · {f.enabled ? "on" : "off"}</Text></View>
          {can("flags.write") && (
            <Pressable testID={`ops-flag-${f.feature_key}`} style={[styles.toggle, f.enabled && styles.toggleOn]} onPress={() => toggle(f)}>
              <Text style={[styles.toggleText, f.enabled && { color: colors.onBrandPrimary }]}>{f.enabled ? "ON" : "OFF"}</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Admins() {
  const [data, setData] = useState<any>(null); const [email, setEmail] = useState(""); const [role, setRole] = useState("support_admin");
  const load = useCallback(async () => { try { setData(await api("/hi/admin/admins")); } catch {} }, []);
  useEffect(() => { load(); }, [load]);
  const assign = async () => { if (!email.trim()) { Alert.alert("Email required"); return; } try { await api("/hi/admin/admins", { method: "POST", body: { user_email: email.trim(), admin_role: role } }); setEmail(""); load(); } catch (e: any) { Alert.alert("Failed", e?.message); } };
  const remove = async (uid: string) => { try { await api(`/hi/admin/admins/${uid}`, { method: "DELETE" }); load(); } catch (e: any) { Alert.alert("Failed", e?.message); } };
  if (!data) return <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />;
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      <View style={styles.formCard}>
        <TextInput testID="ops-admin-email" style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="user@email.com" placeholderTextColor={colors.onSurfaceTertiary} />
        <View style={styles.chips}>{data.roles.map((rr: any) => (<Pressable key={rr.key} testID={`ops-role-${rr.key}`} style={[styles.chip, role === rr.key && styles.chipOn]} onPress={() => setRole(rr.key)}><Text style={[styles.chipText, role === rr.key && styles.chipTextOn]}>{rr.label}</Text></Pressable>))}</View>
        <Pressable testID="ops-admin-assign" style={styles.okBtn} onPress={assign}><Text style={styles.okText}>Assign role</Text></Pressable>
      </View>
      {data.admins.map((a: any) => (
        <View key={a.user_id} style={styles.row}>
          <View style={{ flex: 1 }}><Text style={styles.rowMain}>{a.name || a.email || a.user_id}</Text><Text style={styles.rowMeta}>{a.role_label}</Text></View>
          <Pressable style={styles.miniGhost} onPress={() => remove(a.user_id)}><Text style={styles.miniGhostText}>Remove</Text></Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function Audit() {
  const [entries, setEntries] = useState<any[]>([]);
  useEffect(() => { (async () => { try { setEntries((await api<{ entries: any[] }>("/hi/admin/audit")).entries); } catch {} })(); }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing["2xl"] }}>
      <Text style={styles.disc}>Immutable, hash-chained record of admin actions.</Text>
      {entries.map((e) => (
        <View key={e.id} style={styles.tCard}>
          <Text style={styles.rowMain}>{e.action_type}</Text>
          <Text style={styles.rowMeta}>{e.target_entity_type} · {(e.created_at || "").slice(0, 16)}</Text>
          {e.reason ? <Text style={styles.rowMeta}>Reason: {e.reason}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  err: { color: colors.error, fontFamily: font.medium, fontSize: type.base, padding: spacing.lg },
  roleBar: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  roleText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  tabBar: { flexGrow: 0, marginBottom: spacing.sm },
  tab: { flexDirection: "row", alignItems: "center", gap: 4, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  tabOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  tabTextOn: { color: colors.brandPrimary },
  cardGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { width: "31%", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  statNum: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl, marginTop: 2 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 10, textAlign: "center", marginTop: 2, textTransform: "capitalize" },
  section: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: spacing.md },
  disc: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  rowMain: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  rowMeta: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, marginBottom: spacing.sm },
  back: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  backText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  detailName: { color: colors.onSurface, fontFamily: font.display, fontSize: type.xl, marginBottom: 2 },
  dangerBtn: { backgroundColor: colors.error, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  dangerText: { color: colors.onError, fontFamily: font.bold, fontSize: type.sm },
  okBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: "center" },
  okText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  ghost: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  ghostText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  formCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  chipOn: { backgroundColor: colors.brandPrimary + "22", borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  chipTextOn: { color: colors.brandPrimary },
  tCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  tag: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase", overflow: "hidden" },
  miniBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  miniText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  miniGhost: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  miniGhostText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  toggle: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5, minWidth: 52, alignItems: "center" },
  toggleOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  toggleText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  msg: { borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm },
  msgAdmin: { backgroundColor: colors.brandPrimary + "18", borderColor: colors.brandPrimary + "55", borderWidth: 1 },
  msgUser: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  msgWho: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, textTransform: "uppercase", marginBottom: 2 },
});
