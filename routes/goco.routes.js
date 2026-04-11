const express = require('express');
const { protect, admin } = require('../middleware/auth');
const { buildRouteCache } = require('../middleware/cache');
const {
	adminGrantBonus,
	adminListWithdrawals,
	adminReviewWithdrawal,
	getMyWithdrawals,
	getProgram,
	getTransactions,
	getWallet,
	requestWithdrawal,
} = require('../controllers/goco.controller');

const router = express.Router();

router.get('/program', protect, buildRouteCache({ ttlMs: 15000 }), getProgram);
router.get('/wallet', protect, buildRouteCache({ ttlMs: 8000 }), getWallet);
router.get('/transactions', protect, getTransactions);
router.get('/withdrawals', protect, getMyWithdrawals);
router.post('/withdrawals', protect, requestWithdrawal);
router.get('/admin/withdrawals', protect, admin, adminListWithdrawals);
router.post('/admin/bonus', protect, admin, adminGrantBonus);
router.patch('/admin/withdrawals/:id', protect, admin, adminReviewWithdrawal);

module.exports = router;