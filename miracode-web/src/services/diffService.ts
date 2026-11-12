import { DiffLine } from '../types/project';

export function computeLineDiff(oldCode: string, newCode: string): DiffLine[] {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');

  const diff: DiffLine[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      // All remaining lines in new are added
      diff.push({
        type: 'added',
        content: newLines[newIdx],
        newLineNumber: newIdx + 1,
      });
      newIdx++;
    } else if (newIdx >= newLines.length) {
      // All remaining lines in old are removed
      diff.push({
        type: 'removed',
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1,
      });
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      // Lines match
      diff.push({
        type: 'unchanged',
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1,
        newLineNumber: newIdx + 1,
      });
      oldIdx++;
      newIdx++;
    } else {
      // Check for lookahead match
      const nextMatchInNew = newLines.slice(newIdx, newIdx + 5).indexOf(oldLines[oldIdx]);
      const nextMatchInOld = oldLines.slice(oldIdx, oldIdx + 5).indexOf(newLines[newIdx]);

      if (nextMatchInNew !== -1 && (nextMatchInOld === -1 || nextMatchInNew <= nextMatchInOld)) {
        // Line added in new
        diff.push({
          type: 'added',
          content: newLines[newIdx],
          newLineNumber: newIdx + 1,
        });
        newIdx++;
      } else {
        // Line removed from old
        diff.push({
          type: 'removed',
          content: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1,
        });
        oldIdx++;
      }
    }
  }

  return diff;
}

export function calculateChangeStats(oldCode: string, newCode: string): { added: number; removed: number } {
  const diff = computeLineDiff(oldCode, newCode);
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.type === 'added') added++;
    if (line.type === 'removed') removed++;
  }
  return { added, removed };
}
