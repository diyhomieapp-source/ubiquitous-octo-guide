import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, useWindowDimensions, TextInput } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { CrmModule } from "@/src/components/admin/CrmModule";
import { VendorsModule } from "@/src/components/admin/VendorsModule";
import { EmailModule } from "@/src/components/admin/EmailModule";
import { AffiliateModule } from "@/src/components/admin/AffiliateModule";
import { FinanceModule } from "@/src/components/admin/FinanceModule";
import { ProLeadsModule } from "@/src/components/admin/ProLeadsModule";
import { ProAccountsModule } from "@/src/components/admin/ProAccountsModule";
import { NotificationsModule } from "@/src/components/admin/NotificationsModule";
import { AutomationModule } from "@/src/components/admin/AutomationModule";
import { SuppliersModule } from "@/src/components/admin/SuppliersModule";
import { FeaturesModule } from "@/src/components/admin/FeaturesModule";
import { CredentialsModule } from "@/src/components/admin/CredentialsModule";
import { PartnersModule } from "@/src/components/admin/PartnersModule";
import { PromptLibraryModule } from "@/src/components/admin/PromptLibraryModule";
import { KitsModule } from "@/src/components/admin/KitsModule";

type Mod = "overview" | "finance" | "crm" | "vendors" | "suppliers" | "kits" | "proleads" | "proaccounts" | "credentials" | "partners" | "prompts" | "notifications" | "automations" | "features" | "email" | "affiliate" | "feedback" | "tickets" | "blog";
const MODULES: { key: Mod; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "view-dashboard-outline" },
  { key: "finance", label: "CFO Dashboard", icon: "finance" },
  { key: "crm", label: "CRM / Contacts", icon: "account-multiple-outline" },
  { key: "email", label: "Email Marketing", icon: "email-fast-outline" },
  { key: "affiliate", label: "Affiliate Widget", icon: "cart-percent" },
  { key: "vendors", label: "Vendors", icon: "domain" },
  { key: "suppliers", label: "Wholesalers & RFQs", icon: "truck-delivery-outline" },
  { key: "kits", label: "Project Kits", icon: "package-variant-closed" },
  { key: "proleads", label: "Pro Leads", icon: "account-hard-hat" },
  { key: "proaccounts", label: "Pro Accounts", icon: "briefcase-check-outline" },
  { key: "credentials", label: "Credential Checks", icon: "certificate-outline" },
  { key: "partners", label: "Partner Platform", icon: "api" },
  { key: "prompts", label: "AI Prompt Library", icon: "robot-happy-outline" },
  { key: "notifications", label: "Broadcast", icon: "bullhorn-outline" },
  { key: "automations", label: "Automations", icon: "robot-outline" },
  { key: "features", label: "Feature Flags", icon: "flask-outline" },
  { key: "feedback", label: "Feedback", icon: "message-alert-outline" },
  { key: "tickets", label: "Support Tickets", icon: "ticket-outline" },
  { key: "blog", label: "Blog Curation", icon: "book-edit-outline" },
];

const FB_STATUS = ["new", "in_progress", "planned", "done", "declined"];
const TK_STATUS = ["open", "in_progress", "closed"];
const STATUS_COLOR: Record<string, string> = {
  new: "#FF6A00", open: "#FF6A00", in_progress: "#2F80ED", planned: "#9B51E0", done: "#27AE60", closed: "#27AE60", declined: "#888",
};
const FB_PRIORITY = ["low", "medium", "high"];
const PRIORITY_COLOR: Record<string, string> = { low: "#888", medium: "#2F80ED", high: "#EB5757" };

const usd = (cents: number) => `$${Math.round((cents || 0) / 100).toLocaleString()}`;

async function downloadCsv(path: string, filename: string) {
  try {
    const token = await getToken();
    const res = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    if (typeof document !== "undefined") {
      const blob = new Blob([text], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }
  } catch {}
}

export default function AdminWorkstation() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [mod, setMod] = useState<Mod>("overview");

  return (
    <View style={[styles.root, wide && { flexDirection: "row" }]}>
      {/* Sidebar */}
      <View style={[styles.sidebar, !wide && styles.sidebarNarrow]}>
        <View style={styles.brandRow}>
          <View style={styles.logo}><MaterialCommunityIcons name="shield-crown-outline" size={20} color={colors.onBrandPrimary} /></View>
          {wide && <Text style={styles.brand}>WORKSTATION</Text>}
        </View>
        <ScrollView horizontal={!wide} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} contentContainerStyle={!wide && { gap: spacing.sm, paddingHorizontal: spacing.md }}>
          {MODULES.map((m) => {
            const on = mod === m.key;
            return (
              <Pressable key={m.key} testID={`admin-nav-${m.key}`} style={[styles.navItem, !wide && styles.navItemNarrow, on && styles.navItemOn]} onPress={() => setMod(m.key)}>
                <MaterialCommunityIcons name={m.icon as any} size={20} color={on ? colors.brandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.navText, on && { color: colors.onSurface }]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable testID="admin-exit" style={[styles.exit, !wide && styles.exitNarrow]} onPress={() => router.replace("/(tabs)")}>
          <MaterialCommunityIcons name="logout-variant" size={18} color={colors.onSurfaceTertiary} />
          {wide && <Text style={styles.navText}>Back to app</Text>}
        </Pressable>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {mod === "overview" && <Overview />}
        {mod === "finance" && <FinanceModule />}
        {mod === "crm" && <CrmModule />}
        {mod === "email" && <EmailModule />}
        {mod === "affiliate" && <AffiliateModule />}
        {mod === "vendors" && <VendorsModule />}
        {mod === "suppliers" && <SuppliersModule />}
        {mod === "kits" && <KitsModule />}
        {mod === "proleads" && <ProLeadsModule />}
        {mod === "proaccounts" && <ProAccountsModule />}
        {mod === "credentials" && <CredentialsModule />}
        {mod === "partners" && <PartnersModule />}
        {mod === "prompts" && <PromptLibraryModule />}
        {mod === "notifications" && <NotificationsModule />}
        {mod === "automations" && <AutomationModule />}
        {mod === "features" && <FeaturesModule />}
        {mod === "feedback" && <Feedback />}
        {mod === "tickets" && <Tickets />}
        {mod === "blog" && <Blog />}
      </View>
    </View>
  );
}

function ModuleHeader({ title, onRefresh }: { title: string; onRefresh: () => void }) {
  return (
    <View style={styles.modHead}>
      <Text style={styles.modTitle}>{title}</Text>
      <Pressable testID="admin-refresh" onPress={onRefresh} hitSlop={8}><MaterialCommunityIcons name="refresh" size={22} color={colors.onSurface} /></Pressable>
    </View>
  );
}

function StatusPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (s: string) => void }) {
  return (
    <View style={styles.statusRow}>
      {options.map((s) => {
        const on = s === value;
        return (
          <Pressable key={s} testID={`status-${s}`} style={[styles.statusChip, on && { backgroundColor: STATUS_COLOR[s] || colors.brandPrimary, borderColor: STATUS_COLOR[s] || colors.brandPrimary }]} onPress={() => onChange(s)}>
            <Text style={[styles.statusText, on && { color: "#fff" }]}>{s.replace("_", " ")}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Overview() {
  const [data, setData] = useState<any>(null);
  const [rev, setRev] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const [o, r] = await Promise.all([api("/admin/overview"), api("/admin/revenue")]); setData(o); setRev(r); } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (loading || !data) return <Center />;
  const c = data.counts || {};
  const stats = [
    { label: "Users", value: c.users, icon: "account-group" },
    { label: "Projects", value: c.projects, icon: "clipboard-list" },
    { label: "Guides built", value: c.guides, icon: "file-document-check" },
    { label: "Paid subs", value: c.paid_subscribers, icon: "credit-card-check" },
    { label: "Blog posts", value: c.blog_posts, icon: "book-open-variant" },
    { label: "Open tickets", value: (data.tickets?.open || 0), icon: "ticket" },
  ];
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ModuleHeader title="Overview" onRefresh={load} />
      {rev && (
        <View style={styles.revCard}>
          <Text style={styles.revLabel}>MONTHLY RECURRING REVENUE</Text>
          <Text style={styles.revMrr}>{usd(rev.mrr_cents)}<Text style={styles.revPer}> /mo</Text></Text>
          <Text style={styles.revArr}>{usd(rev.arr_cents)} / yr projected · {rev.free_users} free users</Text>
          {rev.by_tier.map((t: any) => (
            <View key={t.tier} style={styles.revRow}>
              <Text style={styles.revTier}>{t.label}</Text>
              <Text style={styles.revCount}>{t.count} × {usd(t.price_cents)}</Text>
              <Text style={styles.revSub}>{usd(t.subtotal_cents)}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.statGrid}>
        {stats.map((s) => (
          <View key={s.label} style={styles.statCard}>
            <MaterialCommunityIcons name={s.icon as any} size={22} color={colors.brandPrimary} />
            <Text style={styles.statValue}>{s.value ?? 0}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sub}>Recent feedback</Text>
      {(data.recent_feedback || []).length === 0 ? <Text style={styles.empty}>No feedback yet.</Text> :
        data.recent_feedback.map((f: any) => (
          <View key={f.id} style={styles.row}><Text style={styles.rowType}>{f.type}</Text><Text style={styles.rowMsg} numberOfLines={1}>{f.message}</Text></View>
        ))}
    </ScrollView>
  );
}

function Feedback() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api<{ items: any[] }>(`/admin/feedback${filter ? `?status=${filter}` : ""}`); setItems(r.items); } catch {} finally { setLoading(false); }
  }, [filter]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ModuleHeader title="Feedback & Suggestions" onRefresh={load} />
      <Pressable testID="fb-export" style={styles.exportBtn} onPress={() => downloadCsv("/admin/feedback/export.csv", "feedback.csv")}>
        <MaterialCommunityIcons name="download" size={16} color={colors.brandPrimary} />
        <Text style={styles.exportText}>Export CSV</Text>
      </Pressable>
      <View style={styles.filterRow}>
        {["all", ...FB_STATUS].map((s) => {
          const on = (s === "all" && !filter) || s === filter;
          return <Pressable key={s} testID={`fb-filter-${s}`} style={[styles.filterChip, on && styles.filterOn]} onPress={() => setFilter(s === "all" ? null : s)}><Text style={[styles.filterText, on && { color: colors.onBrandPrimary }]}>{s.replace("_", " ")}</Text></Pressable>;
        })}
      </View>
      {loading ? <Center /> : items.length === 0 ? <Text style={styles.empty}>No feedback in this view.</Text> :
        items.map((f) => <FeedbackCard key={f.id} item={f} reload={load} />)}
    </ScrollView>
  );
}

function FeedbackCard({ item, reload }: { item: any; reload: () => void }) {
  const [note, setNote] = useState(item.note || "");
  const [savedNote, setSavedNote] = useState(false);
  const setField = async (body: any) => { try { await api(`/admin/feedback/${item.id}`, { method: "PATCH", body }); reload(); } catch {} };
  const saveNote = async () => { try { await api(`/admin/feedback/${item.id}`, { method: "PATCH", body: { note } }); setSavedNote(true); setTimeout(() => setSavedNote(false), 1500); } catch {} };
  const remove = async () => { try { await api(`/admin/feedback/${item.id}`, { method: "DELETE" }); reload(); } catch {} };
  return (
    <View style={styles.card} testID={`fb-${item.id}`}>
      <View style={styles.cardTop}>
        <Text style={[styles.typeBadge, { backgroundColor: item.type === "bug" ? "#EB5757" : item.type === "feature" ? "#2F80ED" : "#888" }]}>{item.type}</Text>
        <Text style={styles.cardMeta}>{item.user_email || "anon"}</Text>
        <Pressable testID={`fb-del-${item.id}`} onPress={remove} hitSlop={8}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
      </View>
      <Text style={styles.cardBody}>{item.message}</Text>
      <Text style={styles.miniLabel}>STATUS</Text>
      <StatusPicker value={item.status} options={FB_STATUS} onChange={(s) => setField({ status: s })} />
      <Text style={styles.miniLabel}>PRIORITY</Text>
      <View style={styles.statusRow}>
        {FB_PRIORITY.map((p) => {
          const on = p === (item.priority || "medium");
          return <Pressable key={p} testID={`prio-${p}-${item.id}`} style={[styles.statusChip, on && { backgroundColor: PRIORITY_COLOR[p], borderColor: PRIORITY_COLOR[p] }]} onPress={() => setField({ priority: p })}><Text style={[styles.statusText, on && { color: "#fff" }]}>{p}</Text></Pressable>;
        })}
      </View>
      <Text style={styles.miniLabel}>INTERNAL NOTE</Text>
      <TextInput testID={`fb-note-${item.id}`} style={styles.noteInput} value={note} onChangeText={setNote} placeholder="Private note for your team…" placeholderTextColor={colors.onSurfaceTertiary} multiline />
      <Pressable testID={`fb-note-save-${item.id}`} style={styles.noteSave} onPress={saveNote}><Text style={styles.noteSaveText}>{savedNote ? "Saved ✓" : "Save note"}</Text></Pressable>
    </View>
  );
}

function Tickets() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const r = await api<{ items: any[] }>("/admin/tickets"); setItems(r.items); } catch {} finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const update = async (id: string, status: string) => { await api(`/admin/tickets/${id}`, { method: "PATCH", body: { status } }); load(); };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ModuleHeader title="Support Tickets" onRefresh={load} />
      <Pressable testID="tk-export" style={styles.exportBtn} onPress={() => downloadCsv("/admin/tickets/export.csv", "tickets.csv")}>
        <MaterialCommunityIcons name="download" size={16} color={colors.brandPrimary} />
        <Text style={styles.exportText}>Export CSV</Text>
      </Pressable>
      {loading ? <Center /> : items.length === 0 ? <Text style={styles.empty}>No tickets.</Text> :
        items.map((t) => (
          <View key={t.id} style={styles.card} testID={`tk-${t.id}`}>
            <View style={styles.cardTop}>
              <Text style={styles.ticketCat}>{t.category}</Text>
              <Text style={styles.cardMeta}>{t.email}</Text>
            </View>
            <Text style={styles.cardSubject}>{t.subject}</Text>
            <Text style={styles.cardBody}>{t.message}</Text>
            <StatusPicker value={t.status} options={TK_STATUS} onChange={(s) => update(t.id, s)} />
          </View>
        ))}
    </ScrollView>
  );
}

function Blog() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const r = await api<{ items: any[] }>("/admin/blog"); setItems(r.items); } catch {} finally { setLoading(false); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const toggle = async (slug: string, published: boolean) => { await api(`/admin/blog/${slug}`, { method: "PATCH", body: { published } }); load(); };
  const remove = async (slug: string) => { await api(`/admin/blog/${slug}`, { method: "DELETE" }); load(); };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ModuleHeader title="Blog Curation" onRefresh={load} />
      {loading ? <Center /> : items.length === 0 ? <Text style={styles.empty}>No posts yet.</Text> :
        items.map((p) => (
          <View key={p.slug} style={styles.card} testID={`blog-${p.slug}`}>
            <View style={styles.cardTop}>
              <Text style={[styles.typeBadge, { backgroundColor: p.published ? "#27AE60" : "#888" }]}>{p.published ? "live" : "draft"}</Text>
              <Text style={styles.cardMeta}>{p.category} · {p.views || 0} views</Text>
              <Pressable testID={`blog-del-${p.slug}`} onPress={() => remove(p.slug)} hitSlop={8}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
            </View>
            <Text style={styles.cardSubject}>{p.title}</Text>
            <Text style={styles.cardBody} numberOfLines={2}>{p.excerpt}</Text>
            <Pressable testID={`blog-toggle-${p.slug}`} style={styles.toggleBtn} onPress={() => toggle(p.slug, !p.published)}>
              <Text style={styles.toggleText}>{p.published ? "Unpublish" : "Publish"}</Text>
            </Pressable>
          </View>
        ))}
    </ScrollView>
  );
}

function Center() { return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  sidebar: { width: 220, backgroundColor: colors.surfaceSecondary, borderRightColor: colors.border, borderRightWidth: 1, paddingTop: 50, paddingBottom: spacing.lg },
  sidebarNarrow: { width: "100%", paddingTop: 50, paddingBottom: spacing.sm, borderRightWidth: 0, borderBottomColor: colors.border, borderBottomWidth: 1 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  logo: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  brand: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1 },
  navItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.sm },
  navItemNarrow: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingVertical: spacing.sm },
  navItemOn: { backgroundColor: colors.surface, borderLeftColor: colors.brandPrimary, borderLeftWidth: 3 },
  navText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.base },
  exit: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: "auto" },
  exitNarrow: { marginTop: 0, position: "absolute", top: 50, right: spacing.md },
  content: { padding: spacing.lg, paddingBottom: spacing["3xl"], maxWidth: 900, width: "100%", alignSelf: "center" },
  modHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  modTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 0.5 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.xl },
  statCard: { flexGrow: 1, minWidth: 140, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 30 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.5, marginBottom: spacing.sm, marginTop: spacing.md },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, marginTop: spacing.md },
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  rowType: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, width: 64 },
  rowMsg: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  filterChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  filterOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  typeBadge: { color: "#fff", fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: "hidden", textTransform: "uppercase" },
  cardMeta: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
  cardSubject: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.xs },
  cardBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, marginBottom: spacing.md },
  ticketCat: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  statusChip: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  statusText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm, textTransform: "capitalize" },
  toggleBtn: { alignSelf: "flex-start", backgroundColor: colors.surface, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  toggleText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  center: { padding: 60, alignItems: "center" },
  revCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.xl },
  revLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1.5 },
  revMrr: { color: colors.onSurface, fontFamily: font.display, fontSize: 40, marginTop: spacing.xs },
  revPer: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.lg },
  revArr: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginBottom: spacing.md },
  revRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.xs, borderTopColor: colors.border, borderTopWidth: 1 },
  revTier: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  revCount: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginRight: spacing.md },
  revSub: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base, width: 80, textAlign: "right" },
  exportBtn: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: spacing.xs, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
  exportText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },
  miniLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 1.2, marginTop: spacing.md, marginBottom: spacing.xs },
  noteInput: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, minHeight: 56, textAlignVertical: "top", color: colors.onSurface, fontFamily: font.regular, fontSize: type.sm },
  noteSave: { alignSelf: "flex-start", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.xs },
  noteSaveText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.sm },
});
