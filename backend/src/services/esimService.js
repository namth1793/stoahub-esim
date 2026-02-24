import esimClient from '../config/esimClient.js';

class ESIMService {
  async getAccountBalance() {
    const data = await esimClient.request('/account/balance', {}, 'GET');
    return { balance: data.balance, currency: data.currency };
  }

  async orderProfile({ transactionId, sku, quantity }) {
    const data = await esimClient.request('/orders', {
      transaction_id: transactionId,
      sku,
      quantity
    });
    return { orderNumber: data.order_number };
  }

  async getEsimByOrderNumber(orderNumber) {
    const data = await esimClient.request(`/esims?order_number=${orderNumber}`, {}, 'GET');
    const esim = data.data;
    return {
      iccid: esim.iccid,
      qrCode: esim.qr_code_url,
      activationLink: esim.activation_link,
      status: esim.status
    };
  }
}

export default new ESIMService();