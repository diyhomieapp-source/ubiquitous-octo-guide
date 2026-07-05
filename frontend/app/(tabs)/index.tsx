import { useCallback, useRef, useState, useEffect } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Easing, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";

import { spacing, radius, font, type } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { Logo } from "@/src/components/Logo";
import { AppMenu } from "@/src/components/AppMenu";

type ProjectSummary = { id: string; title: string; status: string; progress: number };

const SUGGESTION_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"];

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<ProjectSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const suggestions = SUGGESTION_KEYS.map((k) => t(`suggestions.${k}`));

  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float]);
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });

  const load = useCallback(async () => {
    try {
      const res = await api<ProjectSummary[]>("/projects");
      setActive(res.find((p) => p.status === "active") || null);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const start = async (title: string) => {
    const t2 = title.trim();
    if (!t2 || creating) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCreating(true);
    try {
      const proj = await api<{ id: string }>("/projects", { method: "POST", body: { title: t2, location: user?.location || "" } });
      await storage.setItem("diyhomie_active_project", proj.id);
      setInput("");
      router.push(`/project/${proj.id}?new=1`);
    } catch {} finally { setCreating(false); }
  };

  const resume = async () => {
    if (!active) return;
    await storage.setItem("diyhomie_active_project", active.id);
    router.push(`/project/${active.id}`);
  };

  const mic = () => {
    Haptics.selectionAsync();
    Alert.alert("Voice", "Talk-to-Homie voice input unlocks in the iOS/Android app build. Type your project for now — Homie's got you.");
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* persistent radial backdrop glow */}
      <View style={styles.bgGlowWrap} pointerEvents="none">
        <LinearGradient
          colors={["rgba(255,106,0,0.16)", "rgba(255,106,0,0.04)", "transparent"]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* dark transparent header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="home-avatar-chip" style={styles.avatarChip} onPress={() => setMenuOpen(true)} hitSlop={8}>
          <View style={styles.chipAvatar}><Logo size="sm" showWordmark={false} animated={false} /></View>
          <Text style={styles.chipName}>Homie</Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color="rgba(255,255,255,0.6)" />
        </Pressable>
        <View style={styles.headerRight}>
          <View style={styles.creditPill}>
            <MaterialCommunityIcons name="lightning-bolt" size={13} color="#FF6A00" />
            <Text style={styles.creditText}>{user?.credits ?? 0}</Text>
          </View>
          <Pressable testID="home-notifications" style={styles.iconBtn} onPress={() => router.push("/notifications")} hitSlop={8}>
            <MaterialCommunityIcons name="bell-outline" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* avatar stage */}
      <View style={styles.stage}>
        <View style={styles.avatarGlow} pointerEvents="none" />
        <Pressable testID="home-open-live" onPress={() => { Haptics.selectionAsync(); router.push("/homie"); }}>
          <Animated.View style={[styles.avatarRing, { transform: [{ translateY }] }]}>
            <View style={styles.avatarInner}>
              <Logo size="lg" showWordmark={false} />
            </View>
          </Animated.View>
        </Pressable>
        <Text style={styles.greet}>
          {user?.name ? `Hey ${user.name.split(" ")[0]} —` : "Hey there —"}{"\n"}what are we building?
        </Text>
        <Text style={styles.greetSub}>{"Tell me any repair, project or upgrade. I'll build your step-by-step plan."}</Text>
        <Pressable testID="home-talk-live" style={styles.talkLive} onPress={() => { Haptics.selectionAsync(); router.push("/homie"); }}>
          <MaterialCommunityIcons name="account-voice" size={16} color="#FF6A00" />
          <Text style={styles.talkLiveText}>Talk to Homie live</Text>
        </Pressable>
        <Pressable testID="home-emergency" style={styles.emergencyBtn} onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); router.push("/emergency"); }}>
          <MaterialCommunityIcons name="shield-alert" size={15} color="#E5484D" />
          <Text style={styles.emergencyText}>Report an Emergency</Text>
        </Pressable>
      </View>

      {/* bottom interaction zone */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        {active && (
          <Pressable testID="home-resume" style={styles.resumePill} onPress={resume}>
            <MaterialCommunityIcons name="play-circle" size={18} color="#FF6A00" />
            <Text style={styles.resumeText} numberOfLines={1}>Resume: {active.title}</Text>
            <Text style={styles.resumePct}>{active.progress}%</Text>
          </Pressable>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {suggestions.map((s) => (
            <Pressable key={s} testID={`suggestion-${s}`} style={styles.chip} onPress={() => start(s)}>
              <Text style={styles.chipText}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <BlurView intensity={40} tint="dark" style={styles.askBar}>
          <MaterialCommunityIcons name="message-text-outline" size={20} color="rgba(255,255,255,0.5)" />
          <TextInput
            testID="home-project-input"
            style={styles.askInput}
            placeholder="Ask or type a project…"
            placeholderTextColor="rgba(255,255,255,0.45)"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => start(input)}
            returnKeyType="go"
          />
          {input.trim() ? (
            <Pressable testID="home-start-button" style={styles.sendBtn} onPress={() => start(input)} disabled={creating}>
              {creating ? <ActivityIndicator color="#000" size="small" /> : <MaterialCommunityIcons name="arrow-up" size={22} color="#000" />}
            </Pressable>
          ) : (
            <Pressable testID="home-mic" style={styles.micBtn} onPress={mic}>
              <MaterialCommunityIcons name="microphone" size={22} color="#FF6A00" />
            </Pressable>
          )}
        </BlurView>
      </View>

      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  bgGlowWrap: { position: "absolute", top: 0, left: 0, right: 0, height: "55%" },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  avatarChip: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, paddingLeft: 4, paddingRight: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  chipAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,106,0,0.18)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  chipName: { color: "#fff", fontFamily: font.bold, fontSize: type.base },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  creditPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  creditText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1 },

  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  avatarGlow: { position: "absolute", width: 300, height: 300, borderRadius: 150, backgroundColor: "rgba(255,106,0,0.14)", shadowColor: "#FF6A00", shadowOpacity: 0.6, shadowRadius: 80, shadowOffset: { width: 0, height: 0 } },
  avatarRing: { width: 168, height: 168, borderRadius: 84, borderColor: "rgba(255,106,0,0.35)", borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)" },
  avatarInner: { width: 132, height: 132, borderRadius: 66, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,106,0,0.10)" },
  greet: { color: "#fff", fontFamily: font.display, fontSize: 40, lineHeight: 40, textAlign: "center", marginTop: spacing["2xl"] },
  greetSub: { color: "rgba(255,255,255,0.55)", fontFamily: font.regular, fontSize: type.lg, lineHeight: 24, textAlign: "center", marginTop: spacing.md, maxWidth: 320 },
  talkLive: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,106,0,0.12)", borderColor: "rgba(255,106,0,0.45)", borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, marginTop: spacing.xl },
  talkLiveText: { color: "#FF6A00", fontFamily: font.bold, fontSize: type.base },
  emergencyBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(229,72,77,0.12)", borderColor: "rgba(229,72,77,0.5)", borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, marginTop: spacing.sm },
  emergencyText: { color: "#E5484D", fontFamily: font.bold, fontSize: type.sm },

  bottom: { paddingHorizontal: spacing.lg },
  resumePill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,106,0,0.4)", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md, alignSelf: "flex-start", maxWidth: "100%" },
  resumeText: { color: "#fff", fontFamily: font.bold, fontSize: type.sm, flexShrink: 1 },
  resumePct: { color: "#FF6A00", fontFamily: font.bold, fontSize: type.sm },
  chips: { gap: spacing.sm, paddingBottom: spacing.md, paddingRight: spacing.lg },
  chip: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chipText: { color: "rgba(255,255,255,0.85)", fontFamily: font.medium, fontSize: type.base },

  askBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.pill, paddingLeft: spacing.lg, paddingRight: 5, paddingVertical: 5, overflow: "hidden", borderColor: "rgba(255,255,255,0.15)", borderWidth: 1, backgroundColor: "rgba(20,20,20,0.6)" },
  askInput: { flex: 1, color: "#fff", fontFamily: font.medium, fontSize: type.lg, paddingVertical: spacing.md },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#FF6A00", alignItems: "center", justifyContent: "center" },
  micBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,106,0,0.16)", borderColor: "rgba(255,106,0,0.4)", borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
