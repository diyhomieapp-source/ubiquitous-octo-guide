// DIYhomie design tokens — "Dark-First Utility" personality.
export const colors = {
  surface: "#121212",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#1C1C1E",
  onSurfaceSecondary: "#E0E0E0",
  surfaceTertiary: "#2C2C2E",
  onSurfaceTertiary: "#A0A0A5",
  surfaceInverse: "#E0E0E0",
  onSurfaceInverse: "#121212",
  brand: "#FF5A00",
  brandPrimary: "#FF5A00",
  onBrandPrimary: "#000000",
  brandSecondary: "#E65100",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#3E2010",
  onBrandTertiary: "#FF8A50",
  success: "#00E676",
  onSuccess: "#000000",
  warning: "#FFC400",
  onWarning: "#000000",
  error: "#FF3D00",
  onError: "#FFFFFF",
  info: "#29B6F6",
  border: "#2C2C2E",
  borderStrong: "#4A4A4D",
  divider: "#2C2C2E",
  ecoMode: "#8C9BA5",
  onEcoMode: "#121212",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const font = {
  display: "BebasNeue",
  regular: "DMSans",
  medium: "DMSans-Medium",
  bold: "DMSans-Bold",
};

export const type = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 48,
};

// ---- Blueprint 40: extended foundation tokens ----

// Elevation (shadow presets) — flat, raised, modal, critical alert.
export const elevation = {
  flat: {},
  raised: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.24, shadowRadius: 6, elevation: 2 },
  modal: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.36, shadowRadius: 20, elevation: 8 },
  critical: { shadowColor: "#FF3D00", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 12 },
} as const;

// Motion durations (ms). Reduced-motion consumers should use `motion.reduced`.
export const motion = { fast: 120, standard: 240, slow: 400, reduced: 0 } as const;

// Semantic typography roles — pair a font family + size for consistent hierarchy.
export const typography = {
  display: { fontFamily: font.display, fontSize: 32 },
  heading: { fontFamily: font.bold, fontSize: 20 },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 12 },
  button: { fontFamily: font.bold, fontSize: 14 },
  numeric: { fontFamily: font.display, fontSize: 24 },
} as const;

// Safety UI palette — color is always paired with an icon + text, never color alone.
export const safety = {
  safe: { color: "#00E676", icon: "check-circle-outline", label: "Safe to Continue" },
  verify: { color: "#FFC400", icon: "alert-outline", label: "Verify First" },
  stop: { color: "#FF6A00", icon: "hand-back-right-outline", label: "Stop and Escalate" },
  emergency: { color: "#FF3D00", icon: "alarm-light-outline", label: "Emergency" },
} as const;

// Accessibility constants.
export const a11y = { minTouchTarget: 44 } as const;

