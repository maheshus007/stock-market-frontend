export type UiPreferences = {
  show_trading_automation_sidebar: boolean;
};

export type UiFeatureFlags = {
  trading_automation_enabled: boolean;
};

export const UI_FEATURE_FLAGS: UiFeatureFlags = {
  trading_automation_enabled: true,
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  show_trading_automation_sidebar: true,
};

export const UI_PREFERENCES_STORAGE_KEY = 'app:uiPrefs';
