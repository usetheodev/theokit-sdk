/**
 * Keyboard shortcut mapping for TheoCode TUI.
 *
 * Maps key combinations to named actions. The default keymap covers
 * the core navigation and editing shortcuts; consumers may override
 * individual bindings by passing a custom keymap array.
 */

export type KeyAction =
  | "exit"
  | "newSession"
  | "switchSession"
  | "selectModel"
  | "submit"
  | "cancel"
  | "togglePlan"
  | "help";

export interface KeyBinding {
  /** Raw key descriptor (e.g. "ctrl+c", "enter", "escape"). */
  key: string;
  /** Logical action this key triggers. */
  action: KeyAction;
  /** Human-readable description shown in help. */
  description: string;
}

export const DEFAULT_KEYMAP: KeyBinding[] = [
  { key: "ctrl+c", action: "exit", description: "Exit TheoCode" },
  { key: "ctrl+n", action: "newSession", description: "New session" },
  { key: "ctrl+s", action: "switchSession", description: "Switch session" },
  { key: "ctrl+m", action: "selectModel", description: "Select model" },
  { key: "enter", action: "submit", description: "Send message" },
  { key: "escape", action: "cancel", description: "Cancel" },
  { key: "ctrl+p", action: "togglePlan", description: "Toggle plan mode" },
  { key: "ctrl+h", action: "help", description: "Show help" },
];

/**
 * Resolve a raw key string to its mapped action.
 *
 * @returns The matched action, or `null` if the key is unbound.
 */
export function resolveKeyAction(
  key: string,
  keymap: KeyBinding[] = DEFAULT_KEYMAP,
): KeyAction | null {
  const binding = keymap.find((b) => b.key === key);
  return binding?.action ?? null;
}

/**
 * Format the keymap as a human-readable help string.
 *
 * Each line is formatted as `  <key>  <description>`.
 */
export function formatKeymapHelp(keymap: KeyBinding[] = DEFAULT_KEYMAP): string {
  const maxKeyLen = Math.max(...keymap.map((b) => b.key.length));
  return keymap.map((b) => `  ${b.key.padEnd(maxKeyLen)}  ${b.description}`).join("\n");
}
