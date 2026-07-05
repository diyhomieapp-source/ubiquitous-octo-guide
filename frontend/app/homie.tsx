import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Easing, Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";

import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { AvatarStage, AvatarState } from "@/src/components/AvatarStage";

const STARTERS = ["Fix a leaky faucet", "Patch a wall hole", "Paint a room", "Install a shelf"];

const WELCOME = "Hey — I'm Homie. Tell me what you want to build, fix or upgrade, and I'll walk you through it step by step.";

export default function HomieLive() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [state, setState] = useState<AvatarState>("idle");
  const [caption, setCaption] = useState(WELCOME);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // slide-in composer animation (0 hidden → 1 shown)
  const slide = useRef(new Animated.Value(0)).current;
  const animateComposer = useCallback((show: boolean) => {
    Animated.spring(slide, { toValue: show ? 1 : 0, useNativeDriver: true, friction: 9, tension: 80 }).start();
  }, [slide]);

  const openType = () => {
    Haptics.selectionAsync();
    setTyping(true);
    setCaption("Go ahead — type what you need. Even a few words works.");
    animateComposer(true);
    setTimeout(() => inputRef.current?.focus(), 120);
  };
  const closeType = () => {
    Keyboard.dismiss();
    animateComposer(false);
    setTyping(false);
    setInput("");
    setState("idle");
    setCaption(WELCOME);
  };

  useEffect(() => () => slide.stopAnimation(), [slide]);

  const composerY = slide.interpolate({ inputRange: [0, 1], outputRange: [140, 0] });
  const composerOpacity = slide;

  const mic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setState("listening");
    setCaption("Live voice is coming soon — tap “Type” and tell me for now.");
    setTimeout(() => { setState("idle"); setCaption(WELCOME); }, 2600);
  };

  const start = async (title: string) => {
    const t = title.trim();
    if (!t || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();
    setBusy(true);
    setState("thinking");
    setCaption(`Got it — “${t}”. Let me build your step-by-step plan…`);
    try {
      const proj = await api<{ id: string }>("/projects", { method: "POST", body: { title: t, location: user?.location || "" } });
      await storage.setItem("diyhomie_active_project", proj.id);
      setState("speaking");
      setCaption("Your plan is ready — let's go.");
      setInput("");
      animateComposer(false);
      setTyping(false);
      setTimeout(() => router.push(`/project/${proj.id}?new=1`), 500);
    } catch {
      setState("idle");
      setCaption("Something went wrong starting that. Mind trying again?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable testID="homie-back" hitSlop={12} onPress={() => router.back()} style={styles.iconBtn}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#fff" />
        </Pressable>
        <View style={styles.creditPill}>
          <MaterialCommunityIcons name="lightning-bolt" size={13} color="#FF6A00" />
          <Text style={styles.creditText}>{user?.credits ?? 0}</Text>
        </View>
      </View>

      {/* full-height avatar presence */}
      <AvatarStage state={state} caption={caption} />

      {/* bottom interaction zone */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {!typing && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {STARTERS.map((s) => (
                <Pressable key={s} testID={`homie-starter-${s}`} style={styles.chip} onPress={() => start(s)} disabled={busy}>
                  <Text style={styles.chipText}>{s}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.controls}>
              <Pressable testID="homie-mic" style={styles.micBtn} onPress={mic} disabled={busy}>
                <MaterialCommunityIcons name="microphone" size={30} color="#000" />
              </Pressable>
              <Pressable testID="homie-type" style={styles.typeBtn} onPress={openType} disabled={busy}>
                <MaterialCommunityIcons name="keyboard-outline" size={18} color="#fff" />
                <Text style={styles.typeText}>Type</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* slide-in composer */}
        {typing && (
          <Animated.View style={[styles.composerWrap, { transform: [{ translateY: composerY }], opacity: composerOpacity }]}>
            <BlurView intensity={40} tint="dark" style={styles.composer}>
              <Pressable testID="homie-composer-close" hitSlop={8} onPress={closeType} style={styles.composerClose}>
                <MaterialCommunityIcons name="close" size={20} color="rgba(255,255,255,0.6)" />
              </Pressable>
              <TextInput
                ref={inputRef}
                testID="homie-input"
                style={styles.input}
                placeholder="What are we building?"
                placeholderTextColor="rgba(255,255,255,0.45)"
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => start(input)}
                returnKeyType="go"
                multiline={false}
              />
              <Pressable testID="homie-send" style={[styles.sendBtn, (!input.trim() || busy) && { opacity: 0.5 }]} onPress={() => start(input)} disabled={!input.trim() || busy}>
                {busy ? <ActivityIndicator color="#000" size="small" /> : <MaterialCommunityIcons name="arrow-up" size={24} color="#000" />}
              </Pressable>
            </BlurView>
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1 },
  creditPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  creditText: { color: "#fff", fontFamily: "DMSans-Bold", fontSize: 13 },

  bottom: { paddingHorizontal: 16 },
  chips: { gap: 8, paddingBottom: 16, paddingRight: 16 },
  chip: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  chipText: { color: "rgba(255,255,255,0.85)", fontFamily: "DMSans-Medium", fontSize: 14 },

  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  micBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#FF6A00", alignItems: "center", justifyContent: "center", shadowColor: "#FF6A00", shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  typeBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.14)", borderWidth: 1, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 999 },
  typeText: { color: "#fff", fontFamily: "DMSans-Bold", fontSize: 15 },

  composerWrap: { width: "100%" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, paddingLeft: 8, paddingRight: 5, paddingVertical: 5, overflow: "hidden", borderColor: "rgba(255,255,255,0.15)", borderWidth: 1, backgroundColor: "rgba(20,20,20,0.6)" },
  composerClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, color: "#fff", fontFamily: "DMSans-Medium", fontSize: 17, paddingVertical: 12 },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#FF6A00", alignItems: "center", justifyContent: "center" },
});
