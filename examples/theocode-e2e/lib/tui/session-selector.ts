/**
 * Session list navigation logic for TheoCode TUI.
 *
 * Pure functions — no rendering. The rendering layer reads the formatted
 * output and paints it.
 */

export interface SessionListItem {
  id: string;
  title: string;
  updatedAt: number;
  isActive: boolean;
}

/**
 * Format session items as display strings.
 *
 * Active session is prefixed with `>`, others with a space.
 */
export function formatSessionList(sessions: SessionListItem[]): string[] {
  return sessions.map((s) => {
    const marker = s.isActive ? ">" : " ";
    const date = new Date(s.updatedAt).toISOString().slice(0, 10);
    return `${marker} ${s.title}  (${date})`;
  });
}

/**
 * Return the ID of the session after the current one (wraps around).
 *
 * @returns The next session ID, or `null` if there are fewer than 2 sessions.
 */
export function selectNextSession(sessions: SessionListItem[], currentId: string): string | null {
  if (sessions.length < 2) return null;
  const idx = sessions.findIndex((s) => s.id === currentId);
  if (idx === -1) return sessions[0]?.id ?? null;
  const nextIdx = (idx + 1) % sessions.length;
  return sessions[nextIdx]!.id;
}

/**
 * Return the ID of the session before the current one (wraps around).
 *
 * @returns The previous session ID, or `null` if there are fewer than 2 sessions.
 */
export function selectPrevSession(sessions: SessionListItem[], currentId: string): string | null {
  if (sessions.length < 2) return null;
  const idx = sessions.findIndex((s) => s.id === currentId);
  if (idx === -1) return sessions[sessions.length - 1]?.id ?? null;
  const prevIdx = (idx - 1 + sessions.length) % sessions.length;
  return sessions[prevIdx]!.id;
}
