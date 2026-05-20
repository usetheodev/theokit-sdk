import { z } from "zod";

/**
 * Schema for the useTheoAssistant demo.
 *
 * IMPORTANT: this file is the SINGLE SOURCE OF TRUTH for the FactCard
 * shape used by BOTH:
 *   - `app/assistant/page.tsx` (client) — passed to `useTheoAssistant({ schema })`
 *   - `app/api/assistant/route.ts` (server) — passed to `streamAssistant({ schema })`
 *
 * Defining the schema twice with subtly different shape causes silent
 * partial-parse failures on the client (EC-2 from examples-100-coverage
 * plan; EC-18 from v1.2 plan). Always import THIS export — never inline.
 */
export const FactCard = z.object({
  title: z.string().min(1),
  summary: z.string().min(20),
  year: z.number().int().nullable(),
  sources: z.array(z.string()).min(1).max(3),
});

export type FactCard = z.infer<typeof FactCard>;
