// ── Opponent system ─────────────────────────────────────────────────────────
// Bots receive the round's source, build their own plan of real dictionary
// words they "know", and submit them over time through the same engine
// entry point as the human. Nothing is fabricated: every planned word is
// re-validated by the word engine when submitted.
import type { BotProfile } from './players';
import type { Candidate } from './words';

export interface PlannedSubmission {
  at: number; // ms after round start
  word: string;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function planBotRound(
  profile: BotProfile,
  candidates: Candidate[],
  durationMs: number,
): PlannedSubmission[] {
  // Day-to-day form: some rounds a bot is sharp, others it's off.
  const form = rand(0.78, 1.25);

  const known = candidates.filter((c) => {
    const len = c.word.length;
    const lenFactor = Math.max(0.05, 1 - profile.longPenalty * Math.max(0, len - 4));
    return Math.random() < profile.know[c.tier] * lenFactor;
  });

  const plan: PlannedSubmission[] = [];
  const used = new Set<string>();
  let t = rand(profile.warmup[0], profile.warmup[1]) * 1000;
  const end = durationMs - 400;

  while (t < end && used.size < known.length) {
    // Weighted pick: length^bias, with a little noise.
    let total = 0;
    const weights: number[] = [];
    for (const c of known) {
      const w = used.has(c.word) ? 0 : Math.pow(c.word.length, profile.lengthBias) * rand(0.6, 1.4);
      weights.push(w);
      total += w;
    }
    if (total <= 0) break;
    let r = Math.random() * total;
    let pick = known[0];
    for (let i = 0; i < known.length; i++) {
      r -= weights[i];
      if (r <= 0) { pick = known[i]; break; }
    }
    used.add(pick.word);
    plan.push({ at: Math.round(t), word: pick.word });

    // Longer words take longer to find and type.
    const lenCost = 0.55 + 0.11 * pick.word.length;
    let delay = 1.22 * rand(profile.interval[0], profile.interval[1]) * lenCost / form;
    if (Math.random() < profile.stall) delay += rand(2, 5);
    t += delay * 1000;
  }
  return plan;
}
