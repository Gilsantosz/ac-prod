import { getProductionMetricRule, getUnitLabel } from '@/lib/productionUnitRules';
import { isValidProductionEntry } from '@/lib/productionMetrics';

export function filterProductionUnit(entries = [], unit) {
  return unit ? entries.filter((entry) => getProductionMetricRule(entry).unit === unit) : entries;
}

// Keep an explicitly selected unit visible even when the new period has no records.
export function productionUnitOptions(entries = [], selectedUnit = '') {
  const units = new Map();
  entries.filter(isValidProductionEntry).forEach((entry) => {
    const rule = getProductionMetricRule(entry);
    units.set(rule.unit, { key: rule.unit, unitLabel: rule.unitLabel });
  });
  if (selectedUnit && !units.has(selectedUnit)) units.set(selectedUnit, { key: selectedUnit, unitLabel: getUnitLabel(selectedUnit) });
  return [...units.values()];
}
