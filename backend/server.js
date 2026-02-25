import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// Import routes
import authRoutes from './src/routes/auth.js';
import esimRoutes from './src/routes/esim.js';
import webhookRoutes from './src/routes/webhookRoutes.js'; // THÊM DÒNG NÀY
import wooRoutes from './src/routes/woocommerce.js';

// Import middleware
import { logger } from './src/utils/helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Parse allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'http://localhost:8081'];

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Middleware
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply rate limiting to API routes
app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/wp-json/wc/v3', wooRoutes);
app.use('/esim', esimRoutes);
app.use('/', webhookRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: '🚀 Server is running!',
    endpoints: {
      auth: ['POST /auth/register', 'POST /auth/login', 'GET /auth/me'],
      woocommerce: ['GET /wp-json/wc/v3/products', 'GET /wp-json/wc/v3/orders'],
      esim: ['POST /esim/activate', 'GET /esim/status/:esimId', 'GET /esim/install-guide/:esimId'],
      webhook: ['POST /webhooks/woocommerce/order-completed'], // THÊM
      admin: ['POST /api/admin/provision/manual', 'GET /api/admin/provision/status/:orderId'] // THÊM
    },
    docs: 'https://github.com/your-repo/docs'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    message: `Cannot ${req.method} ${req.path}`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Server error:', err.stack);
  
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  
  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🚀 eSIM Backend Server                                ║
║   ═══════════════════════                                ║
║                                                          ║
║   📡 Port: ${PORT}                                          ║
║   🌍 Environment: ${process.env.NODE_ENV || 'development'}                ║
║   🔋 Uptime: 0s                                          ║
║                                                          ║
║   📌 Available endpoints:                                 ║
║   ├── 🔐 Auth: http://localhost:${PORT}/auth              ║
║   ├── 🛒 Woo: http://localhost:${PORT}/wp-json/wc/v3       ║
║   ├── 💳 Payment: http://localhost:${PORT}/payment         ║
║   ├── 📱 eSIM: http://localhost:${PORT}/esim               ║
║   ├── 🔔 Webhook: http://localhost:${PORT}/webhooks        ║
║   └── 👑 Admin: http://localhost:${PORT}/api/admin         ║
║                                                          ║
║   🔍 Test: http://localhost:${PORT}/test                   ║
║   💓 Health: http://localhost:${PORT}/health               ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});

export default app;