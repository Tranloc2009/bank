import 'dotenv/config';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { BankEngine } from './server/bankEngine.ts';
import { PgBankEngine } from './server/pgBankEngine.ts';
import { BankError } from './server/security.ts';
import type { IBankEngine } from './server/bankTypes.ts';
import type { UserProfile } from './src/lib/banking.ts';

interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  authToken?: string;
}

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const DB_PATH = process.env.PLAYBANK_DB_PATH || path.resolve(process.cwd(), 'playbank.db');

function createBankEngine(): IBankEngine {
  if (DATABASE_URL) {
    return new PgBankEngine(DATABASE_URL);
  }
  return new BankEngine(DB_PATH);
}

const engine: IBankEngine = createBankEngine();

// Real-time Server-Sent Events hub keyed by userId
const sseClients = new Map<string, Set<Response>>();

function pushUserEvent(userId: string, event: string, payload: unknown): void {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;
  const serialized = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(serialized);
    } catch {
      clients.delete(res);
    }
  }
}

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return undefined;
}

async function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractBearerToken(req);
    const user = await engine.authenticate(token);
    req.user = user;
    req.authToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

async function startServer(): Promise<void> {
  if (engine.init) {
    await engine.init();
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health endpoint (exposes only non-sensitive operational info)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'playbank-simulator',
      storage: engine.storageType,
    });
  });

  // Auth routes
  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const { email, password, displayName } = req.body ?? {};
      const result = await engine.register({ email, password, displayName });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      const result = await engine.login({ email, password });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.authToken) {
        await engine.logout(req.authToken);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Dashboard & Profile
  app.get('/api/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const summary = await engine.getDashboardSummary(req.user!.id);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/me/profile', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { displayName, avatarUrl, isAnonymous, soundEnabled } = req.body ?? {};
      // Security: never accept balance or accountNumber mutations from client
      if (
        req.body &&
        ('balance' in req.body || 'accountNumber' in req.body || 'initialBonusGranted' in req.body)
      ) {
        throw new BankError(
          'Không được phép chỉnh sửa số dư hoặc số tài khoản trực tiếp.',
          403,
          'FORBIDDEN_FIELD'
        );
      }
      const user = await engine.updateProfile(req.user!.id, {
        displayName,
        avatarUrl,
        isAnonymous,
        soundEnabled,
      });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  // Account lookup (recipient resolution)
  app.get('/api/accounts/lookup', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const accountNumber = String(req.query.accountNumber ?? '');
      const result = await engine.lookupAccount(req.user!.id, accountNumber);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Atomic Transfer
  app.post('/api/transfers', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { recipientAccount, amount, note, method, idempotencyKey } = req.body ?? {};
      const parsedAmount = typeof amount === 'number' ? amount : Number(amount);
      const result = await engine.executeTransfer({
        senderId: req.user!.id,
        recipientAccount: String(recipientAccount ?? ''),
        amount: parsedAmount,
        note: String(note ?? ''),
        method: method === 'qr' ? 'qr' : 'account',
        idempotencyKey: String(idempotencyKey ?? ''),
      });

      if (!result.deduplicated) {
        // Real-time incoming payment alert to recipient across connected devices
        pushUserEvent(result.recipientId, 'incoming_transfer', {
          transaction: result.transaction,
          newBalance: result.recipientBalance,
        });
      }

      res.status(result.deduplicated ? 200 : 201).json({
        transaction: result.transaction,
        balance: result.senderBalance,
        newAchievements: result.newSenderAchievements,
        deduplicated: result.deduplicated,
      });
    } catch (err) {
      next(err);
    }
  });

  // Transaction History with search and date filtering
  app.get('/api/transactions', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const directionParam = typeof req.query.direction === 'string' ? req.query.direction : 'all';
      const direction =
        directionParam === 'sent' || directionParam === 'received' ? directionParam : 'all';
      const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
      const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;
      const transactions = await engine.getTransactions(req.user!.id, {
        q,
        direction,
        fromDate,
        toDate,
      });
      res.json({ transactions });
    } catch (err) {
      next(err);
    }
  });

  // Leaderboard
  app.get('/api/leaderboard', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const entries = await engine.getLeaderboard(req.user!.id);
      res.json({ entries });
    } catch (err) {
      next(err);
    }
  });

  // Real-time Server-Sent Events stream
  app.get('/api/events', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let clients = sseClients.get(userId);
    if (!clients) {
      clients = new Set();
      sseClients.set(userId, clients);
    }
    clients.add(res);

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      clients?.delete(res);
      if (clients && clients.size === 0) {
        sseClients.delete(userId);
      }
    });
  });

  // API Error handler
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BankError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[PLAYBANK API ERROR]', err);
    res.status(500).json({ error: 'Đã xảy ra lỗi máy chủ. Vui lòng thử lại.', code: 'INTERNAL_ERROR' });
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `PLAYBANK Simulator running on http://0.0.0.0:${PORT} (storage: ${engine.storageType})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start PLAYBANK server:', err);
  process.exit(1);
});
