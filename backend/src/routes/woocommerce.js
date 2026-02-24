import express from 'express';
import {
    createOrder,
    getOrderById,
    getOrders,
    getProductById,
    getProducts,
    getProductVariations,
    updateOrder
} from '../controllers/wooController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public product routes
router.get('/products', getProducts);
router.get('/products/:id', getProductById);
router.get('/products/:id/variations', getProductVariations);

// Protected order routes
router.get('/orders', authenticateToken, getOrders);
router.get('/orders/:id', authenticateToken, getOrderById);
router.post('/orders', authenticateToken, createOrder);
router.put('/orders/:id', authenticateToken, updateOrder);

export default router;