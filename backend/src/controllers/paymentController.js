import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/supabaseClient.js';
import { generateId, logger } from '../utils/helpers.js';

// Initialize Amazon Pay session
export const initAmazonPay = async (req, res) => {
  try {
    const { orderId, amount, currency = 'USD', returnUrl } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderId and amount'
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
    }

    // Check if payment already exists
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id, status')
      .eq('order_id', orderId)
      .single();

    if (existingPayment) {
      return res.status(409).json({
        success: false,
        error: 'Payment already initiated for this order',
        paymentId: existingPayment.id,
        status: existingPayment.status
      });
    }

    // Generate unique checkout session ID
    const checkoutSessionId = `CS-${uuidv4().replace(/-/g, '').toUpperCase()}`;
    const paymentId = generateId('pay');

    // Store payment record in Supabase
    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert([
        {
          id: paymentId,
          order_id: orderId,
          user_id: req.user.id,
          amount,
          currency,
          status: 'PENDING',
          checkout_session_id: checkoutSessionId,
          metadata: {
            initiated_at: new Date().toISOString(),
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

    // In production: Call actual Amazon Pay API
    // This is a simulation for development
    const amazonPayPayload = {
      merchantId: process.env.AMAZON_PAY_MERCHANT_ID,
      checkoutSessionId,
      chargeAmount: {
        amount: amount.toString(),
        currencyCode: currency
      },
      returnUrl: returnUrl || process.env.AMAZON_PAY_RETURN_URL,
      paymentDetails: {
        paymentIntent: 'Confirm',
        canHandlePendingAuthorization: true
      }
    };

    logger.info(`Payment initiated: ${paymentId} for order: ${orderId}`);

    res.json({
      success: true,
      data: {
        paymentId: payment.id,
        checkoutSessionId,
        status: payment.status,
        amazonPayPayload,
        redirectUrl: `https://payments.amazon.com/checkout/${checkoutSessionId}`,
        expiresIn: 3600 // 1 hour
      }
    });

  } catch (error) {
    logger.error('Init Amazon Pay error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize payment',
      message: error.message
    });
  }
};

// Amazon Pay callback
export const amazonPayCallback = async (req, res) => {
  try {
    const {
      checkoutSessionId,
      amazonPaymentId,
      status,
      amount,
      chargeId,
      signature
    } = req.body;

    if (!checkoutSessionId || !amazonPaymentId || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required callback parameters'
      });
    }

    // Find payment session
    const { data: payment, error: findError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('checkout_session_id', checkoutSessionId)
      .single();

    if (findError || !payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment session not found'
      });
    }

    // Verify amount matches
    if (parseFloat(amount) !== parseFloat(payment.amount)) {
      logger.warn(`Amount mismatch for payment ${payment.id}: expected ${payment.amount}, got ${amount}`);
      return res.status(400).json({
        success: false,
        error: 'Amount mismatch'
      });
    }

    // In production: Verify signature with Amazon Pay
    // const isValid = verifyAmazonPaySignature(signature, payment);

    // Update payment status
    const { data: updatedPayment, error: updateError } = await supabaseAdmin
      .from('payments')
      .update({
        amazon_payment_id: amazonPaymentId,
        status: status === 'Success' ? 'COMPLETED' : 'FAILED',
        charge_id: chargeId,
        metadata: {
          ...payment.metadata,
          callback_received_at: new Date().toISOString(),
          callback_status: status
        },
        updated_at: new Date()
      })
      .eq('id', payment.id)
      .select()
      .single();

    if (updateError) throw updateError;

    // If payment successful, update order status in WooCommerce
    if (status === 'Success') {
      // In production: Call WooCommerce API to update order
      logger.info(`Payment completed for order: ${payment.order_id}`);
      
      // Store in completed payments table
      await supabaseAdmin
        .from('completed_payments')
        .insert([
          {
            payment_id: payment.id,
            order_id: payment.order_id,
            amazon_payment_id: amazonPaymentId,
            amount: payment.amount,
            completed_at: new Date()
          }
        ]);
    }

    res.json({
      success: true,
      message: `Payment ${status === 'Success' ? 'completed' : 'failed'}`,
      data: {
        paymentId: updatedPayment.id,
        orderId: updatedPayment.order_id,
        status: updatedPayment.status,
        amazonPaymentId: updatedPayment.amazon_payment_id
      }
    });

  } catch (error) {
    logger.error('Amazon Pay callback error:', error);
    res.status(500).json({
      success: false,
      error: 'Callback processing failed',
      message: error.message
    });
  }
};

// Get payment status
export const getPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .select(`
        id,
        order_id,
        amount,
        currency,
        status,
        amazon_payment_id,
        checkout_session_id,
        metadata,
        created_at,
        updated_at
      `)
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found for this order'
      });
    }

    // Verify user owns this order
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('user_id')
      .eq('id', orderId)
      .single();

    if (order && order.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to view this payment'
      });
    }

    res.json({
      success: true,
      data: {
        paymentId: payment.id,
        orderId: payment.order_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        amazonPaymentId: payment.amazon_payment_id,
        checkoutSessionId: payment.checkout_session_id,
        metadata: payment.metadata,
        createdAt: payment.created_at,
        updatedAt: payment.updated_at
      }
    });

  } catch (error) {
    logger.error('Get payment status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payment status'
    });
  }
};

// Process refund
export const refundPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, reason } = req.body;

    // Find payment
    const { data: payment, error: findError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .eq('status', 'COMPLETED')
      .single();

    if (findError || !payment) {
      return res.status(404).json({
        success: false,
        error: 'No completed payment found for this order'
      });
    }

    // Verify user owns this payment
    if (payment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to refund this payment'
      });
    }

    // Validate refund amount
    const refundAmount = amount || payment.amount;
    if (refundAmount > payment.amount) {
      return res.status(400).json({
        success: false,
        error: 'Refund amount cannot exceed payment amount'
      });
    }

    // In production: Call Amazon Pay API to process refund
    const refundId = `REF-${uuidv4().replace(/-/g, '').toUpperCase()}`;

    // Update payment status
    const { error: updateError } = await supabaseAdmin
      .from('payments')
      .update({
        status: refundAmount === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        refund_id: refundId,
        refund_amount: refundAmount,
        refund_reason: reason,
        metadata: {
          ...payment.metadata,
          refunded_at: new Date().toISOString(),
          refund_amount: refundAmount,
          refund_reason: reason
        },
        updated_at: new Date()
      })
      .eq('id', payment.id);

    if (updateError) throw updateError;

    // Store refund record
    await supabaseAdmin
      .from('refunds')
      .insert([
        {
          id: refundId,
          payment_id: payment.id,
          order_id: orderId,
          amount: refundAmount,
          reason,
          status: 'COMPLETED',
          created_at: new Date()
        }
      ]);

    logger.info(`Refund processed: ${refundId} for payment: ${payment.id}`);

    res.json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        refundId,
        paymentId: payment.id,
        orderId,
        amount: refundAmount,
        status: 'COMPLETED'
      }
    });

  } catch (error) {
    logger.error('Refund payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process refund'
    });
  }
};