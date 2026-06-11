/**
 * Color theme definitions for TheoCode TUI.
 *
 * Themes are plain data — no rendering dependency. The actual rendering
 * layer (Ink / blessed / raw ANSI) reads these values when painting.
 */

export interface Theme {
  name: string;
  primary: string;
  secondary: string;
  error: string;
  success: string;
  muted: string;
  border: string;
  userPrefix: string;
  assistantPrefix: string;
  systemPrefix: string;
}

export const darkTheme: Theme = {
  name: "dark",
  primary: "#61afef",
  secondary: "#c678dd",
  error: "#e06c75",
  success: "#98c379",
  muted: "#5c6370",
  border: "#3e4452",
  userPrefix: "cyan",
  assistantPrefix: "green",
  systemPrefix: "yellow",
};

export const lightTheme: Theme = {
  name: "light",
  primary: "#4078f2",
  secondary: "#a626a4",
  error: "#e45649",
  success: "#50a14f",
  muted: "#a0a1a7",
  border: "#d3d3d3",
  userPrefix: "blue",
  assistantPrefix: "green",
  systemPrefix: "magenta",
};

const themes: Record<string, Theme> = {
  dark: darkTheme,
  light: lightTheme,
};

/**
 * Look up a theme by name. Falls back to `darkTheme` for unknown names
 * or when no name is provided.
 */
export function getTheme(name?: string): Theme {
  if (!name) return darkTheme;
  return themes[name] ?? darkTheme;
}
