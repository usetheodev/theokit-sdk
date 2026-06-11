/**
 * TUI barrel — re-exports all TUI modules.
 */

export { type AppMode, AppState } from "./app.js";
export { ChatInputState } from "./chat-input.js";
export { type CliOptions, main, parseCliArgs } from "./cli.js";
export {
  DEFAULT_KEYMAP,
  formatKeymapHelp,
  type KeyAction,
  type KeyBinding,
  resolveKeyAction,
} from "./keymap.js";
export {
  type DisplayMessage,
  type FormattedMessage,
  type FormattedToolResult,
  formatMessageForDisplay,
  formatToolResult,
} from "./message-display.js";

export {
  formatModelList,
  type ModelListItem,
  resolveModelDisplay,
} from "./model-selector.js";
export {
  formatSessionList,
  type SessionListItem,
  selectNextSession,
  selectPrevSession,
} from "./session-selector.js";
export { formatStatusBar, type StatusBarData } from "./status-bar.js";
export { darkTheme, getTheme, lightTheme, type Theme } from "./theme.js";
