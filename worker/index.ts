import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { D1BankEngine, WorkerBankError } from './d1BankEngine.ts';

export interface Env {
  DB?: D1Database;
  ASSETS?: Fetcher;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function extractBearerToken(request: Request, url: URL): string | undefined {
  const header = request.headers.get('Authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  const queryToken = url.searchParams.get('token');
  if (queryToken && queryToken.trim()) {
    return queryToken.trim();
  }
  return undefined;
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > 1_048_576) {
    throw new WorkerBankError('Dữ liệu gửi lên vượt quá giới hạn 1MB.', 413, 'PAYLOAD_TOO_LARGE');
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {};
    }
    return body as Record<string, unknown>;
  } catch {
    throw new WorkerBankError('Định dạng JSON không hợp lệ.', 400, 'INVALID_JSON');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Serve static React + Vite SPA assets for non-API routes
    if (!pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request as unknown as Parameters<Fetcher['fetch']>[0]) as unknown as Response;
      }
      return new Response('PLAYBANK Static Assets binding is not configured.', { status: 404 });
    }

    // Health check works even before D1 is bound, transparently reporting DB status
    if (pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({
        ok: Boolean(env.DB),
        service: 'playbank-simulator',
        runtime: 'cloudflare-workers',
        storage: env.DB ? 'd1' : 'unconfigured',
        realtime: 'polling',
      });
    }

    // Never fake success if Cloudflare D1 binding is missing
    if (!env.DB) {
      return jsonResponse(
        {
          error:
            'Cơ sở dữ liệu Cloudflare D1 (binding "DB") chưa được gắn cho Worker này. Vui lòng tạo D1 và cập nhật database_id trong wrangler.jsonc.',
          code: 'D1_NOT_CONFIGURED',
        },
        503
      );
    }

    const engine = new D1BankEngine(env.DB);
    const method = request.method.toUpperCase();

    try {
      // --- Auth endpoints ---
      if (pathname === '/api/auth/register' && method === 'POST') {
        const body = await parseJsonBody(request);
        const result = await engine.register({
          email: String(body.email ?? ''),
          password: String(body.password ?? ''),
          displayName: String(body.displayName ?? ''),
        });
        return jsonResponse(result, 201);
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await parseJsonBody(request);
        const result = await engine.login({
          email: String(body.email ?? ''),
          password: String(body.password ?? ''),
        });
        return jsonResponse(result, 200);
      }

      // --- Authenticated endpoints ---
      const token = extractBearerToken(request, url);
      const user = await engine.authenticate(token);

      if (pathname === '/api/auth/logout' && method === 'POST') {
        if (token) {
          await engine.logout(token);
        }
        return jsonResponse({ ok: true });
      }

      if (pathname === '/api/me' && method === 'GET') {
        const summary = await engine.getDashboardSummary(user.id);
        return jsonResponse(summary);
      }

      if (pathname === '/api/me/profile' && method === 'PATCH') {
        const body = await parseJsonBody(request);
        if ('balance' in body || 'accountNumber' in body || 'initialBonusGranted' in body) {
          throw new WorkerBankError(
            'Không được phép chỉnh sửa số dư hoặc số tài khoản trực tiếp.',
            403,
            'FORBIDDEN_FIELD'
          );
        }
        const updated = await engine.updateProfile(user.id, {
          displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
          avatarUrl: typeof body.avatarUrl === 'string' ? body.avatarUrl : undefined,
          isAnonymous: typeof body.isAnonymous === 'boolean' ? body.isAnonymous : undefined,
          soundEnabled: typeof body.soundEnabled === 'boolean' ? body.soundEnabled : undefined,
        });
        return jsonResponse({ user: updated });
      }

      if (pathname === '/api/accounts/lookup' && method === 'GET') {
        const accountNumber = url.searchParams.get('accountNumber') ?? '';
        const result = await engine.lookupAccount(user.id, accountNumber);
        return jsonResponse(result);
      }

      if (pathname === '/api/transfers' && method === 'POST') {
        const body = await parseJsonBody(request);
        const parsedAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
        const result = await engine.executeTransfer({
          senderId: user.id,
          recipientAccount: String(body.recipientAccount ?? ''),
          amount: parsedAmount,
          note: String(body.note ?? ''),
          method: body.method === 'qr' ? 'qr' : 'account',
          idempotencyKey: String(body.idempotencyKey ?? ''),
        });

        return jsonResponse(
          {
            transaction: result.transaction,
            balance: result.senderBalance,
            newAchievements: result.newSenderAchievements,
            deduplicated: result.deduplicated,
          },
          result.deduplicated ? 200 : 201
        );
      }

      if (pathname === '/api/transactions' && method === 'GET') {
        const q = url.searchParams.get('q') ?? undefined;
        const dirParam = url.searchParams.get('direction') ?? 'all';
        const direction = dirParam === 'sent' || dirParam === 'received' ? dirParam : 'all';
        const fromDate = url.searchParams.get('fromDate') ?? undefined;
        const toDate = url.searchParams.get('toDate') ?? undefined;
        const transactions = await engine.getTransactions(user.id, {
          q,
          direction,
          fromDate,
          toDate,
        });
        return jsonResponse({ transactions });
      }

      if (pathname === '/api/leaderboard' && method === 'GET') {
        const entries = await engine.getLeaderboard(user.id);
        return jsonResponse({ entries });
      }

      // On stateless Cloudflare Workers Free, inform the client to switch cleanly
      // to active-tab polling without triggering EventSource reconnect errors.
      if (pathname === '/api/events' && method === 'GET') {
        return new Response(
          `event: connected\ndata: ${JSON.stringify({ ok: true, mode: 'polling' })}\n\n`,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
            },
          }
        );
      }

      return jsonResponse({ error: 'Không tìm thấy đường dẫn API.', code: 'NOT_FOUND' }, 404);
    } catch (err) {
      if (err instanceof WorkerBankError) {
        return jsonResponse({ error: err.message, code: err.code }, err.status);
      }
      console.error('[PLAYBANK WORKER ERROR]', err);
      return jsonResponse(
        { error: 'Đã xảy ra lỗi máy chủ PLAYBANK. Vui lòng thử lại.', code: 'INTERNAL_ERROR' },
        500
      );
    }
  },
};
