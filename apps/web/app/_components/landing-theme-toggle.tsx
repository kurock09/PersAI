"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "@/app/app/_components/use-theme";

const OPTIONS: { id: ThemeChoice; icon: typeof Sun; label: string }[] = [
  { id: "system", icon: Monitor, label: "System" },
  { id: "light", icon: Sun, label: "Light" },
  { id: "dark", icon: Moon, label: "Dark" }
];

/**
 * Three-state theme toggle for the public landing header. Keeps the same
 * `system | light | dark` contract as the in-app footer toggle so a user's
 * preference survives navigation between landing → /app and back. Visual
 * design intentionally matches the AccountFooter segmented control to read
 * as part of the same family on first impression.
 */
export function LandingThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center rounded-full border border-border bg-surface-raised/40 p-0.5 backdrop-blur-sm">
      {OPTIONS.map(({ id, icon: Icon, label }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={
              "cursor-pointer rounded-full p-1.5 transition-colors " +
              (active ? "bg-surface-raised text-text" : "text-text-subtle hover:text-text-muted")
            }
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
