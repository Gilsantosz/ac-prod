import { describe, expect, it } from 'vitest';

import {
  renderReportFragmentHtml,
  wrapEmailTemplate,
} from '../../../supabase/functions/send-scheduled-reports/reportRenderer.ts';

const payload = '<img src=x onerror="alert(1)">&\'"';
const encoded = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&quot;';
const occurrences = (html) => html.split(encoded).length - 1;

describe('renderReportFragmentHtml HTML encoding', () => {
  it('escapes persisted lot, order and status fields', () => {
    const html = renderReportFragmentHtml('lots_delayed', [{
      lot_code: payload,
      status: payload,
      production_orders: { order_code: payload },
    }]);

    expect(html).not.toContain(payload);
    expect(occurrences(html)).toBe(3);
  });

  it('escapes persisted package and shipment fields', () => {
    const html = renderReportFragmentHtml('shipping_pending', [{
      package_code: payload,
      status: payload,
      shipments: { shipment_code: payload },
      volume_number: 7,
    }]);

    expect(html).not.toContain(payload);
    expect(occurrences(html)).toBe(3);
  });

  it('escapes occurrence content in the executive summary', () => {
    const html = renderReportFragmentHtml('executive_summary', {
      delayedCount: 1,
      activeOccurrences: [{
        cell: payload,
        reason: payload,
        notes: payload,
        downtime: 12,
      }],
    });

    expect(html).not.toContain(payload);
    expect(occurrences(html)).toBe(3);
  });

  it('escapes unknown report types and schedule names', () => {
    const fragment = renderReportFragmentHtml(payload, {});
    const wrapped = wrapEmailTemplate({ name: payload, report_date: payload }, fragment);

    expect(fragment).not.toContain(`<b>${payload}</b>`);
    expect(fragment).toContain(`<b>${encoded}</b>`);
    expect(wrapped).not.toContain(payload);
    expect(occurrences(wrapped)).toBe(3);
  });
});
