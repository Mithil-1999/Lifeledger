import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DEFAULT_OPTIONS, MAX_LENGTH, MIN_LENGTH, entropyBits, generatePassword, strengthLabel, type GeneratorOptions } from "./generator";

const TOGGLES: { key: keyof Pick<GeneratorOptions, "uppercase" | "lowercase" | "numbers" | "symbols" | "avoidAmbiguous">; label: string }[] = [
  { key: "uppercase", label: "Uppercase (A–Z)" },
  { key: "lowercase", label: "Lowercase (a–z)" },
  { key: "numbers", label: "Numbers (0–9)" },
  { key: "symbols", label: "Symbols (!@#…)" },
  { key: "avoidAmbiguous", label: "Avoid look-alikes (O/0, l/1)" },
];

/** Generates passwords in the browser with crypto.getRandomValues; nothing is sent anywhere. */
export function PasswordGenerator({ onUse }: { onUse: (password: string) => void }) {
  const [options, setOptions] = React.useState<GeneratorOptions>(DEFAULT_OPTIONS);
  const [value, setValue] = React.useState(() => generatePassword(DEFAULT_OPTIONS));
  const noneSelected = !options.uppercase && !options.lowercase && !options.numbers && !options.symbols;

  const update = (next: Partial<GeneratorOptions>) => {
    const merged = { ...options, ...next };
    setOptions(merged);
    if (merged.uppercase || merged.lowercase || merged.numbers || merged.symbols) setValue(generatePassword(merged));
  };
  const bits = entropyBits(options);
  const strength = strengthLabel(bits);

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-background px-2 py-1.5 font-mono text-sm" aria-label="Generated password">
          {noneSelected ? "—" : value}
        </code>
        <Button type="button" variant="outline" size="icon" onClick={() => setValue(generatePassword(options))} disabled={noneSelected} aria-label="Generate another password">
          <RefreshCw />
        </Button>
      </div>
      <div className="grid gap-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="generator-length" className="text-xs">
            Length: {options.length}
          </Label>
          <Badge variant={strength.tone}>
            {strength.label} · ~{bits} bits
          </Badge>
        </div>
        <input
          id="generator-length"
          type="range"
          min={MIN_LENGTH}
          max={64}
          value={options.length}
          onChange={(e) => update({ length: Number(e.target.value) })}
          className="w-full accent-primary"
          aria-valuetext={`${options.length} characters`}
        />
        <span className="sr-only">Maximum length is {MAX_LENGTH}.</span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {TOGGLES.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={Boolean(options[key])} onChange={(e) => update({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      {noneSelected && (
        <p className="text-xs font-medium text-destructive" role="alert">
          Choose at least one character type.
        </p>
      )}
      <div>
        <Button type="button" size="sm" onClick={() => onUse(value)} disabled={noneSelected}>
          Use this password
        </Button>
      </div>
    </div>
  );
}
