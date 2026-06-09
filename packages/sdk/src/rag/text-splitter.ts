/**
 * Text splitting strategies for RAG pipelines (T11.1, ADR D448).
 *
 * Three strategies: character, sentence, recursive (paragraph→sentence→char).
 * All return Chunk[] with text + index. Empty input → empty array (EC-5).
 *
 * @public
 */

import type { Chunk, SplitOptions } from "./types.js";

function makeChunks(texts: string[]): Chunk[] {
  return texts.filter((t) => t.length > 0).map((text, index) => ({ text, index }));
}

export function splitByCharacter(text: string, opts: SplitOptions): Chunk[] {
  if (text.length === 0) return [];
  const { chunkSize, overlap = 0 } = opts;
  const step = Math.max(1, chunkSize - overlap);
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += step) {
    parts.push(text.slice(i, i + chunkSize));
  }
  return makeChunks(parts);
}

const SENTENCE_RE = /(?<=[.!?])\s+/;

export function splitBySentence(text: string, opts: SplitOptions): Chunk[] {
  if (text.length === 0) return [];
  const { chunkSize } = opts;
  const sentences = text.split(SENTENCE_RE);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > chunkSize && current.length > 0) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current = current.length > 0 ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.length > 0) parts.push(current.trim());
  return makeChunks(parts);
}

const PARAGRAPH_RE = /\n\n+/;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive splitter inherently cascades through 3 levels (paragraph→sentence→char)
export function splitRecursive(text: string, opts: SplitOptions): Chunk[] {
  if (text.length === 0) return [];
  const { chunkSize, overlap = 0 } = opts;

  // Level 1: split by paragraph
  const paragraphs = text.split(PARAGRAPH_RE).filter((p) => p.length > 0);
  const result: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= chunkSize) {
      result.push(para);
    } else {
      // Level 2: split by sentence
      const sentenceChunks = splitBySentence(para, { chunkSize, overlap });
      for (const sc of sentenceChunks) {
        if (sc.text.length <= chunkSize) {
          result.push(sc.text);
        } else {
          // Level 3: split by character
          const charChunks = splitByCharacter(sc.text, { chunkSize, overlap });
          for (const cc of charChunks) {
            result.push(cc.text);
          }
        }
      }
    }
  }

  return makeChunks(result);
}
