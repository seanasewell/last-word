// Player feedback (Settings → Send feedback). Saved in Supabase's `feedback` table for the developer to read.
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export type FeedbackKind = 'idea' | 'problem' | 'other';

/** Sends feedback. Returns an error message, or null when it was sent. */
export async function sendFeedback(kind: FeedbackKind, message: string): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('submit_feedback', {
      p_kind: kind, p_message: message.trim(),
      p_app_version: Constants.expoConfig?.version ?? null, p_platform: Platform.OS,
    });
    if (!error) return null;
    const m = error.message;
    return /under 2,000|a lot of feedback|Write a message|Pick a type/.test(m) ? m : 'Couldn’t send your feedback. Check your connection and try again.';
  } catch {
    return 'Couldn’t send your feedback. Check your connection and try again.';
  }
}
