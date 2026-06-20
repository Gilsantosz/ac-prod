import {
  productionItemsFixture,
  productionLotFixture,
  productionRouteFixture,
  traceabilityTagsFixture,
} from '@/test/fixtures/traceabilityFixtures';
import { normalizeTagValue } from '@/lib/traceabilityService';

function clone(value) {
  return structuredClone(value);
}

export function createTraceabilityTestRepository(options = {}) {
  const lot = clone(options.lot || productionLotFixture);
  const items = clone(options.items || productionItemsFixture);
  const route = clone(options.route || productionRouteFixture);
  const tags = clone(options.tags || traceabilityTagsFixture);
  const readings = clone(options.readings || []);
  const occurrences = [];

  return {
    lot,
    items,
    route,
    tags,
    readings,
    occurrences,
    async findByTag(rawValue) {
      const tagValue = normalizeTagValue(rawValue).tagValue;
      const tag = tags.find((candidate) => normalizeTagValue(candidate.tag_value).tagValue === tagValue);
      const item = tag ? items.find((candidate) => candidate.id === tag.item_id) : null;
      return item ? { lot, item, route, tag } : null;
    },
    async getReadings(itemId) {
      return readings.filter((reading) => reading.item_id === itemId);
    },
    async saveReading(reading) {
      readings.push(clone(reading));
      return reading;
    },
    async updateItem(nextItem) {
      const index = items.findIndex((item) => item.id === nextItem.id);
      if (index >= 0) items[index] = clone(nextItem);
      return nextItem;
    },
    async saveOccurrence(occurrence) {
      occurrences.push(clone(occurrence));
      return occurrence;
    },
  };
}
