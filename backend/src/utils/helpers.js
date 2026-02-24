import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';

// Logger configuration
export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Generate unique ID
export const generateId = (prefix = '') => {
  const id = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
  return prefix ? `${prefix}-${id}` : id;
};

// Format response
export const formatResponse = (success, data, message = '') => {
  return {
    success,
    data,
    message,
    timestamp: new Date().toISOString()
  };
};

// Handle async errors
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Validate email
export const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// Validate phone (Vietnam format)
export const isValidPhone = (phone) => {
  const re = /^(0|84)(2(0[3-9]|1[0-689]|2[0-25-9]|3[2-9]|4[0-9]|5[124-9]|6[0-39]|7[0-7]|8[0-9]|9[0-46-9]))([0-9]{7})$/;
  return re.test(phone);
};