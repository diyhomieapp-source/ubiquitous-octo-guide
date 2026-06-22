import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Modal } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

const usd = (c?: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;
const PLAN_COLOR: Record<string, string> = { free: "#888", pro: "#2F80ED", master: "#9B51E0" };
const STATUS_COLOR: Record<string, string> = { trial: "#FF8A50", active: "#27AE60", canceled: "#EB5757", none: "#888" };

type Seg = { name: string; count: number };
type Contact = {
  id: string; email: string; name: string; username: string; phone: string; picture: string;
  signup_source: string; signup_date: string; country: string; state: string;
  plan: string; membership_status: string; billing_status: string; ltv_cents: number;
  projects_created: number; projects_completed: number; community_contributions: number;
  last_login?: string; last_activity?: string; notes_count: number; tags: string[]; segments: string[]; categories: string[];
};
type Note = { id: string; body: string; author: string; created_at: string };
type Detail = Contact & { timeline: { icon: string; label: string; at: string }[]; notes: Note[] };

const fmtDate = (iso?: string) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return "—"; }
};
const ago = (iso?: string) => {
  if (!iso) return "never";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "1d ago";
  if (d < 30) return `${Math.floor(d)}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
};

export function CrmModule() {
  const [stats, setStats] = useState<any>(null);
  const [segments, setSegments] = useState<Seg[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<string | null>(null);
  const [sort, setSort] = useState("recent");
  const [active, setActive] = useState<Detail | null>(null);

  const loadStats = useCallback(async () => {
    try { const s = await api("/admin/crm/stats"); setStats(s); setSegments(s.segments); } catch {}
  }, []);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort, limit: "50" });
      if (search.trim()) params.set("search", search.trim());
      if (segment) params.set("segment", segment);
      const r = await api(`/admin/crm/contacts?${params.toString()}`);
      setContacts(r.contacts); setTotal(r.total);
    } catch {} finally { setLoading(false); }
  }, [search, segment, sort]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { const t = setTimeout(loadContacts, 250); return () => clearTimeout(t); }, [loadContacts]);

  const openContact = async (id: string) => {
    try { const d = await api(`/admin/crm/contacts/${id}`); setActive(d); } catch {}
  };

  const STAT_CARDS = stats ? [
    { label: "TOTAL USERS", value: stats.total_users, icon: "account-group" },
    { label: "NEW TODAY", value: stats.new_today, icon: "account-plus" },
    { label: "ACTIVE 7D", value: stats.active_7d, icon: "lightning-bolt" },
    { label: "TRIAL", value: stats.trial_users, icon: "clock-outline" },
    { label: "PAYING", value: stats.paying_users, icon: "star-circle" },
    { label: "REVENUE", value: usd(stats.revenue_cents), icon: "cash" },
    { label: "PROJECTS", value: stats.projects_created, icon: "clipboard-list" },
    { label: "CONTRIBUTORS", value: stats.community_contributors, icon: "comment-multiple" },
  ] : [];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <Text style={styles.title}>CRM · Contacts</Text>
        <Pressable testID="crm-refresh" onPress={() => { loadStats(); loadContacts(); }} hitSlop={8}>
          <MaterialCommunityIcons name="refresh" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        {/* stat cards */}
        <View style={styles.statRow}>
          {STAT_CARDS.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <MaterialCommunityIcons name={s.icon as any} size={18} color={colors.brandPrimary} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* segment filter */}
        <Text style={styles.sectionLabel}>SEGMENTS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          <Pressable testID="seg-all" onPress={() => setSegment(null)} style={[styles.segChip, !segment && styles.segChipOn]}>
            <Text style={[styles.segText, !segment && styles.segTextOn]}>All · {stats?.total_users ?? 0}</Text>
          </Pressable>
          {segments.filter((s) => s.count > 0).map((s) => (
            <Pressable key={s.name} testID={`seg-${s.name}`} onPress={() => setSegment(s.name === segment ? null : s.name)} style={[styles.segChip, segment === s.name && styles.segChipOn]}>
              <Text style={[styles.segText, segment === s.name && styles.segTextOn]}>{s.name} · {s.count}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* search + sort */}
        <View style={styles.toolbar}>
          <View style={styles.searchBox}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.onSurfaceTertiary} />
            <TextInput testID="crm-search" style={styles.searchInput} placeholder="Search name, email, phone…" placeholderTextColor={colors.onSurfaceTertiary} value={search} onChangeText={setSearch} />
          </View>
          {["recent", "ltv", "active", "name"].map((o) => (
            <Pressable key={o} testID={`sort-${o}`} onPress={() => setSort(o)} style={[styles.sortChip, sort === o && styles.sortChipOn]}>
              <Text style={[styles.sortText, sort === o && { color: colors.onSurface }]}>{o.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.resultCount}>{total} contact{total === 1 ? "" : "s"}</Text>

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
        ) : (
          contacts.map((c) => (
            <Pressable key={c.id} testID={`contact-${c.id}`} style={styles.row} onPress={() => openContact(c.id)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(c.name || c.email).charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowName} numberOfLines={1}>{c.name || c.username}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{c.email}</Text>
              </View>
              <View style={styles.rowMid}>
                <View style={[styles.pill, { backgroundColor: (PLAN_COLOR[c.plan] || "#888") + "22", borderColor: PLAN_COLOR[c.plan] || "#888" }]}>
                  <Text style={[styles.pillText, { color: PLAN_COLOR[c.plan] || "#888" }]}>{c.plan.toUpperCase()}</Text>
                </View>
                <View style={[styles.pill, { backgroundColor: (STATUS_COLOR[c.membership_status] || "#888") + "22", borderColor: STATUS_COLOR[c.membership_status] || "#888" }]}>
                  <Text style={[styles.pillText, { color: STATUS_COLOR[c.membership_status] || "#888" }]}>{c.membership_status.toUpperCase()}</Text>
                </View>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowLtv}>{usd(c.ltv_cents)}</Text>
                <Text style={styles.rowActivity}>{ago(c.last_activity)}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {active && <ContactDrawer contact={active} onClose={() => setActive(null)} onChanged={(d) => setActive(d)} reloadList={() => { loadContacts(); loadStats(); }} />}
    </View>
  );
}

function ContactDrawer({ contact, onClose, onChanged, reloadList }: { contact: Detail; onClose: () => void; onChanged: (d: Detail) => void; reloadList: () => void }) {
  const [tab, setTab] = useState<"profile" | "timeline" | "notes">("profile");
  const [phone, setPhone] = useState(contact.phone || "");
  const [country, setCountry] = useState(contact.country || "");
  const [state, setState] = useState(contact.state || "");
  const [tags, setTags] = useState((contact.tags || []).join(", "));
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => { const d = await api(`/admin/crm/contacts/${contact.id}`); onChanged(d); reloadList(); };

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api(`/admin/crm/contacts/${contact.id}`, { method: "PUT", body: { phone, country, state } });
      await api(`/admin/crm/contacts/${contact.id}/tags`, { method: "POST", body: { tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      await reload();
    } finally { setBusy(false); }
  };
  const addNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try { await api(`/admin/crm/contacts/${contact.id}/notes`, { method: "POST", body: { body: noteText.trim() } }); setNoteText(""); await reload(); } finally { setBusy(false); }
  };
  const delNote = async (id: string) => { await api(`/admin/crm/notes/${id}`, { method: "DELETE" }); await reload(); };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.drawerWrap}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.drawer}>
          <View style={styles.drawerHead}>
            <View style={styles.avatarLg}><Text style={styles.avatarLgText}>{(contact.name || contact.email).charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.drawerName}>{contact.name || contact.username}</Text>
              <Text style={styles.drawerEmail}>{contact.email}</Text>
            </View>
            <Pressable testID="drawer-close" onPress={onClose} hitSlop={10}><MaterialCommunityIcons name="close" size={24} color={colors.onSurface} /></Pressable>
          </View>

          {/* segment chips */}
          <View style={styles.tagRow}>
            {contact.segments.slice(0, 6).map((s) => (<View key={s} style={styles.segMini}><Text style={styles.segMiniText}>{s}</Text></View>))}
          </View>

          <View style={styles.drawerTabs}>
            {(["profile", "timeline", "notes"] as const).map((tk) => (
              <Pressable key={tk} testID={`drawer-tab-${tk}`} onPress={() => setTab(tk)} style={[styles.drawerTab, tab === tk && styles.drawerTabOn]}>
                <Text style={[styles.drawerTabText, tab === tk && { color: colors.brandPrimary }]}>{tk.toUpperCase()}{tk === "notes" ? ` (${contact.notes.length})` : ""}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            {tab === "profile" && (
              <>
                <View style={styles.kvRow}><Text style={styles.kvK}>Plan</Text><Text style={styles.kvV}>{contact.plan} · {contact.membership_status}</Text></View>
                <View style={styles.kvRow}><Text style={styles.kvK}>LTV</Text><Text style={styles.kvV}>{usd(contact.ltv_cents)}</Text></View>
                <View style={styles.kvRow}><Text style={styles.kvK}>Signup</Text><Text style={styles.kvV}>{fmtDate(contact.signup_date)} · {contact.signup_source}</Text></View>
                <View style={styles.kvRow}><Text style={styles.kvK}>Last login</Text><Text style={styles.kvV}>{ago(contact.last_login)}</Text></View>
                <View style={styles.kvRow}><Text style={styles.kvK}>Projects</Text><Text style={styles.kvV}>{contact.projects_created} created · {contact.projects_completed} done</Text></View>
                <View style={styles.kvRow}><Text style={styles.kvK}>Community</Text><Text style={styles.kvV}>{contact.community_contributions} posts</Text></View>
                <View style={styles.kvRow}><Text style={styles.kvK}>Location</Text><Text style={styles.kvV}>{contact.location || "—"}</Text></View>

                <Text style={styles.fieldLabel}>PHONE</Text>
                <TextInput testID="edit-phone" style={styles.input} value={phone} onChangeText={setPhone} placeholder="Add phone" placeholderTextColor={colors.onSurfaceTertiary} />
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>COUNTRY</Text>
                    <TextInput testID="edit-country" style={styles.input} value={country} onChangeText={setCountry} placeholder="—" placeholderTextColor={colors.onSurfaceTertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>STATE</Text>
                    <TextInput testID="edit-state" style={styles.input} value={state} onChangeText={setState} placeholder="—" placeholderTextColor={colors.onSurfaceTertiary} />
                  </View>
                </View>
                <Text style={styles.fieldLabel}>TAGS (comma separated)</Text>
                <TextInput testID="edit-tags" style={styles.input} value={tags} onChangeText={setTags} placeholder="VIP, Beta Tester, Affiliate" placeholderTextColor={colors.onSurfaceTertiary} />
                <Pressable testID="save-profile" style={styles.primaryBtn} onPress={saveProfile} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>SAVE CHANGES</Text>}
                </Pressable>
              </>
            )}
            {tab === "timeline" && (
              contact.timeline.length === 0 ? <Text style={styles.empty}>No activity yet.</Text> :
              contact.timeline.map((e, i) => (
                <View key={i} style={styles.tlRow}>
                  <View style={styles.tlIcon}><MaterialCommunityIcons name={e.icon as any} size={16} color={colors.brandPrimary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tlLabel}>{e.label}</Text>
                    <Text style={styles.tlDate}>{fmtDate(e.at)} · {ago(e.at)}</Text>
                  </View>
                </View>
              ))
            )}
            {tab === "notes" && (
              <>
                <View style={styles.noteComposer}>
                  <TextInput testID="note-input" style={[styles.input, { flex: 1, marginBottom: 0 }]} value={noteText} onChangeText={setNoteText} placeholder="Add internal note…" placeholderTextColor={colors.onSurfaceTertiary} />
                  <Pressable testID="note-add" style={styles.noteAdd} onPress={addNote} disabled={busy}><MaterialCommunityIcons name="plus" size={20} color={colors.onBrandPrimary} /></Pressable>
                </View>
                {contact.notes.map((n) => (
                  <View key={n.id} style={styles.noteCard}>
                    <Text style={styles.noteBody}>{n.body}</Text>
                    <View style={styles.noteMeta}>
                      <Text style={styles.noteAuthor}>{n.author} · {fmtDate(n.created_at)}</Text>
                      <Pressable testID={`note-del-${n.id}`} onPress={() => delNote(n.id)}><MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} /></Pressable>
                    </View>
                  </View>
                ))}
                {contact.notes.length === 0 && <Text style={styles.empty}>No notes yet.</Text>}
              </>
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
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  statCard: { width: 120, flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, gap: 2 },
  statValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 26 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.8 },
  sectionLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  segChip: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, marginRight: spacing.sm },
  segChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  segTextOn: { color: colors.onBrandPrimary },
  toolbar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", marginBottom: spacing.sm },
  searchBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, flex: 1, minWidth: 200 },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, paddingVertical: spacing.md, outlineStyle: "none" } as any,
  sortChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  sortChipOn: { borderColor: colors.brandPrimary },
  sortText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 0.5 },
  resultCount: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.sm },
  avatar: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.base },
  rowName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  rowSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  rowMid: { flexDirection: "row", gap: 4 },
  pill: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  pillText: { fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5 },
  rowRight: { alignItems: "flex-end", width: 80 },
  rowLtv: { color: colors.success, fontFamily: font.bold, fontSize: type.base },
  rowActivity: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  drawerWrap: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.6)" },
  drawer: { width: 460, maxWidth: "100%", backgroundColor: colors.surface, borderLeftColor: colors.border, borderLeftWidth: 1 },
  drawerHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomColor: colors.border, borderBottomWidth: 1 },
  avatarLg: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarLgText: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 24 },
  drawerName: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  drawerEmail: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  segMini: { backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  segMiniText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: 9 },
  drawerTabs: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.lg, borderBottomColor: colors.border, borderBottomWidth: 1, marginTop: spacing.sm },
  drawerTab: { paddingVertical: spacing.md, borderBottomColor: "transparent", borderBottomWidth: 2 },
  drawerTabOn: { borderBottomColor: colors.brandPrimary },
  drawerTabText: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 0.5 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  kvK: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  kvV: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  fieldLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginTop: spacing.md, marginBottom: 4 },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md, outlineStyle: "none" } as any,
  primaryBtn: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center", marginTop: spacing.sm },
  primaryText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  empty: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", marginTop: spacing.xl },
  tlRow: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm },
  tlIcon: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  tlLabel: { color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  tlDate: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  noteComposer: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginBottom: spacing.md },
  noteAdd: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  noteCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.sm },
  noteBody: { color: colors.onSurface, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  noteMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  noteAuthor: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.sm },
});
