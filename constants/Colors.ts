const PRIMARY_GREEN = '#16834A';
const PRIMARY_GREEN_DARK = '#0f5c34';
const PRIMARY_GREEN_LIGHT = '#d1fae5';

export const Colors = {
  primary: PRIMARY_GREEN,
  primaryDark: PRIMARY_GREEN_DARK,
  primaryLight: PRIMARY_GREEN_LIGHT,
  white: '#FFFFFF',
  background: '#F7F9F8',
  cardBg: '#FFFFFF',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  shadow: '#000000',
  tabBarBg: '#FFFFFF',
  tabBarActive: PRIMARY_GREEN,
  tabBarInactive: '#9CA3AF',
};

// Keep backwards compat for any existing code referencing the old shape
export default {
  light: {
    text: Colors.textPrimary,
    background: Colors.background,
    tint: PRIMARY_GREEN,
    tabIconDefault: Colors.tabBarInactive,
    tabIconSelected: PRIMARY_GREEN,
  },
  dark: {
    text: Colors.textPrimary,
    background: Colors.background,
    tint: PRIMARY_GREEN,
    tabIconDefault: Colors.tabBarInactive,
    tabIconSelected: PRIMARY_GREEN,
  },
};
