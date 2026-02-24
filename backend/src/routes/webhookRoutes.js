import express from 'express';
import {
    getProvisioningStatus,
    handleWooCommerceOrderCompleted,
    manuallyProvisionEsim
} from '../controllers/webhookController.js';
import { authenticateToken, authorize } from '../middleware/auth.js';

const router = express.Router();

// Public webhook (no auth)
router.post(
  '/webhooks/woocommerce/order-completed',
  express.json(),
  handleWooCommerceOrderCompleted
);

// Admin endpoints (require auth)
router.post(
  '/api/admin/provision/manual',
  authenticateToken,
  authorize(['admin']),
  manuallyProvisionEsim
);

router.get(
  '/api/admin/provision/status/:orderId',
  authenticateToken,
  authorize(['admin']),
  getProvisioningStatus
);

export default router;