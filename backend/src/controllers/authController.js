import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../config/supabaseClient.js';
import { isValidEmail, logger } from '../utils/helpers.js';

// =====================================================
// REGISTER - Đăng ký tài khoản mới (Dùng Supabase Auth)
// =====================================================
export const register = async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;

    // Validation
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['email', 'password', 'fullName']
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Check if user exists in profiles table
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Email already registered'
      });
    }

    // Tạo user trong Supabase Auth (quan trọng!)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Tự động xác thực email
      user_metadata: {
        full_name: fullName,
        phone: phone || null
      }
    });

    if (authError) {
      logger.error('Supabase Auth create error:', authError);
      
      // Xử lý lỗi cụ thể từ Supabase
      if (authError.message.includes('already registered')) {
        return res.status(409).json({
          success: false,
          error: 'Email already registered'
        });
      }
      
      throw authError;
    }

    // Profile sẽ tự động được tạo qua trigger handle_new_user
    // Nhưng chúng ta có thể update thêm thông tin nếu cần
    if (phone) {
      await supabaseAdmin
        .from('profiles')
        .update({ phone })
        .eq('id', authData.user.id);
    }

    // Generate JWT token cho ứng dụng của chúng ta
    const token = jwt.sign(
      { 
        id: authData.user.id, 
        email: authData.user.email, 
        role: 'user' 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    logger.info(`New user registered: ${email} with id: ${authData.user.id}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          fullName: fullName,
          phone: phone || null,
          role: 'user'
        }
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      message: error.message
    });
  }
};

// =====================================================
// LOGIN - Đăng nhập (Dùng Supabase Auth)
// =====================================================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Đăng nhập qua Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      logger.error('Supabase Auth login error:', authError);
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Lấy thông tin user từ profiles table
    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, phone, role, is_active, last_login')
      .eq('id', authData.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found'
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Account is disabled. Please contact support.'
      });
    }

    // Update last login
    await supabaseAdmin
      .from('profiles')
      .update({ last_login: new Date() })
      .eq('id', user.id);

    // Generate JWT token cho ứng dụng
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          phone: user.phone,
          role: user.role
        }
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      message: error.message
    });
  }
};

// =====================================================
// LOGOUT - Đăng xuất
// =====================================================
export const logout = async (req, res) => {
  try {
    // Logout with Supabase Auth
    await supabaseAdmin.auth.signOut();
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
      message: error.message
    });
  }
};

// =====================================================
// REFRESH TOKEN - Làm mới token
// =====================================================
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token required'
      });
    }

    // Refresh session với Supabase Auth
    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }

    // Generate new JWT token cho ứng dụng
    const newToken = jwt.sign(
      { 
        id: data.user.id, 
        email: data.user.email, 
        role: data.user.user_metadata?.role || 'user'
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      success: true,
      data: { 
        token: newToken,
        refresh_token: data.session.refresh_token
      }
    });

  } catch (error) {
    logger.error('Refresh token error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Refresh token expired'
      });
    }
    
    res.status(403).json({
      success: false,
      error: 'Invalid or expired refresh token',
      message: error.message
    });
  }
};

// =====================================================
// GET CURRENT USER - Lấy thông tin user hiện tại
// =====================================================
export const getCurrentUser = async (req, res) => {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, phone, role, created_at, last_login, is_active')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        isActive: user.is_active,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });

  } catch (error) {
    logger.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user information',
      message: error.message
    });
  }
};

// =====================================================
// FORGOT PASSWORD - Quên mật khẩu
// =====================================================
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Gửi email reset password qua Supabase Auth
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.CLIENT_URL}/reset-password`
    });

    if (error) {
      logger.error('Supabase reset password error:', error);
      // Vẫn trả về success để tránh email enumeration
    }

    // Always return success (security through obscurity)
    res.json({
      success: true,
      message: 'If the email exists, a reset link has been sent'
    });

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process request',
      message: error.message
    });
  }
};

// =====================================================
// RESET PASSWORD - Đặt lại mật khẩu
// =====================================================
export const resetPassword = async (req, res) => {
  try {
    const { access_token, newPassword } = req.body;

    if (!access_token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Access token and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Cập nhật password qua Supabase Auth
    const { error } = await supabaseAdmin.auth.updateUser({
      password: newPassword
    }, {
      jwt: access_token
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    logger.info(`Password reset successful`);

    res.json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password',
      message: error.message
    });
  }
};

// =====================================================
// CHANGE PASSWORD - Đổi mật khẩu (khi đã đăng nhập)
// =====================================================
export const changePassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password is required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters'
      });
    }

    // Cập nhật password qua Supabase Auth
    const { error } = await supabaseAdmin.auth.updateUser({
      password: newPassword
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    logger.info(`Password changed for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password',
      message: error.message
    });
  }
};

// =====================================================
// UPDATE PROFILE - Cập nhật thông tin profile
// =====================================================
export const updateProfile = async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    const userId = req.user.id;

    const updates = {};
    if (fullName) updates.full_name = fullName;
    if (phone) updates.phone = phone;
    updates.updated_at = new Date();

    // Cập nhật metadata trong Supabase Auth
    if (fullName) {
      await supabaseAdmin.auth.updateUser({
        data: { full_name: fullName }
      });
    }

    // Cập nhật trong profiles table
    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('id, email, full_name, phone, role')
      .single();

    if (error) throw error;

    logger.info(`Profile updated for user: ${userId}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role
      }
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      message: error.message
    });
  }
};

// =====================================================
// VERIFY EMAIL - Xác thực email
// =====================================================
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    // Xác thực email qua Supabase Auth
    const { error } = await supabaseAdmin.auth.verifyOtp({
      token_hash: token,
      type: 'email'
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.json({
      success: true,
      message: 'Email verified successfully'
    });

  } catch (error) {
    logger.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify email',
      message: error.message
    });
  }
};

// =====================================================
// DELETE ACCOUNT - Xóa tài khoản (vô hiệu hóa)
// =====================================================
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    // Soft delete - deactivate account trong profiles
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        is_active: false,
        deleted_at: new Date(),
        updated_at: new Date()
      })
      .eq('id', userId);

    if (profileError) throw profileError;

    // Vô hiệu hóa user trong Supabase Auth (admin only)
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { ban_duration: '0' } // Ban user
    );

    if (authError) {
      logger.error('Failed to ban user in Auth:', authError);
    }

    logger.info(`Account deactivated: ${userId}`);

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });

  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      message: error.message
    });
  }
};

// =====================================================
// OAUTH CALLBACK - Xử lý callback từ Google/Facebook
// =====================================================
export const oauthCallback = async (req, res) => {
  try {
    const { provider, access_token, refresh_token } = req.body;

    // Xử lý OAuth callback
    const { data, error } = await supabaseAdmin.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${process.env.CLIENT_URL}/auth/callback`
      }
    });

    if (error) throw error;

    res.json({
      success: true,
      data: {
        url: data.url
      }
    });

  } catch (error) {
    logger.error('OAuth callback error:', error);
    res.status(500).json({
      success: false,
      error: 'OAuth login failed',
      message: error.message
    });
  }
};