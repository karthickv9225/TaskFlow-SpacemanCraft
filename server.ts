import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {createServer as createViteServer} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFirebaseConfig() {
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.warn('[TaskFlow] Could not read firebase-applet-config.json:', err);
  }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const firebaseConfig = loadFirebaseConfig();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
    }),
  );
  app.use(cors());
  app.use(express.json({limit: '1mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      provider: 'firebase',
      firebaseConfigured: Boolean(firebaseConfig && firebaseConfig.projectId),
      projectId: firebaseConfig ? firebaseConfig.projectId : null,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'mpa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TaskFlow] Firebase-backed server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[TaskFlow] Failed to start server:', err);
  process.exit(1);
});
