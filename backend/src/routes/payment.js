import express from 'express';
import { body } from 'express-validator';
import {
    amazonPayCallback,
    getPaymentStatus,
    initAmazonPay,
    refundPayment
} from '../controllers/paymentController.js';
import { authenticateToken, authorize } from '../middleware/auth.js';

const router = express.Router();

// Validation
const validatePayment = [
  body('orderId').notEmpty().withMessage('Order ID required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount required'),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Valid currency code required')
];

// Amazon Pay routes
router.post('/amazon-pay/init', 
  authenticateToken, 
  validatePayment,
  initAmazonPay
);

router.post('/amazon-pay/callback', amazonPayCallback);

router.get('/amazon-pay/status/:orderId', 
  authenticateToken, 
  getPaymentStatus
);

router.post('/amazon-pay/refund/:orderId', 
  authenticateToken, 
  authorize(['admin']), // Only admins can refund
  body('amount').optional().isFloat({ min: 0.01 }),
  body('reason').optional().isString(),
  refundPayment
);

export default router;