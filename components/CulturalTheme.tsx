"use client";

import { useEffect, useState, type ReactNode } from "react";
import { automaticTheme, THEMES, type ThemeId } from "@/lib/cultural-theme";

const KEY = "khan-baba-cultural-theme";
type Choice = "auto" | ThemeId;
export function CulturalTheme({ children, name }: { children: ReactNode; name: string }) {
  const [choice, setChoice] = useState<Choice>("auto");
  const [date, setDate] = useState<Date | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === "auto" || stored === "royal" || stored === "lahore" || stored === "heritage") setChoice(stored);
    setDate(new Date());
    const timer = window.setInterval(() => setDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const automatic = date ? automaticTheme(date) : { theme: "royal" as ThemeId, occasion: "Royal lounge" };
  const theme = choice === "auto" ? automatic.theme : choice;
  return <div className="cultural-site" data-cultural-theme={theme} style={{ "--cultural-image": `url('${THEMES[theme].image}')` } as React.CSSProperties}>
    <div className="cultural-banner">
      <span><strong>{name}</strong> <span aria-hidden="true">✦</span> {choice === "auto" ? automatic.occasion : THEMES[theme].label}</span>
      <label>Theme <select value={choice} onChange={(event) => { const value = event.target.value as Choice; setChoice(value); localStorage.setItem(KEY, value); }}>
        <option value="auto">Automatic</option>
        {Object.entries(THEMES).map(([id, item]) => <option value={id} key={id}>{item.label}</option>)}
      </select></label>
    </div>
    {children}
  </div>;
}
