import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { checkDatabaseHealth } from '../database/pool';
import { derivConnectionManager } from '../integrations/deriv/connection-manager';
import { getPublicSettings } from '../services/settings-service';
import { requireAuth } from '../middleware/authentication';
import { requireAdmin, requireDb } from '../middleware/authorization';
import { adminAuthRateLimiter, authRateLimiter } from '../middleware/rate-limit';
import * as authCtrl from '../controllers/authController';
import * as derivCtrl from '../controllers/derivController';
import * as marketCtrl from '../controllers/marketController';
import * as tradingCtrl from '../controllers/tradingController';
import * as adminCtrl from '../controllers/adminController';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const router = Router();

// Health & Public Settings
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const db = await checkDatabaseHealth();
    res.json({
      status: 'ok',
      database: db,
      deriv: derivConnectionManager.getDiagnostics(),
      timestamp: new Date().toISOString()
    });
  })
);

router.get(
  '/settings/public',
  asyncHandler(async (_req, res) => {
    res.json(await getPublicSettings());
  })
);

// Authentication & Password Gate
router.post('/auth/register', authRateLimiter, requireDb, asyncHandler(authCtrl.register));
router.post('/auth/login', authRateLimiter, requireDb, asyncHandler(authCtrl.login));
router.get('/auth/me', requireDb, asyncHandler(requireAuth), asyncHandler(authCtrl.getMe));
router.get('/auth/verify-email', requireDb, asyncHandler(authCtrl.verifyEmail));
router.post('/auth/forgot-password', authRateLimiter, requireDb, asyncHandler(authCtrl.forgotPassword));
router.post('/auth/reset-password', authRateLimiter, requireDb, asyncHandler(authCtrl.resetPassword));
router.post('/bot-gate/unlock', authRateLimiter, requireDb, asyncHandler(requireAuth), asyncHandler(authCtrl.unlockBotAnalyserGate));

// Official Deriv OAuth2 Sign-Up / Login & Read-Only Account Management
router.get('/deriv/oauth-url/public', asyncHandler(derivCtrl.getPublicDerivOAuthUrl));
router.get('/deriv/oauth-url', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.getDerivOAuthUrl));
router.get(['/deriv/oauth/callback', '/deriv/oauth/callback/'], requireDb, asyncHandler(derivCtrl.handleDerivOAuthCallback));
router.post('/deriv/oauth/exchange', requireDb, asyncHandler(derivCtrl.exchangeDerivOAuthTokens));
router.post('/deriv/connect', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.connectDerivToken));
router.get('/deriv/accounts', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.listConnectedAccounts));
router.post('/deriv/accounts/:id/sync', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.syncConnectedAccount));
router.post('/deriv/accounts/:id/disconnect', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.disconnectAccount));
router.post('/deriv/accounts/:id/revoke', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.revokeAccountAuthorization));
router.get('/deriv/statement/:accountId', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.getReadOnlyStatement));

// Official Deriv Public Market Data
router.get('/market/instruments', asyncHandler(marketCtrl.listInstruments));
router.get('/market/candles', asyncHandler(marketCtrl.getSymbolCandles));

// Open Market Analyser & Instant Trading Bots (No Password Gate)
router.get('/market/digit-analysis', asyncHandler(marketCtrl.getDigitAnalysis));
router.get('/bots/strategies', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.listStrategies));
router.post('/bots/run', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.runBot));
router.post('/bots/stop', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.stopBot));
router.post('/bots/close-all', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.closeBotOrders));
router.get('/bots/status', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.botStatus));

// Virtual & Deriv MT5 Orders (TP/SL), Bulk Execution, Watchlists & Notifications
router.get('/orders', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.listOrders));
router.post('/orders', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.placeVirtualOrder));
router.post('/orders/bulk', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.placeBulkOrders));
router.post('/orders/bulk-close', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.bulkCloseOrders));
router.post('/orders/:id/close', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.closeVirtualOrder));
router.post('/orders/reset-balance', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.resetVirtualBalance));

router.get('/watchlists', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.listWatchlists));
router.post('/watchlists', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.addWatchlist));
router.delete('/watchlists/:symbol', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.removeWatchlist));

router.get('/notifications', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.listNotifications));
router.patch('/notifications/:id/read', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.markNotificationRead));

// Server-Side Database-Backed Administrator Authentication & Modules
router.get('/admin/bootstrap-status', requireDb, asyncHandler(adminCtrl.getAdminBootstrapStatus));
router.post('/admin/bootstrap', adminAuthRateLimiter, requireDb, asyncHandler(adminCtrl.bootstrapAdmin));
router.post('/admin/login', adminAuthRateLimiter, requireDb, asyncHandler(adminCtrl.adminLogin));

router.get('/admin/overview', asyncHandler(requireAuth), requireDb, asyncHandler(requireAdmin), asyncHandler(adminCtrl.getAdminOverview));
router.put(
  '/admin/settings/admin-credentials',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateAdminCredentials)
);
router.patch(
  '/admin/users/:id/role',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateUserRole)
);
router.patch(
  '/admin/users/:id/virtual-balance',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateUserVirtualBalance)
);
router.patch(
  '/admin/connected-accounts/:id/balance',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateConnectedAccountBalance)
);
router.post(
  '/admin/connected-accounts/:id/sync',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.adminSyncConnectedAccount)
);
router.post(
  '/admin/connected-accounts/:id/disconnect',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.adminDisconnectConnectedAccount)
);
router.post(
  '/admin/connected-accounts/:id/revoke',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.adminRevokeConnectedAccount)
);
router.post(
  '/admin/connected-accounts/connect',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.adminConnectDerivToken)
);
router.patch(
  '/admin/users/:id/status',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.toggleUserStatus)
);
router.put(
  '/admin/settings/bot-password',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateBotGatePassword)
);
router.put(
  '/admin/settings/branding',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateBrandingSettings)
);
router.put(
  '/admin/settings/global',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateGlobalSettings)
);
router.put(
  '/admin/settings/site-controls',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateSiteControls)
);
router.post(
  '/admin/announcements',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.broadcastAnnouncement)
);
router.delete(
  '/admin/announcements/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.deleteAnnouncement)
);
router.post(
  '/admin/users',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.createUser)
);
router.patch(
  '/admin/users/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateUser)
);
router.delete(
  '/admin/users/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.deleteUser)
);
router.delete(
  '/admin/connected-accounts/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.deleteConnectedAccount)
);
router.post(
  '/admin/strategies',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.createStrategy)
);
router.patch(
  '/admin/strategies/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateStrategy)
);
router.delete(
  '/admin/strategies/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.deleteStrategy)
);
router.post(
  '/admin/orders/close-all',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.closeAllAdminOrders)
);
router.post(
  '/admin/orders/:id/close',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.closeAdminOrder)
);
router.delete(
  '/admin/orders/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.deleteAdminOrder)
);
router.get(
  '/admin/commissions',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.getDerivCommissions)
);
router.get(
  '/admin/commissions/oauth-url',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.getAdminCommissionOAuthUrl)
);
router.put(
  '/admin/commissions/config',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.updateDerivCommissionConfig)
);
