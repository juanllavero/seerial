import { type NextFunction, type Request, type Response, Router } from 'express';
import { BadRequestException } from '@/api/v1/shared/infrastructure/web/exceptions/HTTPExceptions';
import { ApiResponse } from '@/api/v1/shared/infrastructure/web/http/APIResponse';
import { expressAuthentication } from '@/middleware/tsoa.authentication';
import type { AppUpdaterPort } from '../../application/ports/AppUpdaterPort';

/**
 * /api/updates: state of the server self-update and installing it (admins only).
 * Plain express routes: the tsoa generator does not run with the current tsoa versions.
 */
export function createUpdatesRouter(updater: AppUpdaterPort): Router {
  const router = Router();

  const adminOnly = (req: Request, _res: Response, next: NextFunction) => {
    expressAuthentication(req, 'adminAuth')
      .then(() => next())
      .catch(next);
  };

  router.get('/api/updates', adminOnly, (_req, res) => {
    res.json(ApiResponse.success(updater.getStatus(), 'OK'));
  });

  router.post('/api/updates/install', adminOnly, (_req, res, next) => {
    if (updater.getStatus().state !== 'ready') {
      next(new BadRequestException('No update ready to install'));
      return;
    }
    updater
      .install()
      .then(() =>
        res.status(202).json(ApiResponse.success(updater.getStatus(), 'Installing update')),
      )
      .catch(next);
  });

  return router;
}
