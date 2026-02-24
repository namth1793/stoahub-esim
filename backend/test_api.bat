@echo off
setlocal enabledelayedexpansion

:: =====================================================
:: ESIM API TEST - Hiển thị trực tiếp trên terminal
:: =====================================================

set API_URL=http://localhost:5000
set EMAIL=test%RANDOM%@example.com
set PASSWORD=123456
set FULLNAME=Test User
set PHONE=0901234567

:: ====================================================
echo [SECTION 1] 📝 AUTHENTICATION TESTS
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 1. REGISTER
:: -----------------------------------------------------------------
echo [TEST 1] Registering new user: %EMAIL%
echo.

curl -X POST %API_URL%/auth/register ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"%EMAIL%\",\"password\":\"%PASSWORD%\",\"fullName\":\"%FULLNAME%\",\"phone\":\"%PHONE%\"}"

echo.
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 2. LOGIN
:: -----------------------------------------------------------------
echo [TEST 2] Logging in with: %EMAIL%
echo.

curl -X POST %API_URL%/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"%EMAIL%\",\"password\":\"%PASSWORD%\"}"

echo.
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 3. GET PACKAGES
:: -----------------------------------------------------------------
echo [TEST 3] Fetching all eSIM packages
echo.

curl -X GET %API_URL%/esim/packages

echo.
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 4. GET PACKAGES WITH FILTER
:: -----------------------------------------------------------------
echo [TEST 4] Fetching packages filtered by region=asia
echo.

curl -X GET "%API_URL%/esim/packages?region=asia&type=data"

echo.
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 5. GET SUPPORTED REGIONS
:: -----------------------------------------------------------------
echo [TEST 5] Getting supported regions
echo.

curl -X GET %API_URL%/esim/regions/supported

echo.
echo ====================================================
echo.

:: ====================================================
echo [SECTION 2] 🔗 PUBLIC ENDPOINTS
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 6. HEALTH CHECK
:: -----------------------------------------------------------------
echo [TEST 6] Health check
echo.

curl -X GET %API_URL%/health

echo.
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 7. TEST ENDPOINT
:: -----------------------------------------------------------------
echo [TEST 7] Test endpoint
echo.

curl -X GET %API_URL%/test

echo.
echo ====================================================
echo.

:: ====================================================
echo [SECTION 3] 📱 WEBHOOK TEST
echo ====================================================
echo.

:: -----------------------------------------------------------------
:: 8. WEBHOOK
:: -----------------------------------------------------------------
echo [TEST 8] Simulating webhook from provider
echo.

curl -X POST %API_URL%/esim/webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"event\":\"profile.activated\",\"iccid\":\"89011234567890\",\"profileId\":\"ESIM-TEST-123\",\"activationTime\":\"%date% %time%\"}"

echo.
echo ====================================================
echo.

:: ====================================================
echo [SECTION 4] 🔐 NEED TOKEN TESTS
echo ====================================================
echo.
echo ⚠️  Các test tiếp theo cần token từ login
echo ⚠️  Copy token từ TEST 2 và chạy file riêng
echo.

:: -----------------------------------------------------------------
:: Hướng dẫn test với token
:: -----------------------------------------------------------------
echo ====================================================
echo 📌 HƯỚNG DẪN TEST VỚI TOKEN:
echo ====================================================
echo.
echo 1. Copy token từ kết quả TEST 2 (login)
echo 2. Chạy các lệnh sau với token thật:
echo.
echo GET CURRENT USER:
echo curl -X GET %API_URL%/auth/me -H "Authorization: Bearer YOUR_TOKEN_HERE"
echo.
echo ORDER ESIM:
echo curl -X POST %API_URL%/esim/order -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN_HERE" -d "{\"packageId\":\"PKG-VIETNAM-5GB\",\"quantity\":1}"
echo.
echo CHECK ESIM STATUS:
echo curl -X GET %API_URL%/esim/status/ESIM-ID-HERE -H "Authorization: Bearer YOUR_TOKEN_HERE"
echo.
echo INSTALLATION GUIDE:
echo curl -X GET %API_URL%/esim/install-guide/ESIM-ID-HERE -H "Authorization: Bearer YOUR_TOKEN_HERE"
echo.
echo CHECK USAGE:
echo curl -X GET %API_URL%/esim/usage/89011234567890 -H "Authorization: Bearer YOUR_TOKEN_HERE"
echo.
echo PURCHASE HISTORY:
echo curl -X GET %API_URL%/esim/history -H "Authorization: Bearer YOUR_TOKEN_HERE"
echo.
echo INIT PAYMENT:
echo curl -X POST %API_URL%/payment/amazon-pay/init -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN_HERE" -d "{\"orderId\":\"ORD-123\",\"amount\":29.99,\"currency\":\"USD\"}"
echo.
echo ====================================================
echo.

pause