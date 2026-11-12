import { KnowledgeDoc } from '../types/ai';
import { offlineStorage } from './storage';

const DOCS_STORAGE_KEY = 'uploaded_docs_v1';
const CHUNK_TARGET_CHARS = 560;
const MAX_DOC_CHARS = 250_000; // Keep individual docs concise in IndexedDB

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'have',
  'make',
  'write',
  'code',
  'program',
  'please',
  'can',
  'you',
  'add',
  'put',
  'use',
  'using',
  'create',
  'build',
  'app',
  'how',
  'what',
  'when',
  'where',
  'will',
  'should',
]);

export function splitDocumentIntoChunks(title: string, rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, '\n').slice(0, MAX_DOC_CHARS).trim();
  if (!normalized) return [];

  // Split on markdown headings or double newlines while keeping code fences intact where possible
  const blocks = normalized
    .split(/\n(?=#{1,4}\s)|\n{2,}/g)
    .map(b => b.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) {
      chunks.push(`[${title}]\n${trimmed}`);
    }
    buffer = '';
  };

  for (const block of blocks) {
    if (block.length > CHUNK_TARGET_CHARS * 1.4) {
      if (buffer) flush();
      const lines = block.split('\n');
      let sub = '';
      for (const line of lines) {
        if ((sub + '\n' + line).length > CHUNK_TARGET_CHARS && sub.trim()) {
          chunks.push(`[${title}]\n${sub.trim()}`);
          sub = line;
        } else {
          sub = sub ? `${sub}\n${line}` : line;
        }
      }
      if (sub.trim()) {
        chunks.push(`[${title}]\n${sub.trim()}`);
      }
      continue;
    }

    if ((buffer + '\n\n' + block).length > CHUNK_TARGET_CHARS && buffer.trim()) {
      flush();
      buffer = block;
    } else {
      buffer = buffer ? `${buffer}\n\n${block}` : block;
    }
  }

  if (buffer.trim()) {
    flush();
  }

  return chunks;
}

function tokenizeQuery(text: string): string[] {
  const matches: string[] = text.toLowerCase().match(/[a-z0-9_$.-]+/g) ?? [];
  return Array.from(
    new Set(matches.filter(tok => tok.length >= 2 && !STOP_WORDS.has(tok)))
  );
}

export async function getStoredKnowledgeDocs(): Promise<KnowledgeDoc[]> {
  return offlineStorage.getSetting<KnowledgeDoc[]>(DOCS_STORAGE_KEY, []);
}

export async function saveStoredKnowledgeDocs(docs: KnowledgeDoc[]): Promise<void> {
  await offlineStorage.setSetting(DOCS_STORAGE_KEY, docs);
}

export function createKnowledgeDoc(title: string, content: string): KnowledgeDoc {
  const cleanTitle = title.trim() || 'Untitled Doc';
  const trimmedContent = content.replace(/\r\n/g, '\n').slice(0, MAX_DOC_CHARS).trim();
  const chunks = splitDocumentIntoChunks(cleanTitle, trimmedContent);
  return {
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    content: trimmedContent,
    chunks,
    sizeBytes: new Blob([trimmedContent]).size,
    enabled: true,
    createdAt: Date.now(),
  };
}

/**
 * Offline keyword + identifier retrieval (local RAG).
 * Picks only the highest-scoring chunks within a tight character budget so local 1.5B/3B models
 * get accurate syntax/API examples without overflowing their WebGPU KV-cache context window.
 */
export function retrieveRelevantDocContext(
  query: string,
  docs: KnowledgeDoc[],
  maxChars = 1100
): string {
  const enabledDocs = docs.filter(d => d.enabled && d.chunks.length > 0);
  if (enabledDocs.length === 0) return '';

  const queryTokens = tokenizeQuery(query);
  const allChunks: { chunk: string; score: number }[] = [];

  for (const doc of enabledDocs) {
    const titleLower = doc.title.toLowerCase();
    for (let idx = 0; idx < doc.chunks.length; idx++) {
      const chunk = doc.chunks[idx];
      const lower = chunk.toLowerCase();
      let score = idx === 0 ? 0.4 : 0.1; // Slight fallback preference for overview chunks if query is generic

      for (const tok of queryTokens) {
        if (titleLower.includes(tok)) {
          score += 3.0;
        }
        if (lower.includes(tok)) {
          // Exact identifier / API match gets higher weight
          score += tok.length >= 5 ? 2.5 : 1.5;
        }
      }

      allChunks.push({ chunk, score });
    }
  }

  allChunks.sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  let usedChars = 0;

  for (const item of allChunks) {
    if (selected.length >= 3) break;
    // If the user uploaded docs, include strong matches (or the top overview chunk if score > 0)
    if (item.score <= 0) continue;
    if (usedChars + item.chunk.length > maxChars && selected.length > 0) {
      continue;
    }
    const clipped =
      item.chunk.length > maxChars - usedChars
        ? item.chunk.slice(0, Math.max(200, maxChars - usedChars))
        : item.chunk;
    selected.push(clipped);
    usedChars += clipped.length + 2;
    if (usedChars >= maxChars) break;
  }

  return selected.join('\n\n');
}
