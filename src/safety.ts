// src/safety.ts
// Simple similarity heuristics (stubs). Replace with real embeddings in production.

export function paragraphSimilarity(p1: string, p2: string) {
  if (!p1 || !p2) return 0;
  const a = p1.split(" ").slice(0, 10).join(" ").toLowerCase();
  const b = p2.split(" ").slice(0, 10).join(" ").toLowerCase();
  return a === b ? 1 : 0;
}

export function passesSimilarityThreshold(sim: number, threshold = 0.85) {
  return sim < threshold;
}
