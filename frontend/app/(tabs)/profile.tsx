import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, Alert, Switch,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";

const TIER_LABEL: Record<string, string> = { free: "FREE TRIAL", pro: "PRO", master: "MASTER" };

type ProjStat = { active: number; completed: number };

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut, updateProfile, refresh } = useAuth();
  const [location, setLocation] = useState(user?.location || "");
  const [savingLoc, setSavingLoc] = useState(false);
  const [stats, setStats] = useState<ProjStat>({ active: 0, completed: 0 });
  const [bio, setBio] = useState(user?.bio || "");
  const [savingBio, setSavingBio] = useState(false);

  useFocusEffect(useCallback(() => {
    refresh();
    (async () => {
      try {
        const ps = await api<{ status: string }[]>("/projects");
        setStats({
          active: ps.filter((p) => p.status !== "completed").length,
          completed: ps.filter((p) => p.status === "completed").length,
        });
      } catch { /* ignore */ }
    })();
  }, [refresh]));

  if (!user) return null;

  const saveLocation = async () => {
    setSavingLoc(true);
    Haptics.selectionAsync();
    try {
      await updateProfile({ location: location.trim() } as any);
    } finally { setSavingLoc(false); }
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) Alert.alert("Photos", "Enable photo access in Settings to set a profile photo.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true, allowsEditing: true, aspect: [1, 1],
    });
    if (!res.canceled && res.assets?.[0]?.base64) {
      await updateProfile({ avatar_base64: res.assets[0].base64 } as any);
    }
  };

  const saveBio = async () => {
    setSavingBio(true);
    Haptics.selectionAsync();
    try { await updateProfile({ bio: bio.trim() } as any); } finally { setSavingBio(false); }
  };

  const toggleShare = async (v: boolean) => {
    Haptics.selectionAsync();
    await updateProfile({ share_public: v } as any);
  };

  const logout = async () => {
    await signOut();
    router.replace("/onboarding");
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable testID="profile-avatar-pick" style={styles.bigAvatar} onPress={pickAvatar}>
            {user.avatar_base64 ? (
              <Image source={{ uri: `data:image/jpeg;base64,${user.avatar_base64}` }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <Text style={styles.bigAvatarText}>{(user.name || user.email).charAt(0).toUpperCase()}</Text>
            )}
            <View style={styles.avatarEdit}><MaterialCommunityIcons name="camera" size={12} color={colors.onBrandPrimary} /></View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{user.name || "DIYer"}</Text>
            <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
          </View>
          <View style={styles.tierBadge}>
            <Text style={styles.tierText}>{TIER_LABEL[user.subscription_tier] || "FREE"}</Text>
          </View>
        </View>

        {/* one-line bio */}
        <View style={styles.bioRow}>
          <TextInput
            testID="profile-bio-input"
            style={styles.bioInput}
            placeholder="Add a one-line bio (e.g. Weekend warrior in Austin)"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={bio}
            onChangeText={setBio}
            maxLength={80}
          />
          {bio.trim() !== (user.bio || "") && (
            <Pressable testID="profile-save-bio" style={styles.bioSave} onPress={saveBio} disabled={savingBio}>
              <Text style={styles.bioSaveText}>{savingBio ? "…" : "SAVE"}</Text>
            </Pressable>
          )}
        </View>

        {/* counters */}
        <View style={styles.counterRow}>
          <View style={styles.counter}>
            <Text style={styles.counterNum} testID="profile-credits">{user.credits}</Text>
            <Text style={styles.counterLabel}>TEXT CREDITS</Text>
          </View>
          <View style={styles.counterDivider} />
          <View style={styles.counter}>
            <Text style={styles.counterNum}>{user.voice_minutes}</Text>
            <Text style={styles.counterLabel}>VOICE MIN</Text>
          </View>
        </View>

        {/* quick project stats */}
        <View style={styles.statsRow}>
          <Pressable style={styles.statCard} onPress={() => router.push("/")}>
            <Text style={styles.statNum}>{stats.active}</Text>
            <Text style={styles.statLabel}>ACTIVE PROJECTS</Text>
          </Pressable>
          <Pressable style={styles.statCard} onPress={() => router.push("/")}>
            <Text style={styles.statNum}>{stats.completed}</Text>
            <Text style={styles.statLabel}>COMPLETED</Text>
          </Pressable>
        </View>

        {/* manage account menu */}
        <Text style={styles.sectionLabel}>MANAGE ACCOUNT</Text>
        <View style={styles.menuCard}>
          <MenuRow icon="trophy-outline" label="My Journey" sub={`${stats.completed} completed · achievements & savings`}
            testID="profile-journey" onPress={() => router.push("/journey")} />
          <MenuRow icon="home-heart-outline" label="My Home" sub="Rooms, systems & lifetime home record"
            testID="profile-home" onPress={() => router.push("/home-profile")} />
          <MenuRow icon="file-document-outline" label="Home Portfolio & Docs" sub="Export & share records for insurance / resale"
            testID="profile-portfolio" onPress={() => router.push("/portfolio")} />
          <MenuRow icon="home-city-outline" label="Listing / Real Estate Mode" sub="Resale-ready report: value-add, disclosures & agent share"
            testID="profile-realestate" onPress={() => router.push("/realestate")} />
          <MenuRow icon="account-hard-hat-outline" label="Find a Pro" sub="Vetted local pros for above-DIY jobs"
            testID="profile-pros" onPress={() => router.push("/pros")} />
          <MenuRow icon="shield-alert-outline" label="Report an Emergency" sub="Storm, flood, fire, burst pipe — instant triage"
            testID="profile-emergency" onPress={() => router.push("/emergency")} />
          <MenuRow icon="map-marker-radius" label="My Neighborhood" sub="Nearby projects, borrow tools & ask locals"
            testID="profile-neighborhood" onPress={() => router.push("/neighborhood")} />
          <MenuRow icon="medal-outline" label="Rewards & Recognition" sub="Badges, credits, leaderboard & local impact"
            testID="profile-loyalty" onPress={() => router.push("/loyalty")} />
          <MenuRow icon="recycle-variant" label="Materials Exchange" sub="Give, get & recycle surplus materials nearby"
            testID="profile-circular" onPress={() => router.push("/circular")} />
          <MenuRow icon="cart-percent" label="Neighborhood Bulk Buying" sub="Group orders for wholesale discounts"
            testID="profile-bulk" onPress={() => router.push("/bulk")} />
          <MenuRow icon="warehouse" label="Order Materials" sub="Wholesale suppliers · bulk & RFQ ordering"
            testID="profile-suppliers" onPress={() => router.push("/suppliers")} />
          <MenuRow icon={user?.is_pro ? "briefcase-check-outline" : "hammer-wrench"} label={user?.is_pro ? "Pro Dashboard" : "Become a Pro"} sub={user?.is_pro ? "Manage client jobs, proposals & invoices" : "Run your contracting business on DIYhomie"}
            testID="profile-pro" onPress={() => router.push("/pro")} />
          <MenuRow icon="handshake-outline" label="My Pro Jobs" sub="Proposals & jobs from contractors"
            testID="profile-client-jobs" onPress={() => router.push("/jobs")} />
          <MenuRow icon="credit-card-outline" label="Billing & Plan" sub="Card, invoices, subscription"
            testID="profile-billing" onPress={() => router.push("/settings/billing")} />
          <MenuRow icon="folder-multiple-outline" label="My Projects" sub={`${stats.active} active · ${stats.completed} done`}
            testID="profile-projects" onPress={() => router.push("/")} />
          <MenuRow icon="lifebuoy" label="My Support" sub="Tickets & help"
            testID="profile-support" onPress={() => router.push("/support/tickets")} />
          <MenuRow icon="gift-outline" label="Share & Earn $5" sub="Invite friends — you both get credit"
            testID="profile-referrals" onPress={() => router.push("/referrals")} />
          <MenuRow icon="translate" label="Language" sub="App & guide language"
            testID="profile-language" onPress={() => router.push("/settings/language")} />
          <MenuRow icon="frequently-asked-questions" label="Help & FAQ" sub="Answers to common questions"
            testID="profile-faq" onPress={() => router.push("/support/faq")} />
          <MenuRow icon="palette-swatch-outline" label="Personalize" sub="Avatar, voice, AR overlays & app theme"
            testID="profile-personalize" onPress={() => router.push("/personalize")} />
          <MenuRow icon="api" label="Developer & API" sub="API keys, webhooks & platform integrations"
            testID="profile-developer" onPress={() => router.push("/developer")} />
          <MenuRow icon="flask-outline" label="Beta Features" sub="Try experiments early & shape what ships"
            testID="profile-beta" onPress={() => router.push("/beta")} last />
        </View>

        {/* profile facts */}
        <Text style={styles.sectionLabel}>YOUR PROFILE</Text>
        <View style={styles.factList}>
          <Fact icon="medal-outline" label="Experience" value={user.experience || "—"} />
          <Fact icon="cash" label="Budget" value={user.budget || "—"} />
          <Fact icon="target" label="Goal" value={user.expectation || "—"} last />
        </View>

        {/* tools */}
        <Text style={styles.sectionLabel}>TOOL SHED</Text>
        <View style={styles.toolWrap}>
          {(user.tools && user.tools.length > 0 ? user.tools : ["None / Basic Hand Tools"]).map((t) => (
            <View key={t} style={styles.toolChip}>
              <MaterialCommunityIcons name="wrench" size={13} color={colors.onBrandTertiary} />
              <Text style={styles.toolChipText}>{t}</Text>
            </View>
          ))}
        </View>

        {/* location */}
        <Text style={styles.sectionLabel}>LOCATION (FOR LOCAL CODES)</Text>
        <View style={styles.locRow}>
          <TextInput
            testID="profile-location-input"
            style={styles.locInput}
            placeholder="City or ZIP (e.g. Austin, TX)"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={location}
            onChangeText={setLocation}
          />
          <Pressable testID="profile-save-location" style={styles.locSave} onPress={saveLocation} disabled={savingLoc}>
            <Text style={styles.locSaveText}>{savingLoc ? "…" : "SAVE"}</Text>
          </Pressable>
        </View>

        {/* public journey toggle (Sheet #11) */}
        <View style={styles.shareCard}>
          <MaterialCommunityIcons name="earth" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.shareCardTitle}>Public journey</Text>
            <Text style={styles.shareCardSub}>Let others view your timeline & achievements.</Text>
          </View>
          <Switch
            testID="profile-share-toggle"
            value={!!user.share_public}
            onValueChange={toggleShare}
            trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
            thumbColor={colors.onBrandPrimary}
          />
        </View>

        {/* upgrade — only for free users */}
        {user.subscription_tier === "free" && (
          <Pressable testID="profile-upgrade" style={styles.upgrade} onPress={() => router.push("/paywall")}>
            <View style={{ flex: 1 }}>
              <Text style={styles.upgradeTitle}>UPGRADE YOUR PLAN</Text>
              <Text style={styles.upgradeSub}>More credits, more voice minutes, priority Homie.</Text>
            </View>
            <MaterialCommunityIcons name="rocket-launch-outline" size={26} color={colors.onBrandPrimary} />
          </Pressable>
        )}

        <Pressable testID="profile-logout" style={styles.logout} onPress={logout}>
          <MaterialCommunityIcons name="logout" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ icon, label, value, last }: { icon: any; label: string; value: string; last?: boolean }) {
  return (
    <View style={[factStyles.row, !last && factStyles.border]}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.brandPrimary} />
      <Text style={factStyles.label}>{label}</Text>
      <Text style={factStyles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const factStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  border: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  label: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
  value: { flex: 1, color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, textAlign: "right" },
});

function MenuRow({ icon, label, sub, onPress, testID, last }: { icon: any; label: string; sub?: string; onPress: () => void; testID?: string; last?: boolean }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [menuStyles.row, !last && menuStyles.border, pressed && { opacity: 0.6 }]}>
      <View style={menuStyles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={menuStyles.label}>{label}</Text>
        {!!sub && <Text style={menuStyles.sub} numberOfLines={1}>{sub}</Text>}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const menuStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  border: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  iconWrap: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  label: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl },
  bigAvatar: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  bigAvatarText: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 28 },
  avatarImg: { width: "100%", height: "100%" },
  avatarEdit: { position: "absolute", bottom: 0, right: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandPrimary, borderColor: colors.surface, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  bioRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: -spacing.md, marginBottom: spacing.xl },
  bioInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.medium, fontSize: type.sm },
  bioSave: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  bioSaveText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.sm },
  shareCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.xl },
  shareCardTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
  shareCardSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  name: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.xl },
  email: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm },
  tierBadge: { backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  tierText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 0.5 },
  counterRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.xl },
  counter: { flex: 1, alignItems: "center" },
  counterNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 44, lineHeight: 46 },
  counterLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  counterDivider: { width: 1, height: 48, backgroundColor: colors.borderStrong },
  statsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xl },
  statCard: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: spacing.lg, borderColor: colors.border, borderWidth: 1 },
  statNum: { color: colors.brandPrimary, fontFamily: font.display, fontSize: 36, lineHeight: 38 },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 10, letterSpacing: 1, marginTop: 2 },
  menuCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.xl },
  sectionLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1.5, marginBottom: spacing.sm },
  factList: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, borderColor: colors.border, borderWidth: 1, marginBottom: spacing.xl },
  toolWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xl },
  toolChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  toolChipText: { color: colors.onBrandTertiary, fontFamily: font.bold, fontSize: type.sm },
  locRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xl },
  locInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.medium, fontSize: type.base },
  locSave: { backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.lg, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  locSaveText: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.sm, letterSpacing: 1 },
  upgrade: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg },
  refer: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderColor: colors.brandPrimary, borderWidth: 1.5, marginBottom: spacing.lg },
  referIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  referTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base, letterSpacing: 0.5 },
  referSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.sm, marginTop: 1 },
  upgradeTitle: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 0.5 },
  upgradeSub: { color: colors.onBrandPrimary, fontFamily: font.regular, fontSize: type.sm, opacity: 0.85, marginTop: 1 },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  logoutText: { color: colors.error, fontFamily: font.bold, fontSize: type.base },
});
