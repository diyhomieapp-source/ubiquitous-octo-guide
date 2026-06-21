import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";

export default function Auth() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { signIn, signUp, updateProfile } = useAuth();

  const [mode, setMode] = useState<"login" | "register">(params.mode === "login" ? "login" : "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (mode === "register") {
        await signUp(email.trim(), password, name.trim());
        const raw = await storage.getItem<string>("diyhomie_pending_survey", "");
        if (raw) {
          try {
            const survey = JSON.parse(raw);
            await updateProfile(survey);
          } catch {}
          await storage.removeItem("diyhomie_pending_survey");
        }
        router.replace("/paywall");
      } else {
        const u = await signIn(email.trim(), password);
        router.replace(u.onboarded ? "/(tabs)" : "/paywall");
      }
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable testID="auth-back-button" onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurfaceTertiary} />
        </Pressable>

        <View style={styles.logoRow}>
          <MaterialCommunityIcons name="hard-hat" size={28} color={colors.brandPrimary} />
          <Text style={styles.logo}>DIYhomie</Text>
        </View>

        <Text style={styles.title}>{mode === "register" ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</Text>
        <Text style={styles.subtitle}>
          {mode === "register" ? "Save your profile and unlock Homie." : "Pick up where you left off."}
        </Text>

        {mode === "register" && (
          <TextInput
            testID="auth-name-input"
            style={styles.input}
            placeholder="Name"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        )}
        <TextInput
          testID="auth-email-input"
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.onSurfaceTertiary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <TextInput
          testID="auth-password-input"
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.onSurfaceTertiary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {!!error && (
          <Text testID="auth-error" style={styles.error}>{error}</Text>
        )}

        <Pressable testID="auth-submit-button" style={styles.cta} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.ctaText}>{mode === "register" ? "CREATE ACCOUNT" : "LOG IN"}</Text>
          )}
        </Pressable>

        <Pressable
          testID="auth-toggle-mode"
          style={styles.toggle}
          onPress={() => { setError(""); setMode(mode === "register" ? "login" : "register"); }}
        >
          <Text style={styles.toggleText}>
            {mode === "register" ? "Already have an account? " : "New here? "}
            <Text style={{ color: colors.brandPrimary, fontFamily: font.bold }}>
              {mode === "register" ? "Log in" : "Create one"}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.xl },
  back: { alignSelf: "flex-start", marginBottom: spacing.md },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing["2xl"] },
  logo: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 2 },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 40, lineHeight: 42 },
  subtitle: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.lg, marginTop: spacing.sm, marginBottom: spacing.xl },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    color: colors.onSurface,
    fontFamily: font.medium,
    fontSize: type.lg,
    marginBottom: spacing.md,
  },
  error: { color: colors.error, fontFamily: font.medium, fontSize: type.base, marginBottom: spacing.sm },
  cta: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center", marginTop: spacing.sm },
  ctaText: { color: colors.onBrandPrimary, fontFamily: font.bold, fontSize: type.lg, letterSpacing: 1 },
  toggle: { alignItems: "center", paddingVertical: spacing.xl },
  toggleText: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: type.base },
});
