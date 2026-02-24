import { sleep } from '../utils/delay.js';
import esimService from './esimService.js';
import woocommerceService from './woocommerceService.js';

class ProvisioningService {
  async provisionEsim({ orderId, sku, quantity = 1 }) {
    console.log(`🚀 Provisioning eSIM for order ${orderId}`);

    try {
      // 1. Check balance
      const balance = await esimService.getAccountBalance();
      if (balance.balance < 10) {
        throw new Error(`Insufficient balance: $${balance.balance}`);
      }

      // 2. Order eSIM
      const esimOrder = await esimService.orderProfile({
        transactionId: orderId.toString(),
        sku,
        quantity
      });

      // 3. Wait for provisioning
      await sleep(5000);

      // 4. Get eSIM details
      const esimDetails = await this.pollEsimStatus(esimOrder.orderNumber);

      // 5. Update WooCommerce
      const note = this.formatEsimNote(esimDetails);
      await woocommerceService.createOrderNote(orderId, note, true);
      
      await woocommerceService.updateOrderMeta(orderId, {
        iccid: esimDetails.iccid,
        qr_code: esimDetails.qrCode,
        activation_link: esimDetails.activationLink,
        status: 'provisioned'
      });

      console.log(`✅ eSIM provisioned for order ${orderId}`);
      return esimDetails;

    } catch (error) {
      console.error(`❌ Provisioning failed:`, error.message);
      await woocommerceService.createOrderNote(
        orderId,
        `❌ eSIM provisioning failed: ${error.message}`,
        true
      );
      throw error;
    }
  }

  async pollEsimStatus(orderNumber, maxRetries = 10) {
    for (let i = 1; i <= maxRetries; i++) {
      try {
        const result = await esimService.getEsimByOrderNumber(orderNumber);
        if (result.iccid) return result;
      } catch (error) {
        if (i === maxRetries) throw error;
      }
      await sleep(3000 * Math.pow(2, i));
    }
  }

  formatEsimNote(esim) {
    return `
🔰 Your eSIM is ready!
📱 ICCID: ${esim.iccid}
🔗 Activation: ${esim.activationLink}
📸 QR: ${esim.qrCode}
    `;
  }
}

export default new ProvisioningService();