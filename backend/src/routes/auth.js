import express from 'express';
import { body } from 'express-validator';
import {
  forgotPassword,
  getCurrentUser,
  login,
  logout,
  refreshToken,
  register,
  resetPassword
} from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Validation middleware
const validateRegister = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('fullName').notEmpty().trim().withMessage('Full name is required'),
  body('phone').optional().isMobilePhone('any').withMessage('Valid phone number required')
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
];

// Public routes
router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.post('/logout', logout);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', 
  body('email').isEmail().normalizeEmail(),
  forgotPassword
);
router.post('/reset-password', 
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  resetPassword
);

// Protected routes
router.get('/me', authenticateToken, getCurrentUser);
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    user: req.user
  });
});

export default router;