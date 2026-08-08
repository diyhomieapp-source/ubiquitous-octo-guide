import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, spacing, radius, font, type } from "@/src/theme";
import { Button } from "./Button";

/** Empty state — explains what belongs here and offers one clear action. */
export function EmptyState({
  icon = "inbox-outline", title, message, actionLabel, onAction, testID,
}: {
  icon?: string; title: string; message: string; actionLabel?: string; onAction?: () => void; testID?: string;
}) {
  return (
    <View testID={testID} style={styles.wrap} accessibilityLabel={`${title}. ${message}`}>
      <MaterialCommunityIcons name={icon as any} size={40} color={colors.onSurfaceTertiary} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.msg}>{message}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} style={{ marginTop: spacing.md }} testID={testID ? `${testID}-action` : undefined} /> : null}
    </View>
  );
}

/** Loading state — never a blank screen. */
export function LoadingState({ message = "Loading…", testID }: { message?: string; testID?: string }) {
  return (
    <View testID={testID} style={styles.wrap} accessibilityLabel={message} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.brandPrimary} />
      <Text style={styles.msg}>{message}</Text>
    </View>
  );
}

/** Error state — plain language, retry, preserve content elsewhere. */
export function ErrorState({
  title = "Something went wrong", message, onRetry, testID,
}: {
  title?: string; message: string; onRetry?: () => void; testID?: string;
}) {
  return (
    <View testID={testID} style={styles.wrap} accessibilityRole="alert" accessibilityLabel={`${title}. ${message}`}>
      <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.error} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.msg}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" icon="refresh" onPress={onRetry} style={{ marginTop: spacing.md }} testID={testID ? `${testID}-retry` : undefined} /> : null}
    </View>
  );
}

/** Offline state — explains available offline actions and pending sync. */
export function OfflineState({ pending = 0, testID }: { pending?: number; testID?: string }) {
  return (
    <View testID={testID} style={[styles.wrap, styles.offline]} accessibilityLabel="You are offline">
      <MaterialCommunityIcons name="cloud-off-outline" size={28} color={colors.warning} />
      <Text style={styles.title}>You're offline</Text>
      <Text style={styles.msg}>
        You can still view saved rooms, assets and projects. {pending > 0 ? `${pending} change${pending === 1 ? "" : "s"} will sync when you reconnect.` : "New changes will sync when you reconnect."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.xs },
  offline: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning + "55", backgroundColor: colors.warning + "12" },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: type.lg, marginTop: spacing.xs, textAlign: "center" },
  msg: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: type.base, lineHeight: 20, textAlign: "center" },
});
