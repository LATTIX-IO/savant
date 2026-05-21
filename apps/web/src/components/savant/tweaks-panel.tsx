"use client";

import { useState, type ReactNode } from "react";
import { ACCENT_PALETTES, useTweaks, type AccentKey, type DensityKey } from "@/components/savant/tweaks-context";

const ACCENT_KEYS = Object.keys(ACCENT_PALETTES) as AccentKey[];
const DENSITY_OPTIONS: DensityKey[] = ["compact", "regular", "roomy"];

export function TweaksPanel() {
  const { values, set } = useTweaks();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="twk-toggle-btn" onClick={() => setOpen(true)}>
        Tweaks
      </button>
    );
  }

  return (
    <div className="twk-panel" role="dialog" aria-label="Tweaks">
      <div className="twk-hd">
        <b>Tweaks</b>
        <button type="button" className="twk-x" aria-label="Close tweaks" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      <div className="twk-body">
        <div className="twk-sect">Accent</div>
        <Row label="Accent color">
          <div className="twk-chips" role="radiogroup" aria-label="Accent">
            {ACCENT_KEYS.map((key) => {
              const palette = ACCENT_PALETTES[key];
              const on = values.accent === key;
              return (
                <button
                  key={key}
                  type="button"
                  className="twk-chip"
                  data-on={on ? "1" : "0"}
                  role="radio"
                  aria-checked={on}
                  aria-label={key}
                  title={key}
                  style={{ background: palette.accent }}
                  onClick={() => set("accent", key)}
                />
              );
            })}
          </div>
        </Row>

        <div className="twk-sect">Layout</div>
        <Row label="Density">
          <Segmented
            value={values.density}
            options={DENSITY_OPTIONS}
            onChange={(v) => set("density", v)}
          />
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="twk-row">
      <div className="twk-lbl">
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  const idx = Math.max(0, options.indexOf(value));
  const n = options.length;
  return (
    <div className="twk-seg" role="radiogroup">
      <div
        className="twk-seg-thumb"
        style={{
          left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
          width: `calc((100% - 4px) / ${n})`,
        }}
      />
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

