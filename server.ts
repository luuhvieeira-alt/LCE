import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createWorldServer } from './src/server/worldServer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

async function startServer() {
  const firebaseConfig = loadFirebaseConfig();
  const { app, httpServer } = createWorldServer({
    firebaseProjectId: firebaseConfig.projectId,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
    bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[LCE] Servidor do universo compartilhado ativo em http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[LCE] Falha crítica ao iniciar o servidor:', err);
  process.exit(1);
});
