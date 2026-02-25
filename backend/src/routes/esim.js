import express from 'express';
import { body, param, query } from 'express-validator';
import esimClient from '../config/esimClient.js';
import { supabaseAdmin } from '../config/supabaseClient.js';
import { authenticateToken, authorize } from '../middleware/auth.js';
import { generateId, logger } from '../utils/helpers.js';

const router = express.Router();

// =====================================================
// VALIDATION RULES
// =====================================================
const validatePackageQuery = [
  query('region').optional().isString(),
  query('type').optional().isIn(['data', 'voice', 'sms'])
];

const validateOrder = [
  body('packageId').notEmpty().withMessage('Package ID is required'),
  body('quantity').optional().isInt({ min: 1, max: 10 }).withMessage('Quantity must be between 1 and 10'),
  body('iccid').optional().isString(),
  body('reference').optional().isString()
];

const validateProfileId = [
  param('profileId').notEmpty().withMessage('Profile ID is required')
];

const validateIccid = [
  param('iccid').notEmpty().withMessage('ICCID is required')
];

const validateSms = [
  body('phoneNumber').notEmpty().withMessage('Phone number is required'),
  body('message').notEmpty().withMessage('Message is required').isLength({ max: 160 })
];

const validateWebhook = [
  body('url').isURL().withMessage('Valid webhook URL is required'),
  body('events').optional().isArray()
];

const validateTopUp = [
  body('amount').isFloat({ min: 10 }).withMessage('Amount must be at least 10')
];

// =====================================================
// PUBLIC WEBHOOK ENDPOINT (no auth required)
// =====================================================

/**
 * @route   POST /esim/webhook
 * @desc    Receive webhooks from ESIM Access provider
 * @access  Public (but should be secured with signature verification in production)
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookData = JSON.parse(req.body);
    
    logger.info('Received ESIM webhook:', webhookData);

    // Verify webhook signature (if provided)
    const signature = req.headers['x-signature'];
    // TODO: Verify signature with your secret key

    // Store webhook in database
    await supabaseAdmin
      .from('system_logs')
      .insert([{
        level: 'info',
        service: 'esim-webhook',
        message: 'Webhook received',
        metadata: webhookData,
        created_at: new Date()
      }]);

    // Process different webhook types
    switch (webhookData.event) {
      case 'profile.activated':
        await handleProfileActivated(webhookData);
        break;
      case 'profile.suspended':
        await handleProfileSuspended(webhookData);
        break;
      case 'profile.unsuspended':
        await handleProfileUnsuspended(webhookData);
        break;
      case 'profile.cancelled':
        await handleProfileCancelled(webhookData);
        break;
      case 'profile.expired':
        await handleProfileExpired(webhookData);
        break;
      case 'profile.revoked':
        await handleProfileRevoked(webhookData);
        break;
      case 'usage.threshold':
        await handleUsageThreshold(webhookData);
        break;
      case 'balance.low':
        await handleBalanceLow(webhookData);
        break;
      default:
        logger.info('Unhandled webhook event:', webhookData.event);
    }

    // Always return 200 OK to acknowledge receipt
    res.status(200).json({ received: true, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Webhook processing error:', error);
    // Still return 200 to prevent provider from retrying if it's a parsing error
    res.status(200).json({ received: true, error: error.message });
  }
});

// =====================================================
// HELPER FUNCTIONS FOR WEBHOOK HANDLING
// =====================================================

async function handleProfileActivated(data) {
  const { profileId, iccid, activationTime } = data;
  
  // Update eSIM status in database
  const { error } = await supabaseAdmin
    .from('esims')
    .update({ 
      status: 'ACTIVE',
      activated_at: activationTime || new Date(),
      updated_at: new Date()
    })
    .eq('iccid', iccid);

  if (error) {
    logger.error('Failed to update activated eSIM:', error);
    return;
  }

  // Log activation
  await supabaseAdmin
    .from('esim_activation_logs')
    .insert([{
      esim_id: profileId,
      action: 'ACTIVATED',
      metadata: data,
      created_at: new Date()
    }]);

  logger.info(`eSIM ${iccid} activated successfully`);
}

async function handleProfileSuspended(data) {
  const { profileId, iccid, reason } = data;
  
  await supabaseAdmin
    .from('esims')
    .update({ 
      status: 'SUSPENDED',
      metadata: { suspension_reason: reason },
      updated_at: new Date()
    })
    .eq('iccid', iccid);
}

async function handleProfileUnsuspended(data) {
  const { profileId, iccid } = data;
  
  await supabaseAdmin
    .from('esims')
    .update({ 
      status: 'ACTIVE',
      metadata: { suspension_reason: null },
      updated_at: new Date()
    })
    .eq('iccid', iccid);
}

async function handleProfileCancelled(data) {
  const { profileId, iccid, reason } = data;
  
  await supabaseAdmin
    .from('esims')
    .update({ 
      status: 'CANCELLED',
      deactivated_at: new Date(),
      deactivation_reason: reason || 'Cancelled by provider',
      updated_at: new Date()
    })
    .eq('iccid', iccid);
}

async function handleProfileExpired(data) {
  const { profileId, iccid } = data;
  
  await supabaseAdmin
    .from('esims')
    .update({ 
      status: 'EXPIRED',
      updated_at: new Date()
    })
    .eq('iccid', iccid);
}

async function handleProfileRevoked(data) {
  const { profileId, iccid, reason } = data;
  
  await supabaseAdmin
    .from('esims')
    .update({ 
      status: 'REVOKED',
      deactivated_at: new Date(),
      deactivation_reason: reason || 'Revoked by provider',
      updated_at: new Date()
    })
    .eq('iccid', iccid);
}

async function handleUsageThreshold(data) {
  const { iccid, usage, threshold, remaining } = data;
  
  // Get user associated with this eSIM
  const { data: esim } = await supabaseAdmin
    .from('esims')
    .select('user_id')
    .eq('iccid', iccid)
    .single();

  if (esim) {
    // Create notification for user
    await supabaseAdmin
      .from('user_notifications')
      .insert([{
        user_id: esim.user_id,
        type: 'USAGE_THRESHOLD',
        title: 'Data Usage Alert',
        message: `You have used ${usage}GB of data. ${remaining}GB remaining.`,
        metadata: { iccid, usage, threshold, remaining },
        created_at: new Date()
      }]);
  }
}

async function handleBalanceLow(data) {
  const { balance, threshold } = data;
  
  // Notify admins
  await supabaseAdmin
    .from('system_notifications')
    .insert([{
      type: 'BALANCE_LOW',
      title: 'Account Balance Low',
      message: `Current balance: ${balance}, threshold: ${threshold}`,
      metadata: data,
      created_at: new Date()
    }]);
}

// =====================================================
// PUBLIC ROUTES (no authentication required)
// =====================================================

/**
 * @route   GET /esim/packages/public
 * @desc    Get all available eSIM packages with real prices from eSIM Access API
 * @access  Public
 */
router.get('/packages/public', async (req, res) => {
  try {
    const { slug, locationCode, type = 'BASE' } = req.query;

    const params = { type };
    if (slug) params.slug = slug;
    if (locationCode) params.locationCode = locationCode;

    const result = await esimClient.getAllDataPackages(params);

    // eSIM Access API wraps response: result.obj.packageList or result.obj or array
    const raw =
      result?.obj?.packageList ||
      result?.obj ||
      result?.data ||
      result?.packageList ||
      (Array.isArray(result) ? result : []);

    const packages = Array.isArray(raw) ? raw : [];

    // Price is integer units (divide by 10000 = USD)
    const transformed = packages.map(pkg => ({
      packageCode: pkg.packageCode,
      name: pkg.name || pkg.packageName || '',
      price: (pkg.price || 0) / 10000,
      currencyCode: pkg.currencyCode || 'USD',
      dataAmount: formatBytes(pkg.volume),
      dataBytes: pkg.volume || 0,
      duration: pkg.duration || 0,
      durationUnit: (pkg.durationUnit || 'DAY').toLowerCase(),
      location: pkg.location || pkg.locationCode || '',
      slug: pkg.slug || '',
      type: pkg.type || 'BASE',
      retailPrice: (pkg.retailPrice || 0) / 10000,
    }));

    res.json({ success: true, data: transformed, total: transformed.length });
  } catch (error) {
    logger.error('Get public packages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch eSIM packages',
      message: error.message,
    });
  }
});

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return 'Unlimited';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)}GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.round(mb)}MB`;
}

// =====================================================
// PROTECTED ROUTES (require authentication)
// =====================================================

/**
 * @route   GET /esim/packages
 * @desc    Get all available data packages
 * @access  Private
 */
router.get('/packages', authenticateToken, validatePackageQuery, async (req, res) => {
  try {
    const { region, type } = req.query;

    // Get packages from ESIM provider
    const packages = await esimClient.getAllDataPackages();
    
    // Filter if needed
    let filteredPackages = packages;
    if (region) {
      filteredPackages = filteredPackages.filter(p => p.region === region);
    }
    if (type) {
      filteredPackages = filteredPackages.filter(p => p.type === type);
    }

    // Cache packages in database
    await supabaseAdmin
      .from('products_cache')
      .upsert(
        filteredPackages.map(pkg => ({
          id: pkg.id,
          data: pkg,
          type: 'esim',
          price: pkg.price,
          updated_at: new Date()
        })),
        { onConflict: 'id' }
      );

    res.json({
      success: true,
      data: filteredPackages,
      total: filteredPackages.length
    });
  } catch (error) {
    logger.error('Get packages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch eSIM packages',
      message: error.message
    });
  }
});

/**
 * @route   POST /esim/order
 * @desc    Order eSIM profiles
 * @access  Private
 */
router.post('/order', authenticateToken, validateOrder, async (req, res) => {
  try {
    const { packageId, quantity = 1, iccid, reference } = req.body;
    
    // Check user balance or order status here if needed
    
    const orderData = {
      packageId,
      quantity,
      iccid,
      reference: reference || `ORDER-${Date.now()}`,
      userId: req.user.id,
      timestamp: new Date().toISOString()
    };

    // Call ESIM provider API
    const result = await esimClient.orderProfiles(orderData);
    
    // Store each ordered profile in database
    const esimRecords = [];
    if (result.profiles && Array.isArray(result.profiles)) {
      for (const profile of result.profiles) {
        const esimId = generateId('ESIM');
        
        const { data: esim, error } = await supabaseAdmin
          .from('esims')
          .insert([{
            id: esimId,
            order_id: result.orderId || `ORD-${Date.now()}`,
            user_id: req.user.id,
            product_id: packageId,
            iccid: profile.iccid,
            activation_code: profile.activationCode,
            status: 'PENDING_ACTIVATION',
            qr_code: profile.qrCode,
            profile: profile,
            metadata: { provider_order_id: result.orderId },
            created_at: new Date(),
            updated_at: new Date()
          }])
          .select()
          .single();
        
        if (!error) {
          esimRecords.push(esim);
        }
      }
    }

    // Log the order
    await supabaseAdmin
      .from('system_logs')
      .insert([{
        level: 'info',
        service: 'esim-order',
        message: `Order placed for package ${packageId}`,
        user_id: req.user.id,
        metadata: { packageId, quantity, result },
        created_at: new Date()
      }]);

    logger.info(`eSIM order placed by user ${req.user.id}: ${result.orderId}`);

    res.status(201).json({
      success: true,
      message: 'eSIM order placed successfully',
      data: {
        orderId: result.orderId,
        profiles: esimRecords,
        totalOrdered: esimRecords.length
      }
    });
  } catch (error) {
    logger.error('Order eSIM error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to order eSIM',
      message: error.message
    });
  }
});

/**
 * @route   GET /esim/profiles
 * @desc    Query all allocated profiles
 * @access  Private (Admin only)
 */
router.get('/profiles', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    
    const result = await esimClient.queryAllAllocatedProfiles();
    
    // Filter by status if provided
    let profiles = result.profiles || [];
    if (status) {
      profiles = profiles.filter(p => p.status === status);
    }

    // Paginate
    const startIndex = (page - 1) * limit;
    const paginatedProfiles = profiles.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: paginatedProfiles,
      pagination: {
        total: profiles.length,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(profiles.length / limit)
      }
    });
  } catch (error) {
    logger.error('Query profiles error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to query profiles',
      message: error.message
    });
  }
});

/**
 * @route   POST /esim/profiles/:profileId/cancel
 * @desc    Cancel a specific profile
 * @access  Private (Admin only)
 */
router.post('/profiles/:profileId/cancel', 
  authenticateToken, 
  authorize(['admin']), 
  validateProfileId,
  async (req, res) => {
    try {
      const { profileId } = req.params;
      const { reason } = req.body;

      const result = await esimClient.cancelProfile({ profileId, reason });

      // Update database
      await supabaseAdmin
        .from('esims')
        .update({ 
          status: 'CANCELLED',
          deactivated_at: new Date(),
          deactivation_reason: reason || 'Cancelled by admin',
          updated_at: new Date()
        })
        .eq('id', profileId);

      logger.info(`Profile ${profileId} cancelled by admin ${req.user.id}`);

      res.json({
        success: true,
        message: 'Profile cancelled successfully',
        data: result
      });
    } catch (error) {
      logger.error('Cancel profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to cancel profile',
        message: error.message
      });
    }
});

/**
 * @route   POST /esim/profiles/:profileId/suspend
 * @desc    Suspend a specific profile
 * @access  Private (Admin only)
 */
router.post('/profiles/:profileId/suspend', 
  authenticateToken, 
  authorize(['admin']), 
  validateProfileId,
  async (req, res) => {
    try {
      const { profileId } = req.params;
      const { reason } = req.body;

      const result = await esimClient.suspendProfile({ profileId, reason });

      await supabaseAdmin
        .from('esims')
        .update({ 
          status: 'SUSPENDED',
          metadata: { suspension_reason: reason },
          updated_at: new Date()
        })
        .eq('id', profileId);

      res.json({
        success: true,
        message: 'Profile suspended successfully',
        data: result
      });
    } catch (error) {
      logger.error('Suspend profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to suspend profile',
        message: error.message
      });
    }
});

/**
 * @route   POST /esim/profiles/:profileId/unsuspend
 * @desc    Unsuspend a specific profile
 * @access  Private (Admin only)
 */
router.post('/profiles/:profileId/unsuspend', 
  authenticateToken, 
  authorize(['admin']), 
  validateProfileId,
  async (req, res) => {
    try {
      const { profileId } = req.params;

      const result = await esimClient.unsuspendProfile({ profileId });

      await supabaseAdmin
        .from('esims')
        .update({ 
          status: 'ACTIVE',
          metadata: { suspension_reason: null },
          updated_at: new Date()
        })
        .eq('id', profileId);

      res.json({
        success: true,
        message: 'Profile unsuspended successfully',
        data: result
      });
    } catch (error) {
      logger.error('Unsuspend profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unsuspend profile',
        message: error.message
      });
    }
});

/**
 * @route   POST /esim/profiles/:profileId/revoke
 * @desc    Revoke a specific profile
 * @access  Private (Admin only)
 */
router.post('/profiles/:profileId/revoke', 
  authenticateToken, 
  authorize(['admin']), 
  validateProfileId,
  async (req, res) => {
    try {
      const { profileId } = req.params;
      const { reason } = req.body;

      const result = await esimClient.revokeProfile({ profileId, reason });

      await supabaseAdmin
        .from('esims')
        .update({ 
          status: 'REVOKED',
          deactivated_at: new Date(),
          deactivation_reason: reason || 'Revoked by admin',
          updated_at: new Date()
        })
        .eq('id', profileId);

      res.json({
        success: true,
        message: 'Profile revoked successfully',
        data: result
      });
    } catch (error) {
      logger.error('Revoke profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke profile',
        message: error.message
      });
    }
});

/**
 * @route   GET /esim/balance
 * @desc    Query account balance
 * @access  Private (Admin only)
 */
router.get('/balance', authenticateToken, authorize(['admin']), async (req, res) => {
  try {
    const balance = await esimClient.balanceQuery();

    // Store balance in database for history
    await supabaseAdmin
      .from('balance_history')
      .insert([{
        balance: balance.amount,
        currency: balance.currency,
        metadata: balance,
        created_at: new Date()
      }]);

    res.json({
      success: true,
      data: balance
    });
  } catch (error) {
    logger.error('Balance query error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to query balance',
      message: error.message
    });
  }
});

/**
 * @route   POST /esim/topup
 * @desc    Top up account balance
 * @access  Private (Admin only)
 */
router.post('/topup', 
  authenticateToken, 
  authorize(['admin']), 
  validateTopUp,
  async (req, res) => {
    try {
      const { amount, paymentMethod } = req.body;

      const result = await esimClient.topUp({ amount, paymentMethod });

      logger.info(`Account topped up by admin ${req.user.id}: ${amount}`);

      res.json({
        success: true,
        message: 'Top up successful',
        data: result
      });
    } catch (error) {
      logger.error('Top up error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to top up',
        message: error.message
      });
    }
});

/**
 * @route   POST /esim/webhook/set
 * @desc    Set webhook URL for receiving events
 * @access  Private (Admin only)
 */
router.post('/webhook/set', 
  authenticateToken, 
  authorize(['admin']), 
  validateWebhook,
  async (req, res) => {
    try {
      const { url, events } = req.body;

      const result = await esimClient.setWebhook({ url, events });

      // Store webhook configuration
      await supabaseAdmin
        .from('webhook_configs')
        .upsert([{
          url,
          events: events || ['*'],
          updated_at: new Date()
        }]);

      res.json({
        success: true,
        message: 'Webhook configured successfully',
        data: result
      });
    } catch (error) {
      logger.error('Set webhook error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to set webhook',
        message: error.message
      });
    }
});

/**
 * @route   POST /esim/sms/send
 * @desc    Send SMS to a phone number
 * @access  Private (Admin only)
 */
router.post('/sms/send', 
  authenticateToken, 
  authorize(['admin']), 
  validateSms,
  async (req, res) => {
    try {
      const { phoneNumber, message } = req.body;

      const result = await esimClient.sendSMS({ phoneNumber, message });

      logger.info(`SMS sent to ${phoneNumber} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: 'SMS sent successfully',
        data: result
      });
    } catch (error) {
      logger.error('Send SMS error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send SMS',
        message: error.message
      });
    }
});

/**
 * @route   GET /esim/usage/:iccid
 * @desc    Check data usage for a specific eSIM
 * @access  Private
 */
router.get('/usage/:iccid', authenticateToken, validateIccid, async (req, res) => {
  try {
    const { iccid } = req.params;

    // Verify user owns this eSIM or is admin
    const { data: esim } = await supabaseAdmin
      .from('esims')
      .select('user_id')
      .eq('iccid', iccid)
      .single();

    if (!esim) {
      return res.status(404).json({
        success: false,
        error: 'eSIM not found'
      });
    }

    if (esim.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to view this eSIM'
      });
    }

    const usage = await esimClient.usageCheck({ iccid });

    // Update usage in database
    await supabaseAdmin
      .from('esims')
      .update({
        metadata: { ...esim.metadata, last_usage: usage },
        updated_at: new Date()
      })
      .eq('iccid', iccid);

    res.json({
      success: true,
      data: usage
    });
  } catch (error) {
    logger.error('Usage check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check usage',
      message: error.message
    });
  }
});

/**
 * @route   GET /esim/regions/supported
 * @desc    Get supported regions
 * @access  Private
 */
router.get('/regions/supported', authenticateToken, async (req, res) => {
  try {
    const regions = await esimClient.getSupportedRegions();

    res.json({
      success: true,
      data: regions
    });
  } catch (error) {
    logger.error('Get supported regions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get supported regions',
      message: error.message
    });
  }
});

/**
 * @route   GET /esim/status/:esimId
 * @desc    Get eSIM status from database
 * @access  Private
 */
router.get('/status/:esimId', authenticateToken, async (req, res) => {
  try {
    const { esimId } = req.params;

    const { data: esim, error } = await supabaseAdmin
      .from('esims')
      .select(`
        id,
        order_id,
        user_id,
        iccid,
        status,
        activation_code,
        qr_code,
        profile,
        activated_at,
        expires_at,
        created_at,
        updated_at
      `)
      .eq('id', esimId)
      .single();

    if (error || !esim) {
      return res.status(404).json({
        success: false,
        error: 'eSIM not found'
      });
    }

    // Verify ownership
    if (esim.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to view this eSIM'
      });
    }

    res.json({
      success: true,
      data: esim
    });
  } catch (error) {
    logger.error('Get eSIM status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get eSIM status'
    });
  }
});

/**
 * @route   GET /esim/install-guide/:esimId
 * @desc    Get installation guide for an eSIM
 * @access  Private
 */
router.get('/install-guide/:esimId', authenticateToken, async (req, res) => {
  try {
    const { esimId } = req.params;

    const { data: esim, error } = await supabaseAdmin
      .from('esims')
      .select('*')
      .eq('id', esimId)
      .single();

    if (error || !esim) {
      return res.status(404).json({
        success: false,
        error: 'eSIM not found'
      });
    }

    if (esim.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    // Generate installation guide based on device type
    const guides = {
      ios: {
        steps: [
          'Go to Settings > Cellular',
          'Tap "Add Cellular Plan"',
          'Scan the QR code',
          'Label your plan',
          'Complete installation'
        ],
        video: 'https://youtu.be/example-ios'
      },
      android: {
        steps: [
          'Go to Settings > Network & Internet',
          'Tap "Add eSIM"',
          'Scan QR code',
          'Follow prompts',
          'Activate plan'
        ],
        video: 'https://youtu.be/example-android'
      }
    };

    res.json({
      success: true,
      data: {
        esimId: esim.id,
        qrCode: esim.qr_code,
        activationCode: esim.activation_code,
        smdp: esim.profile?.smdp,
        guides,
        instructions: `To install your eSIM, scan the QR code or manually enter the activation code.`
      }
    });
  } catch (error) {
    logger.error('Get install guide error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get installation guide'
    });
  }
});

/**
 * @route   GET /esim/history
 * @desc    Get user's eSIM purchase history
 * @access  Private
 */
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const { data: esims, error, count } = await supabaseAdmin
      .from('esims')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: esims,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get eSIM history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get eSIM history'
    });
  }
});

export default router;