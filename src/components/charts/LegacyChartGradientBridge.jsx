import { useEffect } from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';
let gradientSequence = 0;

function createStop(offset, color, opacity = 1) {
  const stop = document.createElementNS(SVG_NS, 'stop');
  stop.setAttribute('offset', offset);
  stop.setAttribute('stop-color', color);
  stop.setAttribute('stop-opacity', String(opacity));
  return stop;
}

function ensureDefs(svg) {
  let defs = svg.querySelector('defs[data-system-chart-gradients]');
  if (defs) return defs;
  defs = document.createElementNS(SVG_NS, 'defs');
  defs.setAttribute('data-system-chart-gradients', 'true');
  svg.insertBefore(defs, svg.firstChild);
  return defs;
}

function applyGradient(svg, element, paintAttribute, orientation = 'horizontal') {
  const currentPaint = element.getAttribute(paintAttribute);
  if (!currentPaint || currentPaint === 'none' || currentPaint === 'transparent' || currentPaint.startsWith('url(')) return;

  const existingId = element.getAttribute('data-system-gradient-id');
  if (existingId && svg.querySelector(`#${existingId}`)) {
    element.setAttribute(paintAttribute, `url(#${existingId})`);
    return;
  }

  gradientSequence += 1;
  const id = `system-chart-gradient-${gradientSequence}`;
  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  gradient.setAttribute('id', id);
  gradient.setAttribute('x1', '0%');
  gradient.setAttribute('y1', orientation === 'vertical' ? '100%' : '0%');
  gradient.setAttribute('x2', orientation === 'vertical' ? '0%' : '100%');
  gradient.setAttribute('y2', '0%');
  gradient.append(
    createStop('0%', currentPaint, 0.58),
    createStop('52%', currentPaint, 0.92),
    createStop('100%', currentPaint, 1),
  );
  ensureDefs(svg).appendChild(gradient);
  element.setAttribute('data-system-gradient-id', id);
  element.setAttribute(paintAttribute, `url(#${id})`);
}

function enhanceSvg(svg) {
  svg.querySelectorAll('.recharts-line-curve').forEach((line) => {
    applyGradient(svg, line, 'stroke', 'horizontal');
  });

  svg.querySelectorAll('.recharts-bar-rectangle path, .recharts-bar-rectangle rect').forEach((bar) => {
    const width = Number(bar.getAttribute('width')) || 0;
    const height = Number(bar.getAttribute('height')) || 0;
    applyGradient(svg, bar, 'fill', width > height ? 'horizontal' : 'vertical');
  });
}

export default function LegacyChartGradientBridge() {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;

    let frame = 0;
    const scan = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        document.querySelectorAll('.recharts-wrapper svg').forEach(enhanceSvg);
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scan);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scan);
    };
  }, []);

  return null;
}
