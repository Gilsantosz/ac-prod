import { build } from 'esbuild';

async function buildElectron() {
  try {
    await build({
      entryPoints: ['electron/main.ts'],
      outfile: 'dist-electron/main.cjs',
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      external: ['electron']
    });

    await build({
      entryPoints: ['electron/preload.ts'],
      outfile: 'dist-electron/preload.cjs',
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      external: ['electron']
    });

    console.log('⚡ Electron scripts bundled to dist-electron/main.cjs & preload.cjs');
  } catch (err) {
    console.error('Falha ao compilar Electron:', err);
    process.exit(1);
  }
}

buildElectron();
