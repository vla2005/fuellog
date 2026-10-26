import { Platform, TextStyle, ViewStyle } from 'react-native';

export interface ThemeColors {
  canvas: string;
  surface: string;
  elevated: string;
  subtle: string;
  bgPrimary: string;
  bgSecondary: string;
  bgElevated: string;
  bgHero: string;
  dockBackground: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderSubtle: string;
  borderFocus: string;
  borderDefault: string;
  borderStrong: string;
  brandPrimary: string;
  brandPressed: string;
  brandSoft: string;
  brandNavy: string;
  accentPrimary: string;
  accentPressed: string;
  accentSoft: string;
  onBrand: string;
  statusSuccess: string;
  statusSuccessSoft: string;
  statusSuccessBorder: string;
  successText: string;
  successSoft: string;
  successBorder: string;
  statusWarning: string;
  statusWarningSoft: string;
  statusWarningBorder: string;
  warningText: string;
  warningSoft: string;
  warningBorder: string;
  statusDanger: string;
  statusDangerSoft: string;
  statusDangerBorder: string;
  dangerText: string;
  dangerSoft: string;
  dangerBorder: string;
  infoText: string;
  infoSoft: string;
  infoBorder: string;
  backdrop: string;
  scrim: string;
  mascotSkin: string;
}

const LIGHT_CANONICAL = {
  canvas: '#F5F3EE',
  surface: '#FFFFFF',
  elevated: '#F8F7F3',
  subtle: '#EDEAE2',
  textPrimary: '#111D35',
  textSecondary: '#5F6878',
  textMuted: '#8A93A3',
  borderSubtle: '#DFDDD5',
  borderFocus: '#1D59F2',
  brandPrimary: '#1D59F2',
  brandPressed: '#1545C7',
  brandSoft: '#EAF1FF',
  brandNavy: '#111D35',
  statusSuccess: '#15803D',
  statusWarning: '#B54708',
  statusDanger: '#D92D20',
} as const;

const DARK_CANONICAL = {
  canvas: '#080E18',
  surface: '#111A29',
  elevated: '#152238',
  subtle: '#162338',
  textPrimary: '#FFFFFF',
  textSecondary: '#7E8EAA',
  textMuted: '#62728D',
  borderSubtle: '#1A2840',
  borderFocus: '#186AFF',
  brandPrimary: '#186AFF',
  brandPressed: '#1256D6',
  brandSoft: '#13284C',
  brandNavy: '#080E18',
  statusSuccess: '#22C55E',
  statusWarning: '#F59E0B',
  statusDanger: '#F87171',
} as const;

export const LIGHT_COLORS: ThemeColors = {
  ...LIGHT_CANONICAL,
  bgPrimary: LIGHT_CANONICAL.canvas,
  bgSecondary: LIGHT_CANONICAL.subtle,
  bgElevated: LIGHT_CANONICAL.surface,
  bgHero: LIGHT_CANONICAL.surface,
  dockBackground: LIGHT_CANONICAL.elevated,
  borderDefault: LIGHT_CANONICAL.borderSubtle,
  borderStrong: LIGHT_CANONICAL.borderFocus,
  accentPrimary: LIGHT_CANONICAL.brandPrimary,
  accentPressed: LIGHT_CANONICAL.brandPressed,
  accentSoft: LIGHT_CANONICAL.brandSoft,
  onBrand: '#FFFFFF',
  statusSuccessSoft: '#ECFDF3',
  statusSuccessBorder: '#ABEFC6',
  successText: LIGHT_CANONICAL.statusSuccess,
  successSoft: '#ECFDF3',
  successBorder: '#ABEFC6',
  statusWarningSoft: '#FEF6EE',
  statusWarningBorder: '#F9DBAF',
  warningText: LIGHT_CANONICAL.statusWarning,
  warningSoft: '#FEF6EE',
  warningBorder: '#F9DBAF',
  statusDangerSoft: '#FEF3F2',
  statusDangerBorder: '#FECDCA',
  dangerText: LIGHT_CANONICAL.statusDanger,
  dangerSoft: '#FEF3F2',
  dangerBorder: '#FECDCA',
  infoText: LIGHT_CANONICAL.brandPrimary,
  infoSoft: LIGHT_CANONICAL.brandSoft,
  infoBorder: LIGHT_CANONICAL.borderFocus,
  backdrop: 'rgba(9, 15, 26, 0.45)',
  scrim: 'rgba(9, 15, 26, 0.45)',
  mascotSkin: '#FFD39A',
};

export const DARK_COLORS: ThemeColors = {
  ...DARK_CANONICAL,
  bgPrimary: DARK_CANONICAL.canvas,
  bgSecondary: DARK_CANONICAL.subtle,
  bgElevated: DARK_CANONICAL.surface,
  bgHero: DARK_CANONICAL.surface,
  dockBackground: DARK_CANONICAL.elevated,
  borderDefault: DARK_CANONICAL.borderSubtle,
  borderStrong: DARK_CANONICAL.borderFocus,
  accentPrimary: DARK_CANONICAL.brandPrimary,
  accentPressed: DARK_CANONICAL.brandPressed,
  accentSoft: DARK_CANONICAL.brandSoft,
  onBrand: '#FFFFFF',
  statusSuccessSoft: '#0D2818',
  statusSuccessBorder: '#166534',
  successText: DARK_CANONICAL.statusSuccess,
  successSoft: '#0D2818',
  successBorder: '#166534',
  statusWarningSoft: '#2E1F0B',
  statusWarningBorder: '#854D0E',
  warningText: DARK_CANONICAL.statusWarning,
  warningSoft: '#2E1F0B',
  warningBorder: '#854D0E',
  statusDangerSoft: '#2D1418',
  statusDangerBorder: '#991B1B',
  dangerText: DARK_CANONICAL.statusDanger,
  dangerSoft: '#2D1418',
  dangerBorder: '#991B1B',
  infoText: DARK_CANONICAL.borderFocus,
  infoSoft: DARK_CANONICAL.brandSoft,
  infoBorder: DARK_CANONICAL.borderFocus,
  backdrop: 'rgba(5, 9, 16, 0.65)',
  scrim: 'rgba(5, 9, 16, 0.65)',
  mascotSkin: '#FFD39A',
};

export const FONTS = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semiBold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extraBold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const RADIUS = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 24,
  sheet: 28,
  pill: 999,
} as const;

export const radii = RADIUS;

export const layout = {
  horizontalPadding: 20,
  bottomDockClearance: 104,
} as const;

export const typography: Record<
  | 'heroValue'
  | 'screenTitle'
  | 'sectionTitle'
  | 'cardTitle'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'overline'
  | 'numericInput',
  TextStyle
> = {
  heroValue: {
    fontFamily: FONTS.extraBold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  screenTitle: {
    fontFamily: FONTS.bold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  sectionTitle: {
    fontFamily: FONTS.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  cardTitle: {
    fontFamily: FONTS.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: FONTS.regular,
    fontSize: 15,
    lineHeight: 21,
  },
  bodyStrong: {
    fontFamily: FONTS.semiBold,
    fontSize: 15,
    lineHeight: 21,
  },
  caption: {
    fontFamily: FONTS.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  overline: {
    fontFamily: FONTS.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.7,
  },
  numericInput: {
    fontFamily: FONTS.bold,
    fontSize: 18,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
};

export const shadows: Record<'lightCard' | 'lightFloating' | 'darkCard', ViewStyle> = {
  lightCard: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#111D35',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.06,
      shadowRadius: 14,
    },
    android: {
      elevation: 2,
    },
    default: {},
  })!,
  lightFloating: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#1D59F2',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 18,
    },
    android: {
      elevation: 5,
    },
    default: {},
  })!,
  darkCard: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.28,
      shadowRadius: 16,
    },
    android: {
      elevation: 3,
    },
    default: {},
  })!,
};

export const BREAKPOINTS = {
  narrow: 350,
  base: 390,
  maxMobile: 430,
} as const;
