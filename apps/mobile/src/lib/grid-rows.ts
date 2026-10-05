/**
 * Reorders a grid's cells so each row reads right to left, for a grid that can only place cells by
 * index from the left (a virtualized multi-column list). The order is reversed within every row,
 * and a short last row is padded at its START with `spacer()` cells, which keeps what it has against
 * the right edge — where a right-to-left reader's eye lands on it.
 */
export function mirrorGridRows<T>(cells: readonly T[], cols: number, spacer: () => T): T[] {
  const mirrored: T[] = [];
  for (let start = 0; start < cells.length; start += cols) {
    const end = Math.min(start + cols, cells.length);
    for (let pad = end - start; pad < cols; pad++) mirrored.push(spacer());
    for (let i = end - 1; i >= start; i--) mirrored.push(cells[i]);
  }
  return mirrored;
}
