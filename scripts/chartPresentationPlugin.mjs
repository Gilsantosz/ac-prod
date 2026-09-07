import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalize = (value) => value.replace(/\\/g, '/').split('?')[0];
/** Route application imports only; retain original Recharts primitives and vendor entry. */
export default function chartPresentationPlugin() {
  const src = normalize(path.join(projectRoot, 'src')) + '/';
  const adapter = path.join(projectRoot, 'src/components/charts/recharts.jsx');
  return {
    name: 'vite-plugin-acprod-chart-presentation',
    enforce: 'pre',
    resolveId(source, importer) {
      if (process.env.VITE_CHARTS_GLASS === 'false' || source !== 'recharts' || !importer) return null;
      const file = normalize(importer);
      if (!file.startsWith(src) || file.startsWith(src + 'components/charts/')) return null;
      return adapter;
    },
  };
}
