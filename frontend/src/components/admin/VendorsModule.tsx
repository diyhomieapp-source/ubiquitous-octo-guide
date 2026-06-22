import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Modal } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const usd = (c?: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;
const IMP_COLOR: Record<string, string> = { critical: "#EB5757", high: "#FF8A50", medium: "#2F80ED", low: "#888" };
const CATEGORIES = [
  "AI Platforms", "Avatar Platforms", "Image Generation", "Hosting", "Voice AI", "Databases",
  "Payment Systems", "Email Providers", "Marketing Platforms", "Analytics", "Security",
  "Community Platforms", "Storage Providers", "Video Platforms", "Authentication", "Maps",
  "CAD and Blueprint Platforms", "Customer Support", "Legal Services", "Accounting",
  "Automation Platforms", "Social Media Tools", "Project Management Tools", "Other",
];

type Vendor = any;

const EMPTY: Vendor = { company: "", category: "Other", importance: "medium", website: "", dashboard_url: "", api_docs_url: "", billing_url: "", monthly_cost_cents: 0, annual_cost_cents: 0, renewal_date: "", plan_type: "", account_owner: "", email_used: "", support_email: "", phone: "", affiliate_link: "", feature_description: "", importance_note: "", notes: "", doc: {} };

export function VendorsModule() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (category) params.set("category", category);
      const [v, s] = await Promise.all([api(`/admin/vendors?${params.toString()}`), api("/admin/vendors/stats")]);
      setVendors(v); setStats(s);
    } catch {} finally { setLoading(false); }
  }, [search, category]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const STAT_CARDS = stats ? [
    { label: "VENDORS", value: stats.total, icon: "domain" },
    { label: "MONTHLY", value: usd(stats.monthly_spend_cents), icon: "calendar-month" },
    { label: "ANNUAL", value: usd(stats.annual_spend_cents), icon: "calendar-star" },
    { label: "CRITICAL", value: stats.critical, icon: "alert-octagon" },
  ] : [];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <Text style={styles.title}>Vendors · Subscriptions</Text>
        <Pressable testID="vendor-add" style={styles.addBtn} onPress={() => setEditing({ ...EMPTY })}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>ADD VENDOR</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <View style={styles.statRow}>
          {STAT_CARDS.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <MaterialCommunityIcons name={s.icon as any} size={18} color={colors.brandPrimary} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {stats?.upcoming_renewals?.length > 0 && (
          <View style={styles.renewBanner}>
            <MaterialCommunityIcons name="bell-ring-outline" size={16} color={colors.warning} />
            <Text style={styles.renewText}>{stats.upcoming_renewals.length} renewal(s) within 30 days</Text>
          </View>
        )}

        <View style={styles.toolbar}>
          <View style={styles.searchBox}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.onSurfaceTertiary} />
            <TextInput testID="vendor-search" style={styles.searchInput} placeholder="Search vendors…" placeholderTextColor={colors.onSurfaceTertiary} value={search} onChangeText={setSearch} />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          <Pressable onPress={() => setCategory(null)} style={[styles.catChip, !category && styles.catChipOn]}><Text style={[styles.catText, !category && styles.catTextOn]}>All</Text></Pressable>
          {(stats?.categories || []).map((c: any) => (
            <Pressable key={c.name} onPress={() => setCategory(c.name === category ? null : c.name)} style={[styles.catChip, category === c.name && styles.catChipOn]}>
              <Text style={[styles.catText, category === c.name && styles.catTextOn]}>{c.name} · {c.count}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          vendors.map((v) => (
            <Pressable key={v.id} testID={`vendor-${v.id}`} style={styles.row} onPress={() => setEditing(v)}>
              <View style={[styles.vIcon, { borderColor: IMP_COLOR[v.importance] || "#888" }]}>
                <Text style={[styles.vIconText, { color: IMP_COLOR[v.importance] || "#888" }]}>{(v.company || "?").charAt(0)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowName} numberOfLines={1}>{v.company}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{v.category} · {v.plan_type || "—"}</Text>
              </View>
              <View style={[styles.impPill, { backgroundColor: (IMP_COLOR[v.importance] || "#888") + "22", borderColor: IMP_COLOR[v.importance] || "#888" }]}>
                <Text style={[styles.impText, { color: IMP_COLOR[v.importance] || "#888" }]}>{(v.importance || "").toUpperCase()}</Text>
              </View>
              <Text style={styles.rowCost}>{v.monthly_cost_cents ? `${usd(v.monthly_cost_cents)}/mo` : "—"}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      {editing && <VendorEditor vendor={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboard }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.onSurfaceTertiary} keyboardType={keyboard} />
    </View>
  );
}

function VendorEditor({ vendor, onClose, onSaved }: { vendor: Vendor; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Vendor>({ ...vendor, doc: vendor.doc || {} });
  const [busy, setBusy] = useState(false);
  const isNew = !vendor.id;
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));
  const setDoc = (k: string, val: any) => setV((p: any) => ({ ...p, doc: { ...(p.doc || {}), [k]: val } }));
  const num = (s: string) => Math.round((parseFloat(s) || 0) * 100);

  const save = async () => {
    if (!v.company?.trim()) return;
    setBusy(true);
    const body = { ...v, monthly_cost_cents: typeof v.monthly_cost_cents === "string" ? num(v.monthly_cost_cents) : v.monthly_cost_cents, annual_cost_cents: typeof v.annual_cost_cents === "string" ? num(v.annual_cost_cents) : v.annual_cost_cents };
    try {
      if (isNew) await api("/admin/vendors", { method: "POST", body });
      else await api(`/admin/vendors/${v.id}`, { method: "PUT", body });
      onSaved();
    } finally { setBusy(false); }
  };
  const del = async () => { if (v.id) { await api(`/admin/vendors/${v.id}`, { method: "DELETE" }); onSaved(); } };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.drawerWrap}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.drawer}>
          <View style={styles.drawerHead}>
            <Text style={styles.drawerName}>{isNew ? "New Vendor" : v.company}</Text>
            <Pressable testID="vendor-close" onPress={onClose} hitSlop={10}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Field label="COMPANY *" value={v.company} onChange={(t: string) => set("company", t)} placeholder="Vendor name" />
            <Text style={styles.fieldLabel}>CATEGORY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              {CATEGORIES.map((c) => (
                <Pressable key={c} onPress={() => set("category", c)} style={[styles.catChip, v.category === c && styles.catChipOn]}><Text style={[styles.catText, v.category === c && styles.catTextOn]}>{c}</Text></Pressable>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>IMPORTANCE</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
              {["critical", "high", "medium", "low"].map((i) => (
                <Pressable key={i} onPress={() => set("importance", i)} style={[styles.impSel, v.importance === i && { borderColor: IMP_COLOR[i], backgroundColor: IMP_COLOR[i] + "22" }]}>
                  <Text style={[styles.impSelText, v.importance === i && { color: IMP_COLOR[i] }]}>{i.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="FEATURE / WHAT IT DOES" value={v.feature_description} onChange={(t: string) => set("feature_description", t)} placeholder="What this vendor powers" />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Field label="MONTHLY COST ($)" value={String(v.monthly_cost_cents ? (v.monthly_cost_cents / 100) : "")} onChange={(t: string) => set("monthly_cost_cents", t)} placeholder="0" keyboard="numeric" /></View>
              <View style={{ flex: 1 }}><Field label="ANNUAL COST ($)" value={String(v.annual_cost_cents ? (v.annual_cost_cents / 100) : "")} onChange={(t: string) => set("annual_cost_cents", t)} placeholder="0" keyboard="numeric" /></View>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Field label="PLAN TYPE" value={v.plan_type} onChange={(t: string) => set("plan_type", t)} placeholder="e.g. Pro monthly" /></View>
              <View style={{ flex: 1 }}><Field label="RENEWAL DATE" value={v.renewal_date} onChange={(t: string) => set("renewal_date", t)} placeholder="YYYY-MM-DD" /></View>
            </View>
            <Field label="WEBSITE" value={v.website} onChange={(t: string) => set("website", t)} placeholder="https://" />
            <Field label="DASHBOARD URL" value={v.dashboard_url} onChange={(t: string) => set("dashboard_url", t)} placeholder="https://" />
            <Field label="BILLING PORTAL" value={v.billing_url} onChange={(t: string) => set("billing_url", t)} placeholder="https://" />
            <Field label="API DOCS" value={v.api_docs_url} onChange={(t: string) => set("api_docs_url", t)} placeholder="https://" />
            <Field label="ACCOUNT OWNER" value={v.account_owner} onChange={(t: string) => set("account_owner", t)} placeholder="Who owns it" />
            <Field label="EMAIL USED" value={v.email_used} onChange={(t: string) => set("email_used", t)} placeholder="login email" />
            <Field label="SUPPORT EMAIL" value={v.support_email} onChange={(t: string) => set("support_email", t)} placeholder="support@" />
            <Field label="AFFILIATE LINK" value={v.affiliate_link} onChange={(t: string) => set("affiliate_link", t)} placeholder="https://" />

            <Text style={styles.docHeader}>DOCUMENTATION</Text>
            <Field label="PURPOSE" value={v.doc?.purpose} onChange={(t: string) => setDoc("purpose", t)} placeholder="What it's used for" />
            <Field label="API KEYS LOCATION" value={v.doc?.api_keys_location} onChange={(t: string) => setDoc("api_keys_location", t)} placeholder="e.g. backend/.env -> KEY" />
            <Field label="INTERNAL NOTES" value={v.doc?.internal_notes} onChange={(t: string) => setDoc("internal_notes", t)} placeholder="Notes for the team" />
            <Field label="WARNINGS" value={v.doc?.warnings} onChange={(t: string) => setDoc("warnings", t)} placeholder="Gotchas" />
            <Field label="DEPENDENCIES" value={v.doc?.dependencies} onChange={(t: string) => setDoc("dependencies", t)} placeholder="What relies on this" />
            <Field label="NOTES" value={v.notes} onChange={(t: string) => set("notes", t)} placeholder="General notes" />

            <Pressable testID="vendor-save" style={styles.primaryBtn} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>{isNew ? "CREATE VENDOR" : "SAVE CHANGES"}</Text>}
            </Pressable>
            {!isNew && (
              <Pressable testID="vendor-delete" style={styles.delBtn} onPress={del}>
                <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} />
                <Text style={styles.delText}>Delete vendor</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 0.5 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  addText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  statCard: { width: 120, flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, gap: 2 },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 26 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.8 },
  renewBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.warning, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  renewText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  toolbar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  searchBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, flex: 1 },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, paddingVertical: spacing.md, outlineStyle: "none" } as any,
  catChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, marginRight: spacing.sm },
  catChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  catText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  catTextOn: { color: colors.onBrandPrimary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.sm },
  vIcon: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  vIconText: { fontFamily: font.display, fontSize: 22 },
  rowName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  rowSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  impPill: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  impText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  rowCost: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, width: 70, textAlign: "right" },
  drawerWrap: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.6)" },
  drawer: { width: 480, maxWidth: "100%", backgroundColor: colors.surface, borderLeftColor: colors.border, borderLeftWidth: 1 },
  drawerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomColor: colors.border, borderBottomWidth: 1 },
  drawerName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  fieldLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, outlineStyle: "none" } as any,
  impSel: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.sm, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surfaceSecondary },
  impSelText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10 },
  docHeader: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.md, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.lg },
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center", marginTop: spacing.md },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  delBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  delText: { color: colors.error, fontFamily: font.bold, fontSize: type.base },
});
