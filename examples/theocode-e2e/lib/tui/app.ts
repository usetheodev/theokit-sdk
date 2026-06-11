/**
 * Top-level application state machine for TheoCode TUI.
 *
 * Tracks the current UI mode and selected session / model.
 * Pure state — no rendering, no I/O.
 */

export type AppMode = "chat" | "sessionSelect" | "modelSelect" | "help";

export class AppState {
  mode: AppMode = "chat";
  sessionId: string | null = null;
  modelId = "anthropic/claude-sonnet-4";

  switchMode(mode: AppMode): void {
    this.mode = mode;
  }

  setSession(id: string): void {
    this.sessionId = id;
    this.mode = "chat";
  }

  setModel(id: string): void {
    this.modelId = id;
    this.mode = "chat";
  }
}
