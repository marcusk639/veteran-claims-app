import { z } from "zod";

// Mirrors rag-system's SanitizedRetrievalResult (packages/core/src/metadata-policy.ts:84-88),
// which is the wire shape returned via MCP structuredContent.results. rag-system has no
// Zod schema or published package for this type (it's workspace-private) -- this schema is
// hand-maintained against that source and WILL drift silently if rag-system changes the shape
// without a corresponding update here. Re-check against the source above if citations start
// silently disappearing (this schema's safeParse-based callers drop, not throw, on mismatch).
export const sanitizedRetrievalResultSchema = z.object({
  text: z.string(),
  score: z.number(),
  denseScore: z.number(),
  sparseScore: z.number(),
  document: z.object({
    id: z.string(),
    title: z.string(),
    sourceId: z.string(),
    sourceKind: z.enum([
      "sharepoint",
      "gdrive",
      "gmail",
      "outlook",
      "custom",
      "git-markdown",
      "ecfr-part4",
    ]),
    url: z.string().optional(),
    hasOriginal: z.boolean().optional(),
    metadata: z
      .object({
        title: z.string().optional(),
        url: z.string().optional(),
        mimeType: z.string().optional(),
        sizeBytes: z.number().optional(),
        createdAt: z.string().optional(),
        modifiedAt: z.string().optional(),
        path: z.string().optional(),
        docClass: z.string().optional(),
      })
      .partial(),
  }),
  chunk: z.object({
    id: z.string(),
    ordinal: z.number(),
    headingPath: z.array(z.string()),
    page: z.number().optional(),
  }),
});

export type SanitizedRetrievalResult = z.infer<
  typeof sanitizedRetrievalResultSchema
>;
