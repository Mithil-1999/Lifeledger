/**
 * Password generator built on the browser's cryptographically secure RNG
 * (crypto.getRandomValues). Never Math.random.
 *
 * - Unbiased: random indices use rejection sampling (no modulo bias).
 * - Every selected character class is guaranteed at least once, then the result is
 *   shuffled with a CSPRNG-driven Fisher-Yates shuffle so those characters aren't
 *   in predictable positions.
 * - Generated passwords never leave the browser unless you save them.
 */

export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  /** Leave out look-alikes such as O/0 and l/1/I. */
  avoidAmbiguous?: boolean;
}

export const DEFAULT_OPTIONS: GeneratorOptions = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false };
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;

const SETS = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
} as const;
const AMBIGUOUS = /[O0oIl1|]/g;

/** Uniform random integer in [0, max) from the CSPRNG, without modulo bias. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError("max must be an integer in 1..2^32");
  const limit = Math.floor(2 ** 32 / max) * max; // reject values in the uneven tail
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

function pick(chars: string) {
  return chars[randomInt(chars.length)];
}

export function characterPools(options: GeneratorOptions): string[] {
  return (Object.keys(SETS) as (keyof typeof SETS)[])
    .filter((key) => options[key])
    .map((key) => (options.avoidAmbiguous ? SETS[key].replace(AMBIGUOUS, "") : SETS[key]));
}

export function generatePassword(options: GeneratorOptions): string {
  const pools = characterPools(options);
  if (pools.length === 0) throw new Error("Choose at least one character type.");
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.floor(options.length)));
  const all = pools.join("");
  const chars = pools.map(pick); // one from each selected class
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Approximate entropy in bits for a generated password: length × log2(pool size). */
export function entropyBits(options: GeneratorOptions): number {
  const size = characterPools(options).join("").length;
  return size ? Math.round(options.length * Math.log2(size)) : 0;
}

export function strengthLabel(bits: number): { label: string; tone: "destructive" | "warning" | "success" } {
  if (bits < 50) return { label: "Weak", tone: "destructive" };
  if (bits < 80) return { label: "Fair", tone: "warning" };
  if (bits < 110) return { label: "Strong", tone: "success" };
  return { label: "Very strong", tone: "success" };
}
