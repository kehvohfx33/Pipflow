import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { checkDatabaseHealth } from '../database/pool';
import { derivConnectionManager } from '../integrations/deriv/connection-manager';
import { getPublicSettings } from '../services/settings-service';
import { requireAuth } from '../middleware/authentication';
import { requireAdmin, requireDb, requireOwner } from '../middleware/authorization';
import { adminAuthRateLimiter, authRateLimiter } from '../middleware/rate-limit';
import * as authCtrl from '../controllers/authController';
import * as derivCtrl from '../controllers/derivController';
import * as marketCtrl from '../controllers/marketController';
import * as tradingCtrl from '../controllers/tradingController';
import * as adminCtrl from '../controllers/adminController';
import * as ownerCtrl from '../controllers/ownerController';

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

// Authentication, Session Revocation & Private Entry Validation
router.post('/auth/register', authRateLimiter, requireDb, asyncHandler(authCtrl.register));
router.post('/auth/login', authRateLimiter, requireDb, asyncHandler(authCtrl.login));
router.post('/auth/logout', requireDb, asyncHandler(authCtrl.logout));
router.post('/auth/revoke-sessions', requireDb, asyncHandler(requireAuth), asyncHandler(authCtrl.revokeAllSessions));
router.get('/auth/me', requireDb, asyncHandler(requireAuth), asyncHandler(authCtrl.getMe));
router.get('/auth/console-entry', authRateLimiter, asyncHandler(authCtrl.checkConsoleEntry));
router.get('/auth/verify-email', requireDb, asyncHandler(authCtrl.verifyEmail));
router.post('/auth/forgot-password', authRateLimiter, requireDb, asyncHandler(authCtrl.forgotPassword));
router.post('/auth/reset-password', authRateLimiter, requireDb, asyncHandler(authCtrl.resetPassword));
router.post('/bot-gate/unlock', authRateLimiter, requireDb, asyncHandler(requireAuth), asyncHandler(authCtrl.unlockBotAnalyserGate));

// Official Deriv OAuth2 Sign-Up / Login & Account Management
router.get('/deriv/oauth-url/public', asyncHandler(derivCtrl.getPublicDerivOAuthUrl));
router.get('/deriv/oauth-url', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.getDerivOAuthUrl));
router.get(['/deriv/oauth/callback', '/deriv/oauth/callback/'], requireDb, asyncHandler(derivCtrl.handleDerivOAuthCallback));
router.post('/deriv/oauth/exchange', requireDb, asyncHandler(derivCtrl.exchangeDerivOAuthTokens));
router.post('/deriv/connect', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.connectDerivToken));
router.get('/deriv/accounts', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.listConnectedAccounts));
router.get('/deriv/adjustments', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.getUserBalanceAdjustments));
router.post('/deriv/accounts/:id/sync', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.syncConnectedAccount));
router.post('/deriv/accounts/:id/disconnect', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.disconnectAccount));
router.post('/deriv/accounts/:id/revoke', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.revokeAccountAuthorization));
router.get('/deriv/statement/:accountId', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.getReadOnlyStatement));
router.post('/deriv/proposal', asyncHandler(derivCtrl.getDerivProposal));
router.get('/deriv/contracts-for', asyncHandler(derivCtrl.getContractsForSymbol));
router.get('/deriv/open-contract/:contractId', requireDb, asyncHandler(requireAuth), asyncHandler(derivCtrl.getOpenContractSnapshot));

// Official Deriv Public Market Data + Independent External XAUUSD Feed + AI Analysis & Signals
router.get('/market/instruments', asyncHandler(marketCtrl.listInstruments));
router.get('/market/candles', asyncHandler(marketCtrl.getSymbolCandles));
router.get('/market/external-feed', asyncHandler(marketCtrl.getExternalFeed));
router.get('/market/ai-analysis', asyncHandler(marketCtrl.getAiMarketAnalysis));
router.get('/market/signals', asyncHandler(marketCtrl.getMarketSignals));

// Open Market Analyser & Instant Trading Bots + Persistent Workspaces & Runs
router.get('/market/digit-analysis', asyncHandler(marketCtrl.getDigitAnalysis));
router.get('/bots/strategies', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.listStrategies));
router.get('/bots/workspaces', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.listBotWorkspaces));
router.post('/bots/workspaces', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.saveBotWorkspace));
router.delete('/bots/workspaces/:id', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.deleteBotWorkspace));
router.get('/bots/runs', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.listBotRuns));
router.post('/bots/run', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.runBot));
router.post('/bots/pause', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.pauseBot));
router.post('/bots/resume', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.resumeBot));
router.post('/bots/stop', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.stopBot));
router.post('/bots/emergency-stop', requireDb, asyncHandler(requireAuth), asyncHandler(tradingCtrl.emergencyStopBotHandler));
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

// Console Bootstrap & Sign-In (OWNER / ADMIN)
router.get('/admin/bootstrap-status', requireDb, asyncHandler(adminCtrl.getAdminBootstrapStatus));
router.post('/admin/bootstrap', adminAuthRateLimiter, requireDb, asyncHandler(adminCtrl.bootstrapAdmin));
router.post('/admin/login', adminAuthRateLimiter, requireDb, asyncHandler(adminCtrl.adminLogin));

// Operations Admin + Owner Routes
router.get('/admin/overview', asyncHandler(requireAuth), requireDb, asyncHandler(requireAdmin), asyncHandler(adminCtrl.getAdminOverview));
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
router.patch(
  '/admin/users/:id/status',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.toggleUserStatus)
);
router.post(
  '/admin/users/:id/revoke-sessions',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireAdmin),
  asyncHandler(adminCtrl.revokeUserSessions)
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

// Platform OWNER-Exclusive Routes (Platform Settings, Credentials, Roles, Commissions, Deletions & Financial Adjustments)
router.put(
  '/admin/settings/admin-credentials',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.updateAdminCredentials)
);
router.patch(
  '/admin/users/:id/role',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.updateUserRole)
);
router.delete(
  '/admin/users/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.deleteUser)
);
router.delete(
  '/admin/connected-accounts/:id',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.deleteConnectedAccount)
);
router.post(
  '/admin/connected-accounts/connect',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.adminConnectDerivToken)
);
router.put(
  '/admin/settings/bot-password',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.updateBotGatePassword)
);
router.put(
  '/admin/settings/branding',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.updateBrandingSettings)
);
router.put(
  '/admin/settings/global',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.updateGlobalSettings)
);
router.put(
  '/admin/settings/site-controls',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.updateSiteControls)
);
router.get(
  '/admin/commissions',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.getDerivCommissions)
);
router.get(
  '/admin/commissions/oauth-url',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.getAdminCommissionOAuthUrl)
);
router.put(
  '/admin/commissions/config',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(adminCtrl.updateDerivCommissionConfig)
);

// Owner-Exclusive 8-Step Synchronized Balance Management & Immutable Ledger
router.get(
  '/owner/balance-adjustments',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(ownerCtrl.listOwnerBalanceAdjustments)
);
router.post(
  '/owner/accounts/:id/sync-for-adjustment',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(ownerCtrl.syncAccountForAdjustment)
);
router.post(
  '/owner/accounts/:id/adjustments',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(ownerCtrl.createPlatformAdjustment)
);
router.post(
  '/owner/accounts/:id/exact-mode',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(ownerCtrl.toggleRealExactMode)
);
router.post(
  '/owner/users/:id/virtual-adjustments',
  asyncHandler(requireAuth),
  requireDb,
  asyncHandler(requireOwner),
  asyncHandler(ownerCtrl.adjustVirtualWorkspaceBalance)
);
