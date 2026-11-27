import { migrateArtwork } from '@/api/v1/shared/infrastructure/services/artwork/migrateArtwork';
import type http from 'node:http';
import type https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { appReadyMessage, showAppName, showMessage, spinner } from '@seerial/cli';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from 'dotenv';
import { app } from 'electron';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import {
  downloaderService,
  fileSystemService,
  notificationService,
  tmdbApiClient,
  useCases,
} from '@/api/v1/shared/infrastructure/adapters/di/container';
import { SmartScanScheduler } from '@/api/v1/libraries/application/services/SmartScanScheduler';
import { loadServerConfig } from '@/api/v1/servers/infrastructure/services/ServerSettings';
import { scanActivity } from '@/api/v1/shared/infrastructure/services/ScanActivityTracker';
import * as ConfigManager from '@/api/v1/shared/infrastructure/services/ConfigService';
import { TrackSelectionService } from '@/api/v1/shared/infrastructure/services/TrackSelectionService';
import { appUpdaterService } from '@/api/v1/updates/infrastructure/services/AppUpdaterService';
import { createUpdatesRouter } from '@/api/v1/updates/infrastructure/web/updatesRouter';
import logger from '@/utils/logger';
import swaggerDocument from '../swagger.json';
import { ServerConfigService } from './api/v1/servers/infrastructure/services/ServerConfigService';
import { DatabaseManager } from './api/v1/shared/infrastructure/persistence/DatabaseManager';
import { globalErrorHandler } from './api/v1/shared/infrastructure/web/exceptions/GlobalErrorHandler';
import { requestsIDsMiddleware } from './middleware/request.id.middleware';
import { sanitizationMiddleware } from './middleware/sanitization.middleware';
import { tokenRefreshMiddleware } from './middleware/token-refresh.middleware';
import { watchListPrivacyMiddleware } from './middleware/watchlist-privacy.middleware';
import { RegisterRoutes } from './routes/routes';
import { createTray } from './utils/appTray';

// Initialize app and environment
config({
  quiet: true,
});
process.env.APP_ROOT = path.join(__dirname, '../../');
export const appServer: Express = express();

const configuredCorsAllowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isTrustedCorsOrigin(origin: string): boolean {
  if (configuredCorsAllowedOrigins.has(origin)) {
    return true;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    return false;
  }

  const hostname = parsedOrigin.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    return true;
  }

  if (net.isIP(hostname) === 4) {
    return isPrivateIpv4(hostname);
  }

  if (net.isIP(hostname) === 6) {
    const lower = hostname.toLowerCase();
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }

  return false;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  showMessage('Another Seerial Server instance is already running. Exiting...');
  app.exit(0);
}

// Add compression middleware to compress responses and save bandwidth
appServer.use(compression());

// Sanitization middleware
appServer.use(sanitizationMiddleware);

// Requests IDs for debugging
appServer.use(requestsIDsMiddleware);

// Middleware
appServer.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Curl or server side requests
      if (isTrustedCorsOrigin(origin)) {
        callback(null, origin);
        return;
      }

      callback(null, false);
    },
    credentials: true, // Allow cookies
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'X-New-Token'],
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Rate limit for login endpoint
appServer.use(
  '/api/users/login',
  rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 20, // 20 attempts per IP
    message: 'Too many login attempts, please try again later',
  }),
);

// Limit the max number of requests per minute
appServer.use(
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 1000, // max 1000 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Configure helmet middleware to avoid some security vulnerabilities
appServer.use(
  helmet({
    contentSecurityPolicy: {
      // Applied only to HTML responses (the embedded web client).
      // The API itself returns JSON, so CSP has minimal impact there,
      // but the web frontend benefits from script/style restrictions.
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles required by some UI libs
        imgSrc: ["'self'", 'data:', 'blob:', 'https://image.tmdb.org'], // TMDB posters and backdrops
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        // Helmet adds `upgrade-insecure-requests` by default: opened over plain HTTP from another
        // computer of the network (http://192.168.x.x:34200) the browser would upgrade every
        // request of the page to HTTPS, which the server does not serve, and nothing would load.
        upgradeInsecureRequests: null,
      },
    },
    strictTransportSecurity: false, // Sent below, only over HTTPS
    // Images and media are loaded by other origins too (desktop client, dev web client)
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Both are ignored (and only log warnings) when the page is opened over plain HTTP from the
    // local network
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    crossOriginEmbedderPolicy: false, // Avoid problems with video streaming
  }),
);

// HSTS only makes sense (and is only honoured) over HTTPS
appServer.use((req: Request, res: Response, next: NextFunction) => {
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

appServer.use(express.json({ limit: '50mb' }));
appServer.use(express.urlencoded({ limit: '50mb', extended: true }));
appServer.use(cookieParser());

// Keep legacy /media URLs working but block sensitive folders from static exposure.
appServer.use('/media', (req: Request, res: Response, next: NextFunction) => {
  let normalizedPath = '/';
  try {
    normalizedPath = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, '/'));
  } catch {
    normalizedPath = path.posix.normalize(req.path.replace(/\\/g, '/'));
  }

  const firstSegment = normalizedPath.replace(/^\/+/, '').split('/')[0]?.toLowerCase();
  const blockedSegments = new Set(['config', 'db']);

  if (firstSegment && blockedSegments.has(firstSegment)) {
    return res.status(404).end();
  }

  next();
});

appServer.use(
  '/media',
  express.static(fileSystemService.getExternalPath('resources'), {
    dotfiles: 'deny',
    index: false,
    fallthrough: false,
  }),
);

// Global server and WebSocket manager
export let server: http.Server | https.Server;

// Start the app
if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    showMessage('Another Seerial Server instance launch was blocked.');
  });

  app.whenReady().then(async () => {
    showAppName('SEERIAL SERVER');

    // Dynamic CLI message
    const s = spinner();

    // Initialize dependencies
    s.start('Initializing Youtube Downloader...');

    await downloaderService.downloadYoutubeDownloader();
    // Before anything can use it: the binary is replaced while updating
    await downloaderService.updateYoutubeDownloader();

    s.stop('Youtube Downloader Initialized');

    await DatabaseManager.initializeDB();
    fileSystemService.initFolders();
    fileSystemService.loadProperties();
    await ConfigManager.loadConfig();

    showMessage('Database Initialized');

    // Audio and subtitles chosen by the preferences of each library (in the background: it can
    // take a while for big libraries)
    TrackSelectionService.prepareLibraries().catch((error) =>
      logger.error({ error }, 'Failed to prepare the track preferences of the libraries'),
    );

    // Images of the previous layout (media folders) are moved next to their content, in the
    // background. Nothing to do once moved.
    migrateArtwork().catch((error) => logger.error({ error }, 'Failed to migrate the images'));

    // Collections created by hand were not shown in the libraries of their items
    await useCases
      .linkCollectionLibraries()
      .execute()
      .catch((error) => logger.error({ error }, 'Failed to link the collections to libraries'));

    // Initialize MovieDB
    await tmdbApiClient.initialize();

    showMessage('TheMovieDB API Client Initialized');

    // Load or create server and user configs
    await ServerConfigService.loadOrCreateServerConfig();

    // Register HTTPS redirection before API routes so it applies to all handlers.
    ServerConfigService.applyForceHttpsIfNeeded(appServer);

    // Swagger UI — only exposed outside production to prevent API enumeration
    if (process.env.NODE_ENV !== 'production') {
      appServer.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    }

    // Register generated tsoa routes
    appServer.use(tokenRefreshMiddleware);
    appServer.use(watchListPrivacyMiddleware);
    appServer.use(createUpdatesRouter(appUpdaterService));
    RegisterRoutes(appServer);

    // Serve static web files
    const webPath = path.join(__dirname, 'web');
    appServer.use(express.static(webPath));

    // Capture all requests and redirect to index.html
    appServer.use((req: Request, res: Response, next: NextFunction) => {
      // If the request is for a file (has an extension), skip to next middleware
      if (path.extname(req.path)) {
        return next();
      }

      res.sendFile(path.join(webPath, 'index.html'));
    });

    // Error handling middleware
    appServer.use(globalErrorHandler);

    // Start server
    await ServerConfigService.startServer(appServer);

    showMessage('Server Initialized');

    // Initialize NotificationService through DI container
    notificationService.init(ServerConfigService.mainServer);

    // New versions are downloaded in the background; admins install them from the web
    appUpdaterService.start();

    // Clients show what the server is scanning / downloading in the background
    scanActivity.subscribe((activity) =>
      notificationService.broadcast(JSON.stringify({ header: 'SCAN_ACTIVITY', body: activity })),
    );

    // Smart scan: all the libraries now and then every day / week / month (see the settings)
    let smartScanRuns = 0;
    new SmartScanScheduler({
      getSettings: () => {
        const { config } = loadServerConfig();
        return {
          enabled: config.smartScan !== false,
          period: String(config.smartScanPeriod ?? 'daily'),
        };
      },
      scanAllLibraries: async () => {
        // yt-dlp breaks when YouTube changes: keep it up to date for long-running servers too
        // (the startup already updated it, so the first scan does not repeat it)
        if (smartScanRuns++ > 0) await downloaderService.updateYoutubeDownloader();

        const libraries = await useCases.getLibraries().execute();
        for (const library of libraries) {
          await useCases.scanLibrary().execute(library, false);
        }
      },
    }).start();

    // Create tray
    createTray();

    const httpPort = ServerConfigService.serverConfig.httpPort;
    appReadyMessage({
      url: `http://localhost:${httpPort}/api/v1`,
      swaggerUrl: `http://localhost:${httpPort}/api-docs`,
      env: 'development',
    });
  });
}

// Prevent default quit behavior on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
