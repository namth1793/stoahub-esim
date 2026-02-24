@echo off
setlocal

:: ====================================================
:: TEST VỚI TOKEN - PASTE TOKEN CỦA BẠN VÀO ĐÂY
:: ====================================================
set TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMGU3ZGM2LTBiYWYtNGMxMC1hYTk3LWNlMDJhMTk4YzNlZCIsImVtYWlsIjoidGVzdDI2MjI4QGV4YW1wbGUuY29tIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3NzEzNTM2NjIsImV4cCI6MTc3MTk1ODQ2Mn0.YaI9figf5pG-P-_EXXUFfcuZo8BM5YxKYul-DdIHRkc
set API_URL=http://localhost:5000

echo ====================================================
echo TESTING WITH TOKEN
echo ====================================================
echo.

:: 1. GET CURRENT USER
echo [1] Getting current user...
echo.
curl -X GET %API_URL%/auth/me -H "Authorization: Bearer %TOKEN%"
echo.
echo ====================================================
echo.

:: 2. ORDER ESIM
echo [2] Placing eSIM order...
echo.
curl -X POST %API_URL%/esim/order ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer %TOKEN%" ^
  -d "{\"packageId\":\"PKG-VIETNAM-5GB\",\"quantity\":1}"
echo.
echo ====================================================
echo.

:: 3. GET HISTORY
echo [3] Getting purchase history...
echo.
curl -X GET %API_URL%/esim/history -H "Authorization: Bearer %TOKEN%"
echo.
echo ====================================================
echo.

:: 4. INIT PAYMENT
echo [4] Initializing payment...
echo.
curl -X POST %API_URL%/payment/amazon-pay/init ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer %TOKEN%" ^
  -d "{\"orderId\":\"ORD-123456\",\"amount\":29.99,\"currency\":\"USD\"}"
echo.
echo ====================================================
echo.

pause