import { useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";

// The view each toggle showed last on this page: another source or version
// opens in it too, until the page reloads.
const lastViews = new Map<string, string>();

/** A view choice that the page remembers per toggle `name`. */
export function useRememberedView<View extends string>(
  name: string,
  views: readonly View[],
  initial: View,
) {
  const [view, setView] = useState<View>(
    () => views.find((one) => one === lastViews.get(name)) ?? initial,
  );
  const choose = (next: View) => {
    lastViews.set(name, next);
    setView(next);
  };
  return [view, choose] as const;
}

/**
 * Switches one section between its views, such as a table and its JSON text.
 * `label` names the group ("Lookup entries view"), each button its view.
 */
export default function ViewToggle<View extends string>({
  label,
  value,
  views,
  onChange,
}: {
  label: string;
  value: View;
  views: readonly { view: View; text: string }[];
  onChange: (view: View) => void;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      aria-label={label}
      onChange={(_, chosen: string | null) => {
        const view = views.find((one) => one.view === chosen);
        if (view) onChange(view.view);
      }}
    >
      {views.map(({ view, text }) => (
        <ToggleButton key={view} value={view}>
          {text}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
