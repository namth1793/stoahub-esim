import provisioningService from '../services/provisioningService.js';
import woocommerceService from '../services/woocommerceService.js';

export const handleWooCommerceOrderCompleted = async (req, res) => {
  // Respond immediately
  res.status(200).json({ received: true });

  // Process in background
  (async () => {
    try {
      const { id: orderId, line_items } = req.body;
      console.log(`🔔 Processing order ${orderId}`);

      const esimItems = line_items?.filter(item => 
        item.name?.toLowerCase().includes('esim')
      ) || [];

      for (const item of esimItems) {
        await provisioningService.provisionEsim({
          orderId,
          sku: item.sku || `ESIM-${item.product_id}`,
          quantity: item.quantity
        });
      }
    } catch (error) {
      console.error('❌ Webhook error:', error.message);
    }
  })();
};

export const manuallyProvisionEsim = async (req, res) => {
  try {
    const { orderId, sku, quantity = 1 } = req.body;
    const result = await provisioningService.provisionEsim({ orderId, sku, quantity });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getProvisioningStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await woocommerceService.getOrder(orderId);
    
    const esimMeta = {};
    order.meta_data?.forEach(meta => {
      if (meta.key?.startsWith('_esim_')) {
        esimMeta[meta.key.replace('_esim_', '')] = meta.value;
      }
    });

    res.json({ success: true, data: esimMeta });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};