import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { supabaseAdmin } from '../config/supabaseClient.js';
import { logger } from '../utils/helpers.js';

// Initialize WooCommerce API
const WooCommerce = new WooCommerceRestApi.default({
  url: process.env.WORDPRESS_URL,
  consumerKey: process.env.WC_CONSUMER_KEY,
  consumerSecret: process.env.WC_CONSUMER_SECRET,
  version: 'wc/v3',
  queryStringAuth: true,
  timeout: 30000
});

// Get products with filters
export const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      per_page = 10,
      search,
      category,
      min_price,
      max_price,
      orderby = 'date',
      order = 'desc',
      status = 'publish'
    } = req.query;

    const params = {
      page: parseInt(page),
      per_page: parseInt(per_page),
      orderby,
      order,
      status
    };

    if (search) params.search = search;
    if (category) params.category = category;
    if (min_price) params.min_price = min_price;
    if (max_price) params.max_price = max_price;

    const response = await WooCommerce.get('products', params);
    
    // Cache products in Supabase for faster access
    try {
      await supabaseAdmin
        .from('products_cache')
        .upsert(
          response.data.map(product => ({
            id: product.id,
            data: product,
            updated_at: new Date()
          })),
          { onConflict: 'id' }
        );
    } catch (cacheError) {
      logger.warn('Failed to cache products:', cacheError);
    }

    res.json({
      success: true,
      data: {
        products: response.data,
        pagination: {
          total: parseInt(response.headers['x-wp-total']),
          totalPages: parseInt(response.headers['x-wp-totalpages']),
          currentPage: parseInt(page),
          perPage: parseInt(per_page)
        }
      }
    });

  } catch (error) {
    logger.error('Get products error:', error.response?.data || error.message);
    
    // Try to get from cache if API fails
    try {
      const { data: cached } = await supabaseAdmin
        .from('products_cache')
        .select('data')
        .order('updated_at', { ascending: false })
        .limit(10);

      if (cached && cached.length > 0) {
        return res.json({
          success: true,
          data: {
            products: cached.map(c => c.data),
            fromCache: true
          }
        });
      }
    } catch (cacheError) {
      logger.error('Cache retrieval failed:', cacheError);
    }

    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch products',
      details: error.response?.data || error.message
    });
  }
};

// Get single product
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const response = await WooCommerce.get(`products/${id}`);
    
    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logger.error('Get product error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch product',
      details: error.response?.data || error.message
    });
  }
};

// Get product variations
export const getProductVariations = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, per_page = 10 } = req.query;

    const response = await WooCommerce.get(`products/${id}/variations`, {
      page: parseInt(page),
      per_page: parseInt(per_page)
    });

    res.json({
      success: true,
      data: {
        variations: response.data,
        pagination: {
          total: parseInt(response.headers['x-wp-total']),
          totalPages: parseInt(response.headers['x-wp-totalpages']),
          currentPage: parseInt(page)
        }
      }
    });

  } catch (error) {
    logger.error('Get variations error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch variations',
      details: error.response?.data || error.message
    });
  }
};

// Get orders for authenticated user
export const getOrders = async (req, res) => {
  try {
    const {
      page = 1,
      per_page = 10,
      status
    } = req.query;

    // First, get user's email from Supabase
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', req.user.id)
      .single();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const params = {
      page: parseInt(page),
      per_page: parseInt(per_page),
      customer: user.email
    };

    if (status) params.status = status;

    const response = await WooCommerce.get('orders', params);

    res.json({
      success: true,
      data: {
        orders: response.data,
        pagination: {
          total: parseInt(response.headers['x-wp-total']),
          totalPages: parseInt(response.headers['x-wp-totalpages']),
          currentPage: parseInt(page)
        }
      }
    });

  } catch (error) {
    logger.error('Get orders error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch orders',
      details: error.response?.data || error.message
    });
  }
};

// Get single order
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await WooCommerce.get(`orders/${id}`);

    // Verify order belongs to user
    if (response.data.billing?.email !== req.user.email) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to view this order'
      });
    }

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logger.error('Get order error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch order',
      details: error.response?.data || error.message
    });
  }
};

// Create order
export const createOrder = async (req, res) => {
  try {
    const orderData = {
      ...req.body,
      customer_note: `Order placed via eSIM App by user: ${req.user.id}`
    };

    const response = await WooCommerce.post('orders', orderData);

    // Store order in Supabase for tracking
    await supabaseAdmin
      .from('orders')
      .insert([
        {
          id: response.data.id.toString(),
          user_id: req.user.id,
          order_data: response.data,
          status: response.data.status,
          created_at: new Date()
        }
      ]);

    logger.info(`Order created: ${response.data.id} by user: ${req.user.id}`);

    res.status(201).json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logger.error('Create order error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to create order',
      details: error.response?.data || error.message
    });
  }
};

// Update order
export const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify order ownership
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('user_id')
      .eq('id', id)
      .single();

    if (existingOrder && existingOrder.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to update this order'
      });
    }

    const response = await WooCommerce.put(`orders/${id}`, req.body);

    // Update in Supabase
    await supabaseAdmin
      .from('orders')
      .update({
        order_data: response.data,
        status: response.data.status,
        updated_at: new Date()
      })
      .eq('id', id);

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logger.error('Update order error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to update order',
      details: error.response?.data || error.message
    });
  }
};