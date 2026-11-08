// Release settings.
/**
 * Developer controls: shown while developing and in "preview" test builds, hidden in store builds.
 * BEFORE LAUNCH also turn off the server's XP tool (Developer controls → Level tiers), which
 * any signed-in player could otherwise call: in Supabase's SQL editor run
 *   update game.dev_settings set xp_tools = false;
 */
export const SHOW_DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';

export const PRIVACY_URL = 'https://seanasewell.github.io/last-word/privacy.html';
export const TERMS_URL = 'https://seanasewell.github.io/last-word/terms.html';
export const SUPPORT_URL = 'https://seanasewell.github.io/last-word/support.html';
export const SUPPORT_EMAIL = 'sean@studiosewell.com';
