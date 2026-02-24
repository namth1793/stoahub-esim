import { supabaseAdmin } from '../config/supabaseClient.js';
import { generateId, logger } from '../utils/helpers.js';

// Helper function to generate QR code
const generateQRCode = (esimId) => {
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=esim:${esimId}`;
};

// Helper function to generate activation code
const generateActivationCode = () => {
  return Math.random().toString(36).substring(2, 15).toUpperCase() +
         Math.random().toString(36).substring(2, 15).toUpperCase();
};

// Activate eSIM
export const activateEsim = async (req, res) => {
  try {
    const {
      orderId,
      productId,
      iccid,
      customerEmail,
      customerName,
      deviceInfo
    } = req.body;

    // Validation
    if (!orderId || !productId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderId and productId'
      });
    }

    // Check if order exists and belongs to user
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', req.user.id)
      .single();

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found or does not belong to you'
      });
    }

    // Check if eSIM already activated for this order
    const { data: existingEsim } = await supabaseAdmin
      .from('esims')
      .select('id')
      .eq('order_id', orderId)
      .single();

    if (existingEsim) {
      return res.status(409).json({
        success: false,
        error: 'eSIM already activated for this order',
        esimId: existingEsim.id
      });
    }

    // Generate eSIM ID
    const esimId = `ESIM-${generateId()}`;
    const activationCode = generateActivationCode();
    const qrCode = generateQRCode(esimId);

    // eSIM profile data
    const profile = {
      smdp: `smdp.esim-provider.com/${esimId}`,
      confirmationCode: activationCode.substring(0, 8),
      matchingId: activationCode.substring(8, 16),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      dataLimit: '10GB',
      coverage: ['Vietnam', 'International'],
      networkProviders: ['Viettel', 'Vinaphone', 'Mobifone']
    };

    // Insert eSIM record
    const { data: esim, error } = await supabaseAdmin
      .from('esims')
      .insert([
        {
          id: esimId,
          order_id: orderId,
          user_id: req.user.id,
          product_id: productId,
          iccid: iccid || `8901${Math.random().toString().slice(2, 18)}`,
          activation_code: activationCode,
          status: 'PENDING_ACTIVATION',
          customer_email: customerEmail || req.user.email,
          customer_name: customerName || req.user.fullName,
          qr_code: qrCode,
          profile: profile,
          device_info: deviceInfo || null,
          activation_attempts: 0,
          metadata: {
            ip_address: req.ip,
            user_agent: req.headers['user-agent']
          },
          created_at: new Date(),
          updated_at: new Date()
        }
      ])
      .select()
      .single();

    if (error) throw error;

    // Log activation attempt
    await supabaseAdmin
      .from('esim_activation_logs')
      .insert([
        {
          esim_id: esimId,
          action: 'INITIATED',
          user_id: req.user.id,
          metadata: {
            timestamp: new Date().toISOString()
          }
        }
      ]);

    logger.info(`eSIM activation initiated: ${esimId} for order: ${orderId}`);

    // Simulate async activation (in production, this would call eSIM provider API)
    setTimeout(async () => {
      try {
        const { error: updateError } = await supabaseAdmin
          .from('esims')
          .update({
            status: 'ACTIVE',
            activated_at: new Date(),
            updated_at: new Date()
          })
          .eq('id', esimId);

        if (!updateError) {
          await supabaseAdmin
            .from('esim_activation_logs')
            .insert([
              {
                esim_id: esimId,
                action: 'ACTIVATED',
                user_id: req.user.id,
                metadata: { timestamp: new Date().toISOString() }
              }
            ]);
          
          logger.info(`eSIM activated successfully: ${esimId}`);
        }
      } catch (err) {
        logger.error(`Failed to activate eSIM ${esimId}:`, err);
      }
    }, 5000);

    res.status(202).json({
      success: true,
      message: 'eSIM activation in progress',
      data: {
        esimId: esim.id,
        status: esim.status,
        iccid: esim.iccid,
        qrCode: esim.qr_code,
        activationCode: esim.activation_code,
        profile: esim.profile,
        estimatedTime: '5-10 minutes',
        instructions: {
          ios: 'Go to Settings > Cellular > Add Cellular Plan',
          android: 'Go to Settings > Network & Internet > Add eSIM'
        }
      }
    });

  } catch (error) {
    logger.error('Activate eSIM error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate eSIM activation',
      message: error.message
    });
  }
};

// Get eSIM status
export const getEsimStatus = async (req, res) => {
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
        device_info,
        activated_at,
        created_at,
        updated_at,
        orders!inner(user_id)
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

    // Get activation logs
    const { data: logs } = await supabaseAdmin
      .from('esim_activation_logs')
      .select('action, created_at, metadata')
      .eq('esim_id', esimId)
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({
      success: true,
      data: {
        id: esim.id,
        orderId: esim.order_id,
        iccid: esim.iccid,
        status: esim.status,
        activationCode: esim.activation_code,
        qrCode: esim.qr_code,
        profile: esim.profile,
        deviceInfo: esim.device_info,
        activatedAt: esim.activated_at,
        createdAt: esim.created_at,
        updatedAt: esim.updated_at,
        logs: logs || []
      }
    });

  } catch (error) {
    logger.error('Get eSIM status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get eSIM status'
    });
  }
};

// Get installation guide
export const getInstallationGuide = async (req, res) => {
  try {
    const { esimId } = req.params;

    const { data: esim, error } = await supabaseAdmin
      .from('esims')
      .select('id, status, qr_code, profile, device_info')
      .eq('id', esimId)
      .single();

    if (error || !esim) {
      return res.status(404).json({
        success: false,
        error: 'eSIM not found'
      });
    }

    // Installation guides for different platforms
    const guides = {
      ios: {
        title: '📱 Install eSIM on iOS',
        steps: [
          'Connect to Wi-Fi',
          'Go to **Settings** > **Cellular** (or Mobile Data)',
          'Tap **Add Cellular Plan**',
          'Scan the QR code below',
          'Label your plan (e.g., "Travel eSIM")',
          'Tap **Continue** and follow on-screen instructions',
          'Set as default or secondary line as needed'
        ],
        videoUrl: 'https://youtu.be/example-ios',
        troubleshooting: [
          'Restart your iPhone if plan doesn\'t appear',
          'Ensure iOS is updated to latest version',
          'Check if your iPhone supports eSIM (XR and newer)'
        ]
      },
      android: {
        title: '🤖 Install eSIM on Android',
        steps: [
          'Connect to Wi-Fi',
          'Go to **Settings** > **Network & Internet**',
          'Tap **+** or **Add** next to Mobile Network',
          'Select **Download a SIM instead**',
          'Choose **Scan QR code**',
          'Scan the QR code below',
          'Follow on-screen instructions to complete setup'
        ],
        videoUrl: 'https://youtu.be/example-android',
        troubleshooting: [
          'Restart your device if plan doesn\'t appear',
          'Ensure your device supports eSIM (Pixel 3+, Samsung S20+)',
          'Check for carrier updates in settings'
        ]
      },
      manual: {
        title: '🔧 Manual Installation',
        steps: [
          'Open your device settings',
          'Navigate to Mobile Network settings',
          'Choose **Add eSIM** or **Add Cellular Plan**',
          'Select **Enter details manually**',
          `SM-DP+ Address: **${esim.profile.smdp}**`,
          `Activation Code: **${esim.profile.confirmationCode}**`,
          'Complete the setup following device prompts'
        ]
      }
    };

    res.json({
      success: true,
      data: {
        esimId: esim.id,
        status: esim.status,
        qrCode: esim.qr_code,
        profile: esim.profile,
        guides,
        support: {
          email: 'support@esim-provider.com',
          whatsapp: '+84 123 456 789',
          liveChat: 'https://tawk.to/chat/esim-provider',
          faq: 'https://esim-provider.com/faq'
        },
        tips: [
          '📶 Keep Wi-Fi on during installation',
          '🔋 Ensure battery is above 50%',
          '⚠️ Do not delete eSIM after installation',
          '🌍 eSIM activates upon reaching destination',
          '📞 Contact support if issues persist'
        ]
      }
    });

  } catch (error) {
    logger.error('Get installation guide error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get installation guide'
    });
  }
};

// Get installation details
export const getInstallationDetails = async (req, res) => {
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
        error: 'Unauthorized to view this eSIM'
      });
    }

    if (esim.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: 'eSIM is not yet active',
        currentStatus: esim.status
      });
    }

    // Detailed installation information
    const installationDetails = {
      methods: [
        {
          type: 'QR Code',
          description: 'Quick and easy - just scan!',
          data: esim.qr_code,
          instructions: 'Open device camera and scan QR code'
        },
        {
          type: 'Manual Entry',
          description: 'Enter details manually',
          data: {
            smdp: esim.profile.smdp,
            activationCode: esim.profile.confirmationCode,
            matchingId: esim.profile.matchingId
          },
          instructions: 'Enter these details in your device settings'
        },
        {
          type: 'App Installation',
          description: 'Use our mobile app',
          data: {
            appStore: 'https://apps.apple.com/app/id123456',
            playStore: 'https://play.google.com/store/apps/details?id=com.esim.app'
          },
          instructions: 'Download app and login with your account'
        }
      ],
      deviceCompatibility: {
        ios: {
          models: ['iPhone XR', 'XS', '11', '12', '13', '14', '15'],
          required: 'iOS 12.1 or later',
          note: 'Dual SIM works with physical SIM + eSIM'
        },
        android: {
          models: ['Google Pixel 3+', 'Samsung S20+', 'S21+', 'S22+', 'S23+', 'Fold series'],
          required: 'Android 10 or later',
          note: 'Check manufacturer specifications for eSIM support'
        }
      },
      planDetails: {
        data: esim.profile.dataLimit,
        coverage: esim.profile.coverage,
        validUntil: esim.profile.validUntil,
        networks: esim.profile.networkProviders
      },
      activationStatus: {
        status: esim.status,
        activatedAt: esim.activated_at,
        iccid: esim.iccid
      }
    };

    res.json({
      success: true,
      data: installationDetails
    });

  } catch (error) {
    logger.error('Get installation details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get installation details'
    });
  }
};

// Deactivate eSIM
export const deactivateEsim = async (req, res) => {
  try {
    const { esimId } = req.params;
    const { reason } = req.body;

    const { data: esim, error: findError } = await supabaseAdmin
      .from('esims')
      .select('*')
      .eq('id', esimId)
      .single();

    if (findError || !esim) {
      return res.status(404).json({
        success: false,
        error: 'eSIM not found'
      });
    }

    if (esim.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to deactivate this eSIM'
      });
    }

    if (esim.status === 'DEACTIVATED') {
      return res.status(400).json({
        success: false,
        error: 'eSIM is already deactivated'
      });
    }

    // In production: Call eSIM provider API to deactivate
    // This is a simulation

    const { error: updateError } = await supabaseAdmin
      .from('esims')
      .update({
        status: 'DEACTIVATED',
        deactivated_at: new Date(),
        deactivation_reason: reason || 'User requested',
        updated_at: new Date()
      })
      .eq('id', esimId);

    if (updateError) throw updateError;

    // Log deactivation
    await supabaseAdmin
      .from('esim_activation_logs')
      .insert([
        {
          esim_id: esimId,
          action: 'DEACTIVATED',
          user_id: req.user.id,
          metadata: {
            reason: reason || 'User requested',
            timestamp: new Date().toISOString()
          }
        }
      ]);

    logger.info(`eSIM deactivated: ${esimId} by user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'eSIM deactivated successfully',
      data: {
        esimId: esim.id,
        status: 'DEACTIVATED',
        deactivatedAt: new Date()
      }
    });

  } catch (error) {
    logger.error('Deactivate eSIM error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate eSIM'
    });
  }
};

// Get eSIM history
export const getEsimHistory = async (req, res) => {
  try {
    const { data: esims, error } = await supabaseAdmin
      .from('esims')
      .select(`
        id,
        order_id,
        iccid,
        status,
        profile,
        activated_at,
        created_at,
        deactivated_at,
        orders!inner(user_id)
      `)
      .eq('orders.user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: esims.map(esim => ({
        id: esim.id,
        orderId: esim.order_id,
        iccid: esim.iccid,
        status: esim.status,
        dataLimit: esim.profile?.dataLimit,
        validUntil: esim.profile?.validUntil,
        activatedAt: esim.activated_at,
        createdAt: esim.created_at,
        deactivatedAt: esim.deactivated_at
      }))
    });

  } catch (error) {
    logger.error('Get eSIM history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get eSIM history'
    });
  }
};