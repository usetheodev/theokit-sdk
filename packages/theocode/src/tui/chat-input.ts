/**
 * Chat input buffer with history navigation.
 *
 * Pure state machine — no I/O. The rendering layer feeds keystrokes in;
 * this class maintains the editable buffer and command history.
 */

export class ChatInputState {
  private buffer = "";
  private history: string[] = [];
  private historyIndex = -1;
  private savedBuffer = "";

  /** Append a character (or string) to the buffer. */
  type(char: string): void {
    this.buffer += char;
    this.historyIndex = -1;
  }

  /** Remove the last character from the buffer. */
  backspace(): void {
    this.buffer = this.buffer.slice(0, -1);
  }

  /**
   * Submit the current buffer.
   *
   * @returns The trimmed buffer content, or `null` if the buffer was
   *          empty / whitespace-only (nothing to submit).
   */
  submit(): string | null {
    const trimmed = this.buffer.trim();
    if (trimmed.length === 0) return null;

    this.history.push(trimmed);
    this.buffer = "";
    this.historyIndex = -1;
    return trimmed;
  }

  /** Current buffer content (may be empty). */
  getBuffer(): string {
    return this.buffer;
  }

  /** Navigate to the previous history entry. */
  historyUp(): void {
    if (this.history.length === 0) return;

    if (this.historyIndex === -1) {
      this.savedBuffer = this.buffer;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    }

    this.buffer = this.history[this.historyIndex]!;
  }

  /** Navigate to the next history entry (or back to the live buffer). */
  historyDown(): void {
    if (this.historyIndex === -1) return;

    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.buffer = this.history[this.historyIndex]!;
    } else {
      this.historyIndex = -1;
      this.buffer = this.savedBuffer;
    }
  }
}
