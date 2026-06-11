/**
 * Model list navigation and display logic for TheoCode TUI.
 */

export interface ModelListItem {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
}

/**
 * Format model items as display strings.
 *
 * Active model is prefixed with `>`, others with a space.
 */
export function formatModelList(models: ModelListItem[]): string[] {
  return models.map((m) => {
    const marker = m.isActive ? ">" : " ";
    return `${marker} ${m.provider}/${m.name}`;
  });
}

/**
 * Parse a model ID string into provider and short display name.
 *
 * Handles `provider/model-name` format. Falls back to "unknown" provider
 * when the ID has no slash.
 */
export function resolveModelDisplay(modelId: string): {
  provider: string;
  shortName: string;
} {
  const slashIdx = modelId.indexOf("/");
  if (slashIdx === -1) {
    return { provider: "unknown", shortName: modelId };
  }
  return {
    provider: modelId.slice(0, slashIdx),
    shortName: modelId.slice(slashIdx + 1),
  };
}
