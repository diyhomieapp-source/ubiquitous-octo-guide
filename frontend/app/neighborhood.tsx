import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const money = (c: number) => `$${Math.round((c || 0) / 100).toLocaleString()}`;

type Impact = { members: number; homes_month: number; saved_total_cents: number; total_projects: number };
type FeedItem = { id: string; author: string; is_mine: boolean; title: string; skill_tag?: string; money_saved_cents: number; photo?: string; created_at: string };
type Neighbor = { name: string; trusted: boolean; contributions: number; is_mine: boolean };
type Overview = { optin: boolean; has_location: boolean; neighborhood_tag: string; impact: Impact | null; feed: FeedItem[]; neighbors: Neighbor[] };
type Offer = { id: string; author: string; body: string; created_at: string; contact_shared: boolean; author_email?: string | null; offerer_email?: string | null; is_mine: boolean };
type Post = { id: string; kind: string; title: string; body: string; image_base64?: string; author: string; is_mine: boolean; resolved: boolean; promoted_global: boolean; offer_count: number; offers: Offer[]; flagged: boolean; created_at: string };

type Tab = "feed" | "help" | "qa";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "feed", label: "Feed", icon: "home-group" },
  { key: "help", label: "Borrow & Lend", icon: "hand-heart-outline" },
  { key: "qa", label: "Ask Locals", icon: "comment-question-outline" },
];
const KIND_FOR_TAB: Record<Tab, string> = { feed: "spotlight", help: "help", qa: "qa" };

export default function Neighborhood() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const [d, setD] = useState<Overview | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState<Tab>("feed");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const [offerFor, setOfferFor] = useState<Post | null>(null);
  const [offerBody, setOfferBody] = useState("");

  const load = useCallback(async () => {
    try {
      const ov = await api<Overview>("/neighborhood");
      setD(ov);
      if (ov.optin) {
        const [help, qa, spot] = await Promise.all([
          api<Post[]>("/neighborhood/posts?kind=help"),
          api<Post[]>("/neighborhood/posts?kind=qa"),
          api<Post[]>("/neighborhood/posts?kind=spotlight"),
        ]);
        setPosts([...help, ...qa, ...spot]);
      }
    } catch {} finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const join = async () => {
    setJoining(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api("/neighborhood/join", { method: "POST", body: { optin: true } });
      await refresh();
      await load();
    } catch (e: any) {
      Alert.alert("Almost there", e?.message || "Add your city or ZIP in Profile first.");
    } finally { setJoining(false); }
  };

  const submitPost = async () => {
    if (!title.trim() || posting) return;
    setPosting(true);
    Haptics.selectionAsync();
    try {
      await api("/neighborhood/posts", { method: "POST", body: { kind: KIND_FOR_TAB[tab], title: title.trim(), body: body.trim() } });
      setTitle(""); setBody(""); setComposerOpen(false);
      load();
    } catch (e: any) {
      Alert.alert("Couldn't post", e?.message || "Try again.");
    } finally { setPosting(false); }
  };

  const submitOffer = async () => {
    if (!offerFor) return;
    Haptics.selectionAsync();
    try {
      await api(`/neighborhood/posts/${offerFor.id}/offer`, { method: "POST", body: { body: offerBody.trim() } });
      setOfferFor(null); setOfferBody("");
      load();
    } catch (e: any) { Alert.alert("Couldn't send", e?.message || "Try again."); }
  };

  const reveal = async (postId: string, offerId: string) => {
    Haptics.selectionAsync();
    try { await api(`/neighborhood/posts/${postId}/reveal/${offerId}`, { method: "POST" }); load(); } catch {}
  };
  const resolve = async (postId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try { await api(`/neighborhood/posts/${postId}/resolve`, { method: "POST" }); load(); } catch {}
  };
  const flag = (postId: string) => {
    Alert.alert("Report this post?", "Our team will review it against the community code of conduct.", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: async () => { try { await api(`/neighborhood/posts/${postId}/flag`, { method: "POST", body: { reason: "" } }); load(); } catch {} } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;

  // ---- opt-in gate
  if (!d?.optin) {
    return (
      <View style={styles.root}>
        <Header insets={insets} title="Neighborhood" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={styles.gateHero}>
            <MaterialCommunityIcons name="map-marker-radius" size={40} color={colors.brandPrimary} />
            <Text style={styles.gateTitle}>Meet your neighbors</Text>
            <Text style={styles.gateSub}>See nearby DIY projects, borrow tools, and ask locals for tips — grouped by your area, never your address.</Text>
          </View>
          <View style={styles.privacyCard}>
            <PrivacyRow icon="shield-lock-outline" text="We only use your city/ZIP — street addresses are never stored or shown." />
            <PrivacyRow icon="account-eye-outline" text="You choose what's shared. Contact info is only revealed when you approve it." />
            <PrivacyRow icon="flag-outline" text="Every post can be reported and is moderated." />
          </View>
          {d?.has_location === false ? (
            <Pressable testID="neighborhood-add-location" style={styles.joinBtn} onPress={() => router.push("/(tabs)/profile")}>
              <Text style={styles.joinText}>ADD YOUR LOCATION IN PROFILE</Text>
            </Pressable>
          ) : (
            <Pressable testID="neighborhood-join" style={styles.joinBtn} onPress={join} disabled={joining}>
              {joining ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.joinText}>JOIN {d?.neighborhood_tag?.toUpperCase() || "MY NEIGHBORHOOD"}</Text>}
            </Pressable>
          )}
        </ScrollView>
      </View>
    );
  }

  const im = d.impact;
  const tabPosts = posts.filter((p) => p.kind === KIND_FOR_TAB[tab]);

  return (
    <View style={styles.root}>
      <Header insets={insets} title={d.neighborhood_tag || "Neighborhood"} onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}
      >
        {/* impact banner */}
        {im && (
          <View style={styles.impactWrap}>
            <Text style={styles.impactLead}>Neighbors like you are getting it done 💪</Text>
            <View style={styles.impactGrid}>
              <ImpactStat value={String(im.homes_month)} label="HOMES IMPROVED / MO" />
              <ImpactStat value={money(im.saved_total_cents)} label="SAVED TOGETHER" color={colors.success} />
              <ImpactStat value={String(im.members)} label="NEIGHBORS" />
              <ImpactStat value={String(im.total_projects)} label="PROJECTS LOGGED" />
            </View>
          </View>
        )}

        {/* neighbors strip */}
        {d.neighbors.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nbStrip}>
            {d.neighbors.map((n, i) => (
              <View key={i} style={styles.nbChip}>
                <View style={styles.nbAvatar}><Text style={styles.nbAvatarText}>{n.name.charAt(0).toUpperCase()}</Text></View>
                <Text style={styles.nbName} numberOfLines={1}>{n.is_mine ? "You" : n.name}</Text>
                {n.trusted && <View style={styles.trustBadge}><MaterialCommunityIcons name="shield-check" size={11} color={colors.onBrandPrimary} /><Text style={styles.trustText}>Trusted</Text></View>}
              </View>
            ))}
          </ScrollView>
        )}

        {/* tabs */}
        <View style={styles.tabsRow}>
          {TABS.map((t) => (
            <Pressable key={t.key} testID={`nb-tab-${t.key}`} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
              <MaterialCommunityIcons name={t.icon as any} size={16} color={tab === t.key ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* FEED tab: auto project feed + spotlight posts */}
        {tab === "feed" ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            {d.feed.length === 0 && tabPosts.length === 0 && (
              <Empty icon="home-search-outline" text="No neighbor projects yet. Finish a project and share it to inspire the block!" />
            )}
            {d.feed.map((f) => (
              <View key={f.id} style={styles.feedCard}>
                <View style={styles.feedHead}>
                  <View style={styles.feedAvatar}><Text style={styles.feedAvatarText}>{f.author.charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.feedAuthor}>{f.is_mine ? "You" : f.author}{f.skill_tag ? ` · ${f.skill_tag}` : ""}</Text>
                    <Text style={styles.feedTitle} numberOfLines={2}>{f.title}</Text>
                  </View>
                </View>
                {!!f.photo && <Image source={{ uri: `data:image/jpeg;base64,${f.photo}` }} style={styles.feedPhoto} contentFit="cover" />}
                {f.money_saved_cents > 0 && (
                  <View style={styles.savedPill}><MaterialCommunityIcons name="cash" size={13} color={colors.success} /><Text style={styles.savedText}>Saved {money(f.money_saved_cents)}</Text></View>
                )}
              </View>
            ))}
            {tabPosts.map((p) => <PostCard key={p.id} p={p} onOffer={() => setOfferFor(p)} onReveal={reveal} onResolve={resolve} onFlag={flag} />)}
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            {tabPosts.length === 0 && (
              <Empty icon={tab === "help" ? "hand-heart-outline" : "comment-question-outline"}
                text={tab === "help" ? "No requests yet. Need to borrow a tool? Post it below." : "No questions yet. Ask your neighbors anything DIY."} />
            )}
            {tabPosts.map((p) => <PostCard key={p.id} p={p} onOffer={() => setOfferFor(p)} onReveal={reveal} onResolve={resolve} onFlag={flag} />)}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable testID="nb-fab" style={[styles.fab, { bottom: insets.bottom + spacing.lg }]} onPress={() => { Haptics.selectionAsync(); setComposerOpen(true); }}>
        <MaterialCommunityIcons name="plus" size={22} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>{tab === "help" ? "Request" : tab === "qa" ? "Ask" : "Share"}</Text>
      </Pressable>

      {/* composer */}
      <Modal visible={composerOpen} transparent animationType="slide" onRequestClose={() => setComposerOpen(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>
              {tab === "help" ? "Borrow or lend" : tab === "qa" ? "Ask your neighbors" : "Share a project"}
            </Text>
            <TextInput testID="nb-post-title" style={styles.input} value={title} onChangeText={setTitle}
              placeholder={tab === "help" ? "e.g. Borrow a post-hole digger this weekend?" : tab === "qa" ? "e.g. Best paint for fences in our climate?" : "e.g. Finished my kitchen backsplash!"}
              placeholderTextColor={colors.onSurfaceTertiary} />
            <TextInput testID="nb-post-body" style={[styles.input, styles.inputMulti]} value={body} onChangeText={setBody}
              placeholder="Add details (optional)" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            <View style={styles.sheetBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setComposerOpen(false)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="nb-post-submit" style={[styles.saveBtn, (!title.trim() || posting) && { opacity: 0.5 }]} onPress={submitPost} disabled={!title.trim() || posting}>
                {posting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>POST</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* offer modal */}
      <Modal visible={!!offerFor} transparent animationType="slide" onRequestClose={() => setOfferFor(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grip} />
            <Text style={styles.sheetTitle}>Offer to help</Text>
            <Text style={styles.offerCtx} numberOfLines={2}>“{offerFor?.title}”</Text>
            <TextInput testID="nb-offer-body" style={[styles.input, styles.inputMulti]} value={offerBody} onChangeText={setOfferBody}
              placeholder="Add a note (e.g. I have one you can borrow Sat AM)" placeholderTextColor={colors.onSurfaceTertiary} multiline />
            <View style={styles.sheetBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setOfferFor(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
              <Pressable testID="nb-offer-submit" style={styles.saveBtn} onPress={submitOffer}><Text style={styles.saveText}>I CAN HELP</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Header({ insets, title, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="nb-back" hitSlop={10} onPress={onBack}><MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} /></Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={{ width: 28 }} />
    </View>
  );
}

function PostCard({ p, onOffer, onReveal, onResolve, onFlag }: { p: Post; onOffer: () => void; onReveal: (pid: string, oid: string) => void; onResolve: (pid: string) => void; onFlag: (pid: string) => void }) {
  const [expand, setExpand] = useState(false);
  return (
    <View style={[styles.postCard, p.resolved && styles.postResolved]}>
      <View style={styles.postTop}>
        <View style={styles.feedAvatar}><Text style={styles.feedAvatarText}>{p.author.charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.feedAuthor}>{p.is_mine ? "You" : p.author}</Text>
          <Text style={styles.postTitle}>{p.title}</Text>
        </View>
        <Pressable hitSlop={8} onPress={() => onFlag(p.id)} testID={`nb-flag-${p.id}`}>
          <MaterialCommunityIcons name={p.flagged ? "flag" : "flag-outline"} size={16} color={p.flagged ? colors.warning : colors.onSurfaceTertiary} />
        </Pressable>
      </View>
      {!!p.body && <Text style={styles.postBody}>{p.body}</Text>}
      <View style={styles.postMeta}>
        {p.resolved && <View style={styles.metaPill}><MaterialCommunityIcons name="check-circle" size={12} color={colors.success} /><Text style={[styles.metaText, { color: colors.success }]}>Resolved</Text></View>}
        {p.promoted_global && <View style={styles.metaPill}><MaterialCommunityIcons name="earth" size={12} color={colors.info} /><Text style={[styles.metaText, { color: colors.info }]}>Shared globally</Text></View>}
        {p.offer_count > 0 && <Pressable style={styles.metaPill} onPress={() => setExpand((x) => !x)}><MaterialCommunityIcons name="hand-heart" size={12} color={colors.brandPrimary} /><Text style={[styles.metaText, { color: colors.brandPrimary }]}>{p.offer_count} offered</Text></Pressable>}
      </View>

      {/* offers (visible to author or expanded) */}
      {(expand || p.is_mine) && p.offers.map((o) => (
        <View key={o.id} style={styles.offerRow}>
          <MaterialCommunityIcons name="account-heart-outline" size={16} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.offerAuthor}>{o.is_mine ? "You" : o.author} offered to help</Text>
            {!!o.body && <Text style={styles.offerText}>{o.body}</Text>}
            {o.contact_shared && (o.author_email || o.offerer_email) && (
              <Text style={styles.contactText}>Contact: {p.is_mine ? o.offerer_email : o.author_email}</Text>
            )}
          </View>
          {p.is_mine && !o.contact_shared && (
            <Pressable style={styles.smallBtn} onPress={() => onReveal(p.id, o.id)} testID={`nb-reveal-${o.id}`}>
              <Text style={styles.smallBtnText}>Share contact</Text>
            </Pressable>
          )}
        </View>
      ))}

      {/* actions */}
      <View style={styles.postActions}>
        {!p.is_mine && p.kind !== "spotlight" && (
          <Pressable style={styles.actBtn} onPress={onOffer} testID={`nb-offer-btn-${p.id}`}>
            <MaterialCommunityIcons name="hand-heart-outline" size={15} color={colors.onBrandPrimary} />
            <Text style={styles.actText}>I can help</Text>
          </Pressable>
        )}
        {p.is_mine && !p.resolved && p.kind !== "spotlight" && (
          <Pressable style={styles.actBtnOutline} onPress={() => onResolve(p.id)} testID={`nb-resolve-${p.id}`}>
            <MaterialCommunityIcons name="check" size={15} color={colors.brandPrimary} />
            <Text style={styles.actTextOutline}>Mark resolved</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ImpactStat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.impactStat}>
      <Text style={[styles.impactValue, color && { color }]}>{value}</Text>
      <Text style={styles.impactLabel}>{label}</Text>
    </View>
  );
}
function PrivacyRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.privacyRow}>
      <MaterialCommunityIcons name={icon as any} size={18} color={colors.brandPrimary} />
      <Text style={styles.privacyText}>{text}</Text>
    </View>
  );
}
function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon as any} size={34} color={colors.onSurfaceTertiary} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomColor: colors.border, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.display, fontSize: 22 },

  gateHero: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  gateTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 30 },
  gateSub: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.lg, textAlign: "center", lineHeight: 24, maxWidth: 320 },
  privacyCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  privacyRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  privacyText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.base, lineHeight: 20 },
  joinBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
  joinText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },

  impactWrap: { padding: spacing.lg },
  impactLead: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginBottom: spacing.md },
  impactGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  impactStat: { width: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  impactValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 26 },
  impactLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 9, letterSpacing: 0.5, marginTop: 2 },

  nbStrip: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  nbChip: { alignItems: "center", gap: 4, width: 72 },
  nbAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  nbAvatarText: { color: colors.onBrandTertiary, fontFamily: font.display, fontSize: 22 },
  nbName: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: type.sm },
  trustBadge: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  trustText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: 8 },

  tabsRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
  tabBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: 12 },
  tabTextActive: { color: colors.onBrandPrimary },

  feedCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  feedHead: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  feedAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  feedAvatarText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.base },
  feedAuthor: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm },
  feedTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: 1 },
  feedPhoto: { width: "100%", aspectRatio: 16 / 10, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  savedPill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  savedText: { color: colors.success, fontFamily: font.bold, fontSize: type.sm },

  postCard: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  postResolved: { opacity: 0.75 },
  postTop: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  postTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, marginTop: 1 },
  postBody: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  postMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontFamily: font.bold, fontSize: type.sm },
  offerRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm },
  offerAuthor: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm },
  offerText: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  contactText: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm, marginTop: 3 },
  smallBtn: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  smallBtnText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: 11 },
  postActions: { flexDirection: "row", gap: spacing.sm },
  actBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  actBtnOutline: { flexDirection: "row", alignItems: "center", gap: 5, borderColor: colors.brandPrimary, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actTextOutline: { color: colors.brandPrimary, fontFamily: font.bold, fontSize: type.sm },

  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["2xl"] },
  emptyText: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, textAlign: "center", maxWidth: 280, lineHeight: 20 },

  fab: { position: "absolute", right: spacing.lg, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, shadowColor: colors.brandPrimary, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 },
  fabText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.md },
  offerCtx: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md, fontStyle: "italic" },
  input: { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderStrong, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.md },
  inputMulti: { minHeight: 80, textAlignVertical: "top" },
  sheetBtns: { flexDirection: "row", gap: spacing.sm },
  cancelBtn: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, borderColor: colors.border, borderWidth: 1 },
  cancelText: { color: colors.onSurfaceSecondary, fontFamily: font.bold, fontSize: type.base },
  saveBtn: { flex: 2, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
});
