import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';

class WooCommerceService {
  constructor() {
    this.api = new WooCommerceRestApi.default({
      url: process.env.WORDPRESS_URL,
      consumerKey: process.env.WC_CONSUMER_KEY,
      consumerSecret: process.env.WC_CONSUMER_SECRET,
      version: 'wc/v3',
      queryStringAuth: true
    });
  }

  async getOrder(orderId) {
    const { data } = await this.api.get(`orders/${orderId}`);
    return data;
  }

  async createOrderNote(orderId, note, customerNote = true) {
    await this.api.post(`orders/${orderId}/notes`, { note, customer_note: customerNote });
  }

  async updateOrderMeta(orderId, metaData) {
    const meta_data = Object.entries(metaData).map(([key, value]) => ({
      key: `_esim_${key}`,
      value
    }));
    await this.api.put(`orders/${orderId}`, { meta_data });
  }
}

export default new WooCommerceService();