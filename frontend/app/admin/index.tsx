import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, useWindowDimensions, TextInput } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Mod = "overview" | "feedback" | "tickets" | "blog";
const MODULES: { key: Mod; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "view-dashboard-outline" },
  { key: "feedback", label: "Feedback", icon: "message-alert-outline" },
  { key: "tickets", label: "Support Tickets", icon: "ticket-outline" },
  { key: "blog", label: "Blog Curation", icon: "book-edit-outline" },
];

const FB_STATUS = ["new", "in_progress", "planned", "done", "declined"];
const TK_STATUS = ["open", "in_progress", "closed"];
const STATUS_COLOR: Record<string, string> = {
  new: "#FF6A00", open: "#FF6A00", in_progress: "#2F80ED", planned: "#9B51E0", done: "#27AE60", closed: "#27AE60", declined: "#888",
};

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
        {wide && (
          <Pressable testID="admin-exit" style={styles.exit} onPress={() => router.replace("/(tabs)")}>
            <MaterialCommunityIcons name="logout-variant" size={18} color={colors.onSurfaceTertiary} />
            <Text style={styles.navText}>Back to app</Text>
          </Pressable>
        )}
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {mod === "overview" && <Overview />}
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
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setData(await api("/admin/overview")); } catch {} finally { setLoading(false); } }, []);
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
  const update = async (id: string, status: string) => { await api(`/admin/feedback/${id}`, { method: "PATCH", body: { status } }); load(); };
  const remove = async (id: string) => { await api(`/admin/feedback/${id}`, { method: "DELETE" }); load(); };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ModuleHeader title="Feedback & Suggestions" onRefresh={load} />
      <View style={styles.filterRow}>
        {["all", ...FB_STATUS].map((s) => {
          const on = (s === "all" && !filter) || s === filter;
          return <Pressable key={s} testID={`fb-filter-${s}`} style={[styles.filterChip, on && styles.filterOn]} onPress={() => setFilter(s === "all" ? null : s)}><Text style={[styles.filterText, on && { color: colors.onBrandPrimary }]}>{s.replace("_", " ")}</Text></Pressable>;
        })}
      </View>
      {loading ? <Center /> : items.length === 0 ? <Text style={styles.empty}>No feedback in this view.</Text> :
        items.map((f) => (
          <View key={f.id} style={styles.card} testID={`fb-${f.id}`}>
            <View style={styles.cardTop}>
              <Text style={[styles.typeBadge, { backgroundColor: f.type === "bug" ? "#EB5757" : f.type === "feature" ? "#2F80ED" : "#888" }]}>{f.type}</Text>
              <Text style={styles.cardMeta}>{f.user_email || "anon"}</Text>
              <Pressable testID={`fb-del-${f.id}`} onPress={() => remove(f.id)} hitSlop={8}><MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.onSurfaceTertiary} /></Pressable>
            </View>
            <Text style={styles.cardBody}>{f.message}</Text>
            <StatusPicker value={f.status} options={FB_STATUS} onChange={(s) => update(f.id, s)} />
          </View>
        ))}
    </ScrollView>
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
});
