import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type, typography } from "@/src/theme";
import { api } from "@/src/api";
import { Button, SafetyCard, AIResponseCard, EmptyState, LoadingState, ErrorState, OfflineState } from "@/src/components/ui";

export default function DesignSystemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tokens, setTokens] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busyDemo, setBusyDemo] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<any>("/hi/design/foundation", { auth: false });
      setTokens(res);
    } catch { setTokens(null); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="ds-back" onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back" accessibilityRole="button">
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Design System</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.xl }}>
        <Text style={styles.intro}>Blueprint 40 — the shared visual, safety and accessibility language used across every DIYhomie surface.</Text>

        <Section title="Buttons">
          <View style={{ gap: spacing.sm }}>
            <Button testID="ds-primary" label="Primary action" icon="check" onPress={() => {}} />
            <Button testID="ds-secondary" label="Secondary action" variant="secondary" icon="pencil-outline" onPress={() => {}} />
            <Button testID="ds-danger" label="Danger action" variant="danger" icon="trash-can-outline" onPress={() => {}} />
            <Button testID="ds-loading" label="Loading" loading={busyDemo} onPress={() => { setBusyDemo(true); setTimeout(() => setBusyDemo(false), 1200); }} />
            <Button testID="ds-disabled" label="Disabled" disabled onPress={() => {}} />
          </View>
        </Section>

        <Section title="Safety statuses">
          <View style={{ gap: spacing.sm }}>
            <SafetyCard testID="ds-safe" level="safe" message="Standard DIY steps apply. Follow the guide at your own pace." />
            <SafetyCard testID="ds-verify" level="verify" message="Check the breaker label matches this circuit before continuing." />
            <SafetyCard testID="ds-stop" level="stop" message="This involves gas lines. Stop and contact a licensed professional.">
              <Button label="Find a pro" icon="account-hard-hat" onPress={() => {}} />
            </SafetyCard>
            <SafetyCard testID="ds-emergency" level="emergency" message="If you smell gas, leave now and call your gas utility from outside.">
              <Button label="Emergency steps" variant="danger" icon="alarm-light-outline" onPress={() => {}} />
            </SafetyCard>
          </View>
        </Section>

        <Section title="AI response card">
          <AIResponseCard
            testID="ds-ai"
            summary="I found your Rheem water heater manual and one overdue maintenance task."
            confidence="high"
            safetyLevel="verify"
            safetyMessage="Turn off power at the breaker before draining the tank."
            sections={[
              { icon: "lightbulb-on-outline", title: "Why this applies", body: "Your garage asset is a Rheem XE50, which matches this manual." },
              { icon: "arrow-right-circle-outline", title: "Next action", body: "Flush the tank to clear sediment (about 30 minutes)." },
              { icon: "toolbox-outline", title: "Tools & materials", body: "Garden hose, flathead screwdriver, bucket." },
              { icon: "book-open-variant", title: "Source", body: "Rheem XE50 owner's manual, page 14." },
            ]}
          />
        </Section>

        <Section title="States">
          <View style={{ gap: spacing.md }}>
            <View style={styles.stateBox}><EmptyState testID="ds-empty" icon="home-plus-outline" title="No rooms yet" message="Add your first room to start building your home profile." actionLabel="Add a room" onAction={() => {}} /></View>
            <View style={styles.stateBox}><LoadingState testID="ds-loadingstate" message="Loading your home…" /></View>
            <View style={styles.stateBox}><ErrorState testID="ds-error" message="We couldn't load your projects. Your work is safe." onRetry={() => {}} /></View>
            <OfflineState testID="ds-offline" pending={2} />
          </View>
        </Section>

        <Section title="Design tokens">
          {loading ? <LoadingState /> : !tokens ? (
            <ErrorState message="Couldn't load tokens from the server." onRetry={load} />
          ) : (
            <View style={{ gap: spacing.md }}>
              <Text style={styles.tokenLabel}>Color</Text>
              <View style={styles.swatchRow}>
                {Object.entries(tokens.tokens.color).slice(0, 12).map(([k, v]) => (
                  <View key={k} style={styles.swatchItem}>
                    <View style={[styles.swatch, { backgroundColor: v as string }]} />
                    <Text style={styles.swatchName}>{k}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.tokenLabel}>Typography roles</Text>
              <Text style={[typography.display, { color: colors.onSurface }]}>Display</Text>
              <Text style={[typography.heading, { color: colors.onSurface }]}>Heading</Text>
              <Text style={[typography.body, { color: colors.onSurfaceSecondary }]}>Body — primary reading text for guidance.</Text>
              <Text style={[typography.caption, { color: colors.onSurfaceTertiary }]}>Caption — meta / secondary</Text>
              <Text style={styles.tokenLabel}>Consumer navigation</Text>
              <Text style={styles.navLine}>{(tokens.consumer_navigation || []).map((n: any) => n.label).join("  ·  ")}</Text>
            </View>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg },
  intro: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20 },
  sectionTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  stateBox: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  tokenLabel: { color: colors.onSurfaceTertiary, fontFamily: font.bold, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  swatchItem: { alignItems: "center", width: 64 },
  swatch: { width: 44, height: 44, borderRadius: radius.sm, borderColor: colors.border, borderWidth: 1 },
  swatchName: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: 9, marginTop: 4, textAlign: "center" },
  navLine: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.base },
});
