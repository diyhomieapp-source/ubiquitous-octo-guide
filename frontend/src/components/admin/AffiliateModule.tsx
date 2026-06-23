import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Switch, Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";

type Tab = "settings" | "retailers" | "posts";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "settings", label: "Settings", icon: "tune" },
  { key: "retailers", label: "Retailers", icon: "store-outline" },
  { key: "posts", label: "Articles", icon: "file-document-multiple-outline" },
];

export function AffiliateModule() {
  const [tab, setTab] = useState<Tab>("settings");
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setCfg(await api("/admin/affiliate/config")); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: any) => {
    const next = await api("/admin/affiliate/config", { method: "PUT", body: patch });
    setCfg(next);
  };

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}><Text style={styles.title}>Affiliate Widget</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} testID={`aff-tab-${t.key}`} style={[styles.tab, on && styles.tabOn]} onPress={() => setTab(t.key)}>
              <MaterialCommunityIcons name={t.icon as any} size={16} color={on ? colors.brandPrimary : colors.onSurfaceTertiary} />
              <Text style={[styles.tabText, on && { color: colors.onSurface }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {loading || !cfg ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} /> : (
          <>
            {tab === "settings" && <SettingsTab cfg={cfg} save={save} />}
            {tab === "retailers" && <RetailersTab cfg={cfg} save={save} />}
            {tab === "posts" && <PostsTab />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SettingsTab({ cfg, save }: any) {
  const [title, setTitle] = useState(cfg.widget_title || "");
  const [disc, setDisc] = useState(cfg.disclosure || "");
  const [brands, setBrands] = useState((cfg.preferred_brands || []).join(", "));
  const [black, setBlack] = useState((cfg.blacklist || []).join(", "));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <View>
      <Row label="Widget enabled">
        <Switch value={!!cfg.enabled} onValueChange={(v) => save({ enabled: v })} trackColor={{ true: colors.brandPrimary }} />
      </Row>
      <Row label="Show optional sections">
        <Switch value={!!cfg.show_optional} onValueChange={(v) => save({ show_optional: v })} trackColor={{ true: colors.brandPrimary }} />
      </Row>
      <Field label="Widget title" value={title} onChange={setTitle} onBlur={() => save({ widget_title: title })} />
      <Field label="Preferred brands (comma separated)" value={brands} onChange={setBrands} onBlur={() => save({ preferred_brands: list(brands) })} />
      <Field label="Blacklisted items (hidden everywhere)" value={black} onChange={setBlack} onBlur={() => save({ blacklist: list(black) })} />
      <Field label="Affiliate disclosure" value={disc} onChange={setDisc} onBlur={() => save({ disclosure: disc })} multiline />
      <Text style={styles.hint}>Tip: leave a field then it auto-saves. Brands guide the AI; blacklist removes items globally.</Text>
    </View>
  );
}

function RetailersTab({ cfg, save }: any) {
  const entries = Object.entries(cfg.retailers || {}).sort((a: any, b: any) => (a[1].priority || 99) - (b[1].priority || 99));
  const update = (rk: string, patch: any) => save({ retailers: { [rk]: patch } });
  return (
    <View>
      <Text style={styles.hint}>Drag-free priority: lower number shows first. Add your affiliate tag/ID per store; links go live instantly.</Text>
      {entries.map(([rk, rv]: any) => (
        <View key={rk} style={styles.card}>
          <View style={styles.rowWrap}>
            <Text style={styles.cardTitle}>{rv.label}</Text>
            <Switch value={!!rv.enabled} onValueChange={(v) => update(rk, { enabled: v })} trackColor={{ true: colors.brandPrimary }} />
          </View>
          <View style={styles.inlineRow}>
            <View style={{ width: 80 }}>
              <Text style={styles.fieldLabel}>Priority</Text>
              <TextInput style={styles.input} defaultValue={String(rv.priority ?? "")} keyboardType="numeric"
                onEndEditing={(e) => update(rk, { priority: parseInt(e.nativeEvent.text || "99", 10) || 99 })} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{rk === "amazon" ? "Associates tag (e.g. diyhomie-20)" : "Affiliate ID / subId"}</Text>
              <TextInput style={styles.input} defaultValue={rv.affiliate_tag || ""} autoCapitalize="none"
                placeholder="paste later" placeholderTextColor={colors.onSurfaceTertiary}
                onEndEditing={(e) => update(rk, { affiliate_tag: e.nativeEvent.text.trim() })} />
            </View>
          </View>
          {rk !== "amazon" && (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.fieldLabel}>Deeplink template (Impact/CJ — optional, use {"{url}"})</Text>
              <TextInput style={styles.input} defaultValue={rv.deeplink_template || ""} autoCapitalize="none"
                placeholder="https://network/deeplink?u={url}" placeholderTextColor={colors.onSurfaceTertiary}
                onEndEditing={(e) => update(rk, { deeplink_template: e.nativeEvent.text.trim() })} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function PostsTab() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setPosts(await api("/admin/affiliate/posts")); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const regen = async (slug: string) => {
    setBusy(slug);
    try { await api(`/admin/affiliate/regenerate/${slug}`, { method: "POST" }); await load(); }
    catch (e: any) { Alert.alert("Affiliate", e?.message || "Failed"); } finally { setBusy(null); }
  };
  const backfill = () => Alert.alert("Backfill all", "Generate AI shopping lists for every article missing one?", [
    { text: "Cancel", style: "cancel" },
    { text: "Run", onPress: async () => { try { const r = await api("/admin/affiliate/backfill", { method: "POST" }); Alert.alert("Affiliate", `Queued ${r.queued} articles. Lists fill in over the next few minutes.`); } catch {} } },
  ]);

  if (loading) return <ActivityIndicator color={colors.brandPrimary} />;
  return (
    <View>
      <Pressable testID="aff-backfill" style={styles.addBtn} onPress={backfill}>
        <MaterialCommunityIcons name="auto-fix" size={18} color={colors.onBrandPrimary} />
        <Text style={styles.addBtnText}>Backfill missing lists (AI)</Text>
      </Pressable>
      {posts.map((p) => (
        <View key={p.slug} style={styles.card}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{p.title}</Text>
            <Text style={styles.cardSub}>
              {p.has_list ? `${p.item_count} items · ${p.list_source === "ai" ? "AI" : "basic"}` : "no list yet"} · {p.views || 0} views
            </Text>
          </View>
          <Pressable testID={`aff-regen-${p.slug}`} style={styles.regenBtn} onPress={() => regen(p.slug)} disabled={busy === p.slug}>
            {busy === p.slug ? <ActivityIndicator color={colors.brandPrimary} size="small" /> : <MaterialCommunityIcons name="refresh" size={18} color={colors.brandPrimary} />}
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function Row({ label, children }: any) {
  return <View style={styles.settingRow}><Text style={styles.settingLabel}>{label}</Text>{children}</View>;
}
function Field({ label, value, onChange, onBlur, multiline }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={[styles.input, multiline && { minHeight: 80, textAlignVertical: "top" }]} value={value}
        onChangeText={onChange} onBlur={onBlur} multiline={multiline} placeholderTextColor={colors.onSurfaceTertiary} />
    </View>
  );
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
  hint: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginBottom: spacing.md, lineHeight: 18 },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  settingLabel: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  fieldLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, letterSpacing: 0.8, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  cardSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 2 },
  rowWrap: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flex: 1 },
  inlineRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.brandPrimary, paddingVertical: spacing.md, borderRadius: radius.md, marginBottom: spacing.lg },
  addBtnText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  regenBtn: { width: 38, height: 38, borderRadius: radius.sm, borderColor: colors.brandPrimary, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
