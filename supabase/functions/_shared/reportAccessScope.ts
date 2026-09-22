export type ReportCellScope = {
  unrestricted: boolean;
  cells: string[];
};

const canonicalKey = (value: unknown) => String(value || '').trim().toLocaleLowerCase('pt-BR');

const uniqueText = (values: unknown[]) => {
  const byKey = new Map<string, string>();
  values.forEach((value) => {
    const text = String(value || '').trim();
    const key = canonicalKey(text);
    if (key && !byKey.has(key)) byKey.set(key, text);
  });
  return [...byKey.values()];
};

export function resolveReportCellScope(profile: any, requested: unknown[] = []): ReportCellScope {
  const requestedCells = uniqueText(Array.isArray(requested) ? requested : []);

  if (profile?.role === 'admin') {
    return { unrestricted: requestedCells.length === 0, cells: requestedCells };
  }

  const allowedCells = uniqueText(
    profile?.role === 'manager' && Array.isArray(profile?.managed_cells) && profile.managed_cells.length
      ? profile.managed_cells
      : [profile?.cell],
  );
  if (!allowedCells.length) throw new Error('ACCESS_DENIED');

  if (!requestedCells.length) {
    return { unrestricted: false, cells: allowedCells };
  }

  const allowedByKey = new Map(allowedCells.map((cell) => [canonicalKey(cell), cell]));
  const resolved = requestedCells.map((cell) => allowedByKey.get(canonicalKey(cell)));
  if (resolved.some((cell) => !cell)) throw new Error('ACCESS_DENIED');

  return { unrestricted: false, cells: uniqueText(resolved) };
}
