/**
 * @fileoverview Express application: security headers, static client,
 * REST API, health checks and consistent JSON errors.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AppError } from '../domain/errors.js';
import { ErrorCodes } from '../domain/protocol.js';
import { isChannelId } from '../domain/validation.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const require = createRequire(import.meta.url);
const SWAGGER_UI_DIR = path.dirname(require.resolve('swagger-ui-dist/package.json'));

/**
 * Same-origin by default; ALLOWED_ORIGINS widens it explicitly.
 * Requests without an Origin header (curl, server-to-server) are allowed.
 * @param {string[]} allowedOrigins
 */
export function createOriginPolicy(allowedOrigins) {
  /**
   * @param {string|undefined} origin
   * @param {string|undefined} host
   */
  return (origin, host) => {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  };
}

/**
 * Parses an optional non-negative integer query parameter.
 * @param {unknown} value
 * @param {string} name
 */
function optionalInt(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(n)) {
    throw new AppError(ErrorCodes.BAD_REQUEST, `${name} must be a non-negative integer`);
  }
  return n;
}

/**
 * @param {{
 *   config: import('../config.js').Config,
 *   service: import('../domain/chat-service.js').ChatService,
 *   logger: import('pino').Logger,
 *   health: { isReady: () => boolean },
 *   hooks?: { onChannelCreated?: (c: import('../db/repositories.js').Channel) => void, isLowBandwidth?: (userId: string) => boolean },
 * }} deps
 */
export function createApp({ config, service, logger, health, hooks = {} }) {
  const log = logger.child({ component: 'http' });
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          // Only upgrade when served over HTTPS (local http://localhost would break otherwise).
          'upgrade-insecure-requests': config.nodeEnv === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // HSTS only makes sense behind HTTPS; production deployments terminate TLS at the proxy.
      strictTransportSecurity: config.nodeEnv === 'production',
    }),
  );

  const isOriginAllowed = createOriginPolicy(config.allowedOrigins);
  if (config.allowedOrigins.length) {
    app.use('/api', cors({ origin: config.allowedOrigins, allowedHeaders: ['Authorization', 'Content-Type'] }));
  }
  app.use(compression());

  // ---- health -------------------------------------------------------------
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => {
    const ready = health.isReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });

  // ---- static client & docs ---------------------------------------------
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.use('/api-docs/assets', express.static(SWAGGER_UI_DIR, { index: false }));
  app.get('/api-docs', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'api-docs.html')));

  // ---- API ------------------------------------------------------------------
  const api = express.Router();
  api.use(express.json({ limit: '4kb' }));

  const writeLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.httpWriteRateLimitPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: ErrorCodes.RATE_LIMITED, message: 'too many requests, try again later' } }),
  });

  /** Rejects cross-site browser writes even when CORS is open for reads. */
  /** @type {express.RequestHandler} */
  const sameOriginWrites = (req, _res, next) => {
    if (!isOriginAllowed(req.headers.origin, req.headers.host)) {
      return next(new AppError(ErrorCodes.FORBIDDEN, 'origin not allowed'));
    }
    next();
  };

  /** @type {express.RequestHandler} */
  const requireAuth = (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new AppError(ErrorCodes.UNAUTHORIZED, 'missing bearer token'));
    }
    try {
      const user = service.authenticate(token);
      res.locals.user = user;
      if (hooks.isLowBandwidth?.(user.id)) res.setHeader('X-Low-Bandwidth', 'true');
      next();
    } catch (error) {
      next(error);
    }
  };

  /** @param {(req: express.Request, res: express.Response) => unknown} fn @returns {express.RequestHandler} */
  const handle = (fn) => (req, res, next) => {
    try {
      const result = fn(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      next(error);
    }
  };

  api.post(
    '/session',
    writeLimiter,
    sameOriginWrites,
    handle((req, res) => {
      const { user, token } = service.createSession(req.body?.username);
      res.status(201).json({ user: { id: user.id, username: user.username }, token });
    }),
  );

  api.get(
    '/me',
    requireAuth,
    handle((_req, res) => ({ id: res.locals.user.id, username: res.locals.user.username })),
  );
  api.get(
    '/users',
    requireAuth,
    handle(() => service.listUsers()),
  );
  api.get(
    '/channels',
    requireAuth,
    handle(() => service.listChannels()),
  );
  api.post(
    '/channels',
    requireAuth,
    writeLimiter,
    sameOriginWrites,
    handle((req, res) => {
      const channel = service.createChannel(res.locals.user.id, req.body?.name);
      hooks.onChannelCreated?.(channel);
      res.status(201).json(channel);
    }),
  );

  /** @param {express.Request} req @param {express.Response} res */
  const history = (req, res) => {
    const { channelId } = req.params;
    if (!isChannelId(channelId)) throw new AppError(ErrorCodes.BAD_REQUEST, 'invalid channelId');
    const limit = optionalInt(req.query.limit, 'limit');
    const before = optionalInt(req.query.before, 'before');
    const after = optionalInt(req.query.after, 'after');
    if (before !== undefined && after !== undefined) {
      throw new AppError(ErrorCodes.BAD_REQUEST, 'use either before or after, not both');
    }
    return service.getHistory(res.locals.user.id, channelId, { limit, before, after });
  };
  api.get('/channels/:channelId/messages', requireAuth, handle(history));
  // Backwards-compatible alias of the original endpoint.
  api.get('/messages/:channelId', requireAuth, handle(history));

  api.use((_req, _res, next) => next(new AppError(ErrorCodes.NOT_FOUND, 'route not found')));
  app.use('/api', api);

  // ---- errors -----------------------------------------------------------------
  app.use((_req, res) => res.status(404).type('text/plain').send('Not Found'));

  /** @type {express.ErrorRequestHandler} */
  const errorHandler = (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    // body-parser errors (invalid JSON, payload too large) carry a 4xx status.
    const status = Number(err?.status ?? err?.statusCode);
    if (status >= 400 && status < 500) {
      const message = status === 413 ? 'request body too large' : 'invalid request body';
      res.status(status).json({ error: { code: ErrorCodes.BAD_REQUEST, message } });
      return;
    }
    log.error({ err, method: req.method, url: req.originalUrl }, 'unhandled request error');
    res.status(500).json({ error: { code: ErrorCodes.INTERNAL, message: 'internal server error' } });
  };
  app.use(errorHandler);

  return { app, isOriginAllowed };
}
