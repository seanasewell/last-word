// ── Display-name filter ─────────────────────────────────────────────────────
// Blocks slurs and profanity in display names, including disguised spellings
// (Sh1t, f u c k, fuuuck, BigAss). The server runs the same check
// (game.name_allowed), so a name can't get past it from a modified app.
// "Anywhere" terms are blocked even inside other letters; "whole" terms only
// as a separate word, so names like Cassie or Hancock are fine.
const ANYWHERE = ['nigg', 'niga', 'nigr', 'fagg', 'kike', 'cunt', 'fuck', 'fck', 'shit', 'bitch', 'whore', 'slut', 'retard', 'tranny', 'wetback', 'nazi', 'hitler', 'porn', 'penis', 'vagina', 'pussy', 'asshole', 'bastard', 'dildo', 'jizz', 'twat', 'wank', 'molest', 'paedo', 'chink', 'beaner', 'kkk', 'cocksuck', 'motherf', 'blowjob', 'handjob', 'clit', 'titties', 'genital', 'scrotum', 'testicle', 'orgasm', 'masturb', 'skank', 'heil'];
const WHOLE = new Set(['ass', 'arse', 'dick', 'cock', 'cum', 'sex', 'anal', 'anus', 'spic', 'coon', 'gook', 'dyke', 'fag', 'fags', 'negro', 'hoe', 'hoes', 'thot', 'tit', 'tits', 'boob', 'boobs', 'piss', 'rape', 'raped', 'rapist', 'pedo', 'fuk', 'horny', 'boner', 'semen', 'nude', 'nudes', 'milf', 'nsfw', 'xxx']);
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'i' };
const squash = (s: string) => s.replace(/(.)\1+/g, '$1');

export function nameAllowed(name: string): boolean {
  const spaced = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]+/g, ' ')
    .trim();
  const letters = spaced.replace(/ /g, '');
  const squashed = squash(letters);
  if (ANYWHERE.some((t) => letters.includes(t) || squashed.includes(t))) return false;
  return !spaced.split(' ').some((tok) => WHOLE.has(tok) || WHOLE.has(squash(tok)));
}
