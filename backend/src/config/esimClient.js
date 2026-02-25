import dotenv from 'dotenv';

dotenv.config();

class ESIMClient {
  constructor() {
    this.accessCode = process.env.ESIM_ACCESS_CODE;
    this.secretKey = process.env.ESIM_SECRET_KEY;
    this.baseUrl = process.env.ESIM_API_BASE_URL || 'https://api.esimaccess.com';
  }

  // Tạo headers xác thực cho mỗi request
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'AccessCode': this.accessCode,
      'SecretKey': this.secretKey
    };
  }

  // Helper function để gọi API
  async request(endpoint, data = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST', // Theo ảnh của bạn, các API đều là POST
        headers: this.getHeaders(),
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`ESIM API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('ESIM API request failed:', error);
      throw error;
    }
  }

  // Các method tương ứng với API trong ảnh
  // params: { type: 'BASE'|'TOPUP', slug, locationCode, packageCode }
  async getAllDataPackages(params = {}) {
    return this.request('/api/v1/open/package/list', params);
  }

  async orderProfiles(orderData) {
    return this.request('/OrderProfiles', orderData);
  }

  async queryAllAllocatedProfiles() {
    return this.request('/QueryAllAllocatedProfiles');
  }

  async cancelProfile(profileId) {
    return this.request('/CancelProfile', { profileId });
  }

  async suspendProfile(profileId) {
    return this.request('/SuspendProfile', { profileId });
  }

  async unsuspendProfile(profileId) {
    return this.request('/UnsuspendProfile', { profileId });
  }

  async revokeProfile(profileId) {
    return this.request('/RevokeProfile', { profileId });
  }

  async balanceQuery() {
    return this.request('/BalanceQuery');
  }

  async topUp(amount) {
    return this.request('/TopUp', { amount });
  }

  async setWebhook(webhookUrl) {
    return this.request('/SetWebhook', { webhookUrl });
  }

  async sendSMS(phoneNumber, message) {
    return this.request('/SendSMS', { phoneNumber, message });
  }

  async usageCheck(iccid) {
    return this.request('/UsageCheck', { iccid });
  }

  async getSupportedRegions() {
    return this.request('/SupportedRegions');
  }
}

// Export singleton instance
export default new ESIMClient();