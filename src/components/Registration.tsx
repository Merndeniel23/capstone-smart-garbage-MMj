import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleLogin } from '@react-oauth/google';
import {
  User, 
  Mail, 
  Lock, 
  Phone, 
  MapPin, 
  ChevronDown, 
  Eye, 
  EyeOff, 
  ShieldAlert, 
  Leaf, 
  CheckCircle,
  HelpCircle,
  Loader2
} from 'lucide-react';

interface RegistrationBarangay {
  id: number;
  name: string;
}

interface RegistrationPurok {
  id: number;
  barangay_id: number;
  name: string;
  barangay_name?: string;
}

export default function Registration() {
  
  // Tab state: 'login' | 'register'
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  
  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Registration fields
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regBarangayId, setRegBarangayId] = useState('');
  const [regPurokId, setRegPurokId] = useState('');
  const [registrationBarangays, setRegistrationBarangays] = useState<RegistrationBarangay[]>([]);
  const [registrationPuroks, setRegistrationPuroks] = useState<RegistrationPurok[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [registrationVerificationEmail, setRegistrationVerificationEmail] = useState('');
  const [registrationOtp, setRegistrationOtp] = useState('');
  const [registrationVerificationStep, setRegistrationVerificationStep] = useState(false);
  const [registrationVerificationLoading, setRegistrationVerificationLoading] = useState(false);
  const [registrationResendCountdown, setRegistrationResendCountdown] = useState(0);
  
  const [error, setError] = useState('');
const [successMessage, setSuccessMessage] = useState('');

const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
const [showForgotModal, setShowForgotModal] = useState(false);

const [forgotStep, setForgotStep] = useState<'email' | 'reset'>('email');
const [forgotOtp, setForgotOtp] = useState('');
const [newPassword, setNewPassword] = useState('');
const [confirmNewPassword, setConfirmNewPassword] = useState('');

const [forgotLoading, setForgotLoading] = useState(false);
const [resetLoading, setResetLoading] = useState(false);
const [resendCountdown, setResendCountdown] = useState(0);

  const filteredRegistrationPuroks = useMemo(() => {
    const barangayId = Number(regBarangayId);

    if (!barangayId) {
      return [];
    }

    return registrationPuroks.filter(
      (purok) => purok.barangay_id === barangayId,
    );
  }, [registrationPuroks, regBarangayId]);

  useEffect(() => {
    let cancelled = false;

    const loadRegistrationLocations = async () => {
      setLocationsLoading(true);

      try {
        const response = await fetch('/api/auth/registration-locations');
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.message || 'Unable to load barangays and puroks.',
          );
        }

        if (!cancelled) {
          setRegistrationBarangays(
            Array.isArray(data.barangays) ? data.barangays : [],
          );
          setRegistrationPuroks(
            Array.isArray(data.puroks) ? data.puroks : [],
          );
        }
      } catch (err) {
        console.error('Registration locations error:', err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load barangays and puroks.',
          );
        }
      } finally {
        if (!cancelled) {
          setLocationsLoading(false);
        }
      }
    };

    loadRegistrationLocations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setResendCountdown((current) =>
        current > 0 ? current - 1 : 0,
      );
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [resendCountdown]);

  useEffect(() => {
    if (registrationResendCountdown <= 0) return;

    const timer = window.setInterval(() => {
      setRegistrationResendCountdown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [registrationResendCountdown]);

  const resetForgotPasswordState = () => {
    setShowForgotModal(false);
    setForgotStep('email');
    setForgotPasswordEmail('');
    setForgotOtp('');
    setNewPassword('');
    setConfirmNewPassword('');
    setForgotLoading(false);
    setResetLoading(false);
    setResendCountdown(0);
    setError('');
    setSuccessMessage('');
  };

  const validateEmail = (emailStr: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);
  };

  const normalizePhone = (phone: string) =>
    phone.trim().replace(/[\s()-]/g, '');

  const validatePhilippinePhone = (phone: string) =>
    /^(?:09\d{9}|\+639\d{9})$/.test(normalizePhone(phone));

 const completeLogin = (data: any, remember: boolean) => {
  const backendRole = String(data?.user?.role || "resident");

  const appRole =
    backendRole === "super_admin"
      ? "super_admin"
      : backendRole === "admin"
        ? "admin"
        : backendRole === "purok_leader"
          ? "leader"
          : backendRole === "collector"
            ? "collector"
            : "household";

  const needsResidentSetup =
    appRole === "household" &&
    Boolean(data?.needsLocationSetup);

  const needsResidentApproval =
    appRole === "household" &&
    Boolean(data?.needsApproval);

  const currentScreen =
    needsResidentSetup || needsResidentApproval
      ? "profile"
      : appRole === "super_admin"
        ? "super-admin-dashboard"
        : appRole === "admin"
          ? "admin-dashboard"
          : appRole === "collector"
            ? "collector-tasks"
            : appRole === "leader"
              ? "leader-dashboard"
              : "dashboard";

  const appUser = {
    id: data.user.id,
    name: data.user.full_name,
    email: data.user.email,
    phone: data.user.phone || "",
    communalZone: [data.user.purok_name, data.user.barangay_name]
      .filter(Boolean)
      .join(", "),
    role: appRole,
    address: data.user.address || "",
    householdId:
      appRole === "super_admin"
        ? `SUP-${data.user.id}`
        : appRole === "admin"
        ? `ADM-${data.user.id}`
        : appRole === "leader"
        ? `LDR-${data.user.id}`
        : appRole === "collector"
        ? `COL-${data.user.id}`
        : `HH-${data.user.id}`,
    profilePhoto: data.user.profile_photo || null,
  };

  const storage = remember ? localStorage : sessionStorage;
  const otherStorage = remember ? sessionStorage : localStorage;
  const authKeys = [
    "token",
    "authToken",
    "sg_current_user",
    "sg_is_logged_in",
    "sg_user_role",
    "sg_current_screen",
    "sg_requires_location_setup",
    "sg_pending_approval",
    "sg_temp_login_email",
  ];

  for (const key of authKeys) {
    otherStorage.removeItem(key);
    storage.removeItem(key);
  }

  storage.setItem("token", data.token);
  storage.setItem(
    "sg_current_user",
    JSON.stringify(appUser)
  );

  storage.setItem("sg_is_logged_in", "true");
  storage.setItem("sg_user_role", appRole);
  storage.setItem("sg_current_screen", currentScreen);

  if (needsResidentSetup) {
    storage.setItem(
      "sg_requires_location_setup",
      "true",
    );
  }

  if (needsResidentApproval) {
    storage.setItem(
      "sg_pending_approval",
      "true",
    );
  }

  if (data.mustChangePassword === true) {
    storage.setItem(
      "sg_current_screen",
      "change-initial-password"
    );
    storage.setItem(
      "sg_temp_login_email",
      data.user.email
    );
  }

  window.location.reload();
};

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError('');
    setSuccessMessage('');

    if (!loginEmail.trim() || !loginPassword) {
      setError('Please fill in all credentials.');
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: loginEmail.trim().toLowerCase(),
          password: loginPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Login failed.');
        return;
      }

      setSuccessMessage('Login successful! Entering dashboard...');

      window.setTimeout(() => {
        completeLogin(data, rememberMe);
      }, 300);
    } catch (error) {
      console.error('Login error:', error);
      setError('Cannot connect to the server.');
    }
  };
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (
      !regFullName.trim() ||
      !regEmail.trim() ||
      !regPhone.trim() ||
      !regBarangayId ||
      !regPurokId ||
      !regPassword ||
      !regConfirmPassword
    ) {
      setError('Please fill in all registration fields.');
      return;
    }

    if (!validateEmail(regEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!validatePhilippinePhone(regPhone)) {
      setError('Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
      return;
    }

    if (
      regPassword.length < 8 ||
      regPassword.length > 72 ||
      !/[A-Z]/.test(regPassword) ||
      !/[a-z]/.test(regPassword) ||
      !/\d/.test(regPassword)
    ) {
      setError('Password must be 8-72 characters with uppercase, lowercase, and a number.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      const barangay = registrationBarangays.find(
        (item) => item.id === Number(regBarangayId),
      );
      const purok = registrationPuroks.find(
        (item) => item.id === Number(regPurokId),
      );

      if (!barangay || !purok || purok.barangay_id !== barangay.id) {
        setError('Please select a valid barangay and purok.');
        return;
      }

      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: regFullName.trim(),
          email: regEmail.trim().toLowerCase(),
          password: regPassword,
          purokId: purok.id,
          phone: regPhone.trim(),
          address: `${purok.name}, ${barangay.name}`, 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Registration failed.');
        return;
      }

      setRegistrationVerificationEmail(data.email || regEmail.trim().toLowerCase());
      setRegistrationOtp('');
      setRegistrationVerificationStep(true);
      setRegistrationResendCountdown(60);
      setSuccessMessage('Verification code sent. Check your email to activate the account.');

      setRegFullName('');
      setRegEmail('');
      setRegPhone('');
      setRegBarangayId('');
      setRegPurokId('');
      setRegPassword('');
      setRegConfirmPassword('');

    } catch (error) {
      console.error('Registration error:', error);
      setError('Cannot connect to the server.');
    }
  };

  const handleRegistrationVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    const email = registrationVerificationEmail.trim().toLowerCase();
    const otp = registrationOtp.trim();

    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code sent to your email.');
      return;
    }

    setRegistrationVerificationLoading(true);

    try {
      const response = await fetch('/api/auth/verify-registration-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || 'Email verification failed.');
        return;
      }

      setSuccessMessage('Email verified. You can now sign in.');
      setRegistrationVerificationStep(false);
      setRegistrationVerificationEmail('');
      setRegistrationOtp('');
      setActiveTab('login');
      setLoginEmail(email);
    } catch (err) {
      console.error('Registration email verification error:', err);
      setError('Cannot connect to the server.');
    } finally {
      setRegistrationVerificationLoading(false);
    }
  };

  const resendRegistrationVerification = async () => {
    if (registrationResendCountdown > 0 || !registrationVerificationEmail) return;

    setError('');
    setSuccessMessage('');
    setRegistrationVerificationLoading(true);

    try {
      const response = await fetch('/api/auth/resend-registration-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: registrationVerificationEmail }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || 'Unable to resend the verification code.');
        return;
      }

      setRegistrationResendCountdown(60);
      setSuccessMessage(data.message || 'A new verification code was sent.');
    } catch (err) {
      console.error('Resend registration email error:', err);
      setError('Cannot connect to the server.');
    } finally {
      setRegistrationVerificationLoading(false);
    }
  };
const sendForgotPasswordOtp = async () => {
  setError('');
  setSuccessMessage('');

  const email = forgotPasswordEmail.trim().toLowerCase();

  if (!email) {
    setError('Please enter your email.');
    return false;
  }

  if (!validateEmail(email)) {
    setError('Please enter a valid email address.');
    return false;
  }

  setForgotLoading(true);

  try {
    const response = await fetch(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      },
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      setError(
        data.message || 'Unable to send OTP.',
      );
      return false;
    }

    setSuccessMessage(
      data.message ||
        'If the account exists, an OTP has been sent.',
    );

    setForgotStep('reset');
    setResendCountdown(60);
    return true;
  } catch (err) {
    console.error(err);
    setError('Cannot connect to the server.');
    return false;
  } finally {
    setForgotLoading(false);
  }
};

const handleForgotPasswordSubmit = async (
  e: React.FormEvent,
) => {
  e.preventDefault();
  await sendForgotPasswordOtp();
};

const handleResendOtp = async () => {
  if (forgotLoading || resendCountdown > 0) {
    return;
  }

  await sendForgotPasswordOtp();
};

const handleResetPasswordSubmit = async (
  e: React.FormEvent,
) => {
  e.preventDefault();

  setError('');
  setSuccessMessage('');

  const normalizedEmail =
    forgotPasswordEmail.trim().toLowerCase();

  if (!/^\d{6}$/.test(forgotOtp.trim())) {
    setError('Please enter a valid 6-digit OTP.');
    return;
  }

  if (!newPassword || !confirmNewPassword) {
    setError(
      'Please fill in both password fields.',
    );
    return;
  }

  if (
    newPassword.length < 8 ||
    newPassword.length > 72 ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/\d/.test(newPassword)
  ) {
    setError(
      'New password must be 8-72 characters with uppercase, lowercase, and a number.',
    );
    return;
  }

  if (newPassword !== confirmNewPassword) {
    setError('New passwords do not match.');
    return;
  }

  setResetLoading(true);

  try {
    const response = await fetch(
      '/api/auth/reset-password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          otp: forgotOtp.trim(),
          newPassword,
        }),
      },
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      setError(
        data.message ||
          'Unable to reset password.',
      );
      return;
    }

    setLoginEmail(normalizedEmail);
    setForgotOtp('');
    setNewPassword('');
    setConfirmNewPassword('');

    setSuccessMessage(
      data.message ||
        'Password changed successfully. You may now sign in.',
    );

    window.setTimeout(() => {
      resetForgotPasswordState();
      setActiveTab('login');
      setSuccessMessage(
        'Password changed successfully. You may now sign in.',
      );
    }, 1200);
  } catch (err) {
    console.error(err);
    setError('Cannot connect to the server.');
  } finally {
    setResetLoading(false);
  }
};

  return (
    <div className="auth-page auth-shell auth-entry-page relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-[#FAFBF9] px-4 font-sans text-stone-900 sm:px-6 lg:px-8">
      {/* Absolute top decoration */}
      <div className="absolute top-0 inset-x-0 h-2 bg-emerald-700" />
      
      {/* Decorative blurred spots */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[15%] left-[10%] w-[350px] h-[350px] bg-emerald-700/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-[15%] right-[10%] w-[350px] h-[350px] bg-emerald-700/5 rounded-full blur-[100px]" />
      </div>

      <div className="auth-container z-10 w-full max-w-[30rem]">
        {/* APP LOGO & HEADER */}
        <div className="auth-brand flex flex-col items-center gap-3 text-center">
          <div className="auth-logo w-14 h-14 bg-emerald-700 rounded-2xl flex items-center justify-center shadow-md shadow-emerald-700/20">
            <Leaf className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-stone-850 tracking-tight leading-none uppercase">
              Smart Garbage
            </h1>
            <p className="auth-accent mt-1 text-[10px] font-extrabold uppercase tracking-[0.25em] text-emerald-700">
              Monitoring System
            </p>
          </div>
        </div>

        {/* MAIN AUTH CONTAINER */}
        <div className="auth-card overflow-hidden rounded-3xl border border-stone-200/60 bg-white p-6 shadow-xl transition-all sm:p-8">
          
          {/* TAB SEGMENT */}
          <div className="auth-tabs flex border-b border-stone-100 pb-5 mb-6">
            <button
              type="button"
              onClick={() => { setActiveTab('login'); setRegistrationVerificationStep(false); setError(''); setSuccessMessage(''); }}
              className={`auth-tab relative flex-1 pb-2 text-center text-xs font-extrabold uppercase tracking-wider transition-all ${
                activeTab === 'login' ? 'auth-accent text-emerald-700' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              Sign In
              {activeTab === 'login' && (
                <motion.div layoutId="authUnderline" className="auth-active-underline absolute bottom-0 inset-x-0 h-0.5 bg-emerald-700" />
              )}
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('register'); setError(''); setSuccessMessage(''); }}
              className={`auth-tab relative flex-1 pb-2 text-center text-xs font-extrabold uppercase tracking-wider transition-all ${
                activeTab === 'register' ? 'auth-accent text-emerald-700' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              Create Account
              {activeTab === 'register' && (
                <motion.div layoutId="authUnderline" className="auth-active-underline absolute bottom-0 inset-x-0 h-0.5 bg-emerald-700" />
              )}
            </button>
          </div>

          {/* STATUS NOTIFICATIONS */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-5 p-3.5 bg-rose-50 border border-rose-200/50 text-rose-700 rounded-xl text-xs flex items-start gap-2.5"
              >
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="font-semibold">{error}</span>
              </motion.div>
            )}

            {successMessage && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-5 p-3.5 bg-emerald-50 border border-emerald-200/50 text-emerald-800 rounded-xl text-xs flex items-start gap-2.5"
              >
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="font-semibold">{successMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* FORMS */}
          {activeTab === 'login' ? (
            /* LOGIN SCREEN */
            <form onSubmit={handleLoginSubmit} className="auth-form auth-form--login">
              <div className="auth-field">
                <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                  Email or Household ID
                </label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    required
                    maxLength={150}
                    placeholder="enter email or household ID"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-3 pl-11 pr-4 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                  />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                  Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter account password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-3 pl-11 pr-11 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 p-1 text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="auth-actions auth-login-actions pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 text-emerald-750 border-stone-300 rounded focus:ring-emerald-700/20 accent-emerald-700"
                  />
                  <span className="text-[11px] font-semibold text-stone-500">Remember Me</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotModal(true);
                    setForgotStep('email');
                    setForgotPasswordEmail(
                      loginEmail.trim().toLowerCase(),
                    );
                    setForgotOtp('');
                    setNewPassword('');
                    setConfirmNewPassword('');
                    setResendCountdown(0);
                    setError('');
                    setSuccessMessage('');
                  }}
                  className="auth-accent cursor-pointer text-[11px] font-bold text-emerald-700 hover:underline"
                >
                  Forgot Password?
                </button>
              </div>

             <>
  <button
    type="submit"
    className="auth-primary-action mt-1 w-full cursor-pointer rounded-2xl border-none bg-emerald-700 py-3 text-[10px] font-extrabold uppercase tracking-widest text-white shadow-lg shadow-emerald-800/10 transition-all hover:bg-emerald-800 active:scale-[0.98]"
  >
    Authenticate & Enter Console
  </button>

  <div className="auth-divider flex items-center">
    <div className="flex-1 border-t border-gray-300"></div>
    <span className="px-3 text-xs text-gray-500 font-semibold">OR</span>
    <div className="flex-1 border-t border-gray-300"></div>
  </div>

  <div className="auth-google">
    <GoogleLogin
      onSuccess={async (credentialResponse) => {
        setError('');
        setSuccessMessage('');

        if (!credentialResponse.credential) {
          setError('Google did not return a valid credential.');
          return;
        }

        try {
          const response = await fetch('/api/auth/google', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              credential: credentialResponse.credential,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            setError(data.message || 'Google login failed.');
            return;
          }

          setSuccessMessage('Google login successful!');

          window.setTimeout(() => {
            completeLogin(data, rememberMe);
          }, 300);
        } catch (err) {
          console.error(err);
          setError('Unable to connect to the server.');
        }
      }}
      onError={() => {
        setError('Google Sign-In failed.');
      }}
    />
  </div>
</>
            </form>
          ) : (
            /* REGISTRATION SCREEN */
            registrationVerificationStep ? (
              <form onSubmit={handleRegistrationVerification} className="auth-form">
                <div className="text-center space-y-2">
                  <Mail className="auth-accent mx-auto h-10 w-10 text-emerald-700" />
                  <h2 className="text-sm font-extrabold text-stone-800">Verify your email</h2>
                  <p className="text-xs text-stone-500">
                    Enter the 6-digit code sent to <strong>{registrationVerificationEmail}</strong>.
                  </p>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={registrationOtp}
                  onChange={(e) => setRegistrationOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit code"
                  className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-3 text-center font-bold tracking-[0.4em] text-stone-800"
                />
                <button
                  type="submit"
                  disabled={registrationVerificationLoading}
                  className="auth-primary-action w-full rounded-2xl bg-emerald-700 py-3 text-[10px] font-extrabold uppercase tracking-widest text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {registrationVerificationLoading ? 'Verifying...' : 'Verify Email'}
                </button>
                <div className="auth-actions auth-login-actions text-[11px]">
                  <button
                    type="button"
                    disabled={registrationVerificationLoading || registrationResendCountdown > 0}
                    onClick={resendRegistrationVerification}
                    className="auth-accent text-emerald-700 font-bold disabled:text-stone-400"
                  >
                    {registrationResendCountdown > 0 ? `Resend in ${registrationResendCountdown}s` : 'Resend code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRegistrationVerificationStep(false);
                      setRegistrationVerificationEmail('');
                      setRegistrationOtp('');
                      setError('');
                      setSuccessMessage('');
                    }}
                    className="text-stone-500 font-bold hover:text-stone-700"
                  >
                    Start over
                  </button>
                </div>
              </form>
            ) : (
            <form onSubmit={handleRegisterSubmit} className="auth-form auth-form--register">
              <fieldset className="auth-form-section">
                <legend className="auth-form-section-title">Contact details</legend>
                <div className="auth-form-grid">
              <div className="auth-field">
                <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                  Full Name
                </label>
                <div className="relative flex items-center">
                  <User className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    required
                    maxLength={150}
                    placeholder="Enter full name"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-2.5 pl-11 pr-4 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                  />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                  Email Address
                </label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="email"
                    required
                    maxLength={150}
                    placeholder="Enter email address"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-2.5 pl-11 pr-4 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                  />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                  Mobile Number
                </label>
                <div className="relative flex items-center">
                  <Phone className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    required
                    maxLength={17}
                    placeholder="Enter phone number "
                    value={regPhone}
                    onChange={(e) =>
                      setRegPhone(
                        e.target.value.replace(/[^0-9+\s()-]/g, ''),
                      )
                    }
                    className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-2.5 pl-11 pr-4 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                  />
                </div>
              </div>

                </div>
              </fieldset>

              <fieldset className="auth-form-section">
                <legend className="auth-form-section-title">Service area and account security</legend>
                <p className="auth-form-section-intro text-[11px] font-semibold leading-relaxed text-stone-400">
                  Choose the barangay and purok where this household receives service.
                </p>
                <div className="auth-form-grid">

              <div className="auth-field">
                <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                  Assigned Communal Zone (Barangay & Purok)
                </label>
                <div className="auth-form-grid">
                  <div className="relative flex items-center">
                    <MapPin className="absolute left-4 w-4 h-4 text-stone-400" />
                    <select
                      value={regBarangayId}
                      onChange={(e) => {
                        setRegBarangayId(e.target.value);
                        setRegPurokId('');
                      }}
                      disabled={locationsLoading}
                      required
                      className="auth-input w-full cursor-pointer appearance-none rounded-2xl border border-stone-200 bg-[#FAFBF9] py-2.5 pl-11 pr-10 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">
                        {locationsLoading ? 'Loading...' : 'Select barangay'}
                      </option>
                      {registrationBarangays.map((bgy) => (
                        <option key={bgy.id} value={bgy.id}>
                          {bgy.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 w-4 h-4 text-stone-400 pointer-events-none" />
                  </div>

                  <div className="relative flex items-center">
                    <MapPin className="absolute left-4 w-4 h-4 text-stone-400" />
                    <select
                      value={regPurokId}
                      onChange={(e) => setRegPurokId(e.target.value)}
                      disabled={!regBarangayId || locationsLoading}
                      required
                      className="auth-input w-full cursor-pointer appearance-none rounded-2xl border border-stone-200 bg-[#FAFBF9] py-2.5 pl-11 pr-10 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">
                        {!regBarangayId ? 'Select barangay first' : 'Select purok'}
                      </option>
                      {filteredRegistrationPuroks.map((purok) => (
                        <option key={purok.id} value={purok.id}>
                          {purok.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 w-4 h-4 text-stone-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="auth-form-grid">
                <div className="auth-field">
                  <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                    Password
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      maxLength={72}
                      placeholder="8+ chars, upper/lower/number"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-2.5 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                    Confirm Password
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      maxLength={72}
                      placeholder="Confirm"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-2.5 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[10px] font-bold text-stone-500 hover:text-stone-700 flex items-center gap-1"
                >
                  {showPassword ? 'Hide Passwords' : 'Show Passwords'}
                </button>
              </div>

                </div>
              </fieldset>

              <button
                type="submit"
                className="auth-primary-action mt-1 w-full cursor-pointer rounded-2xl border-none bg-emerald-700 py-3 text-[10px] font-extrabold uppercase tracking-widest text-white shadow-lg shadow-emerald-800/10 transition-all hover:bg-emerald-800 active:scale-[0.98]"
              >
                Register & Join Network
              </button>
            </form>
            )
          )}

          {/* TOGGLE BOTTOM LINK */}
          <div className="auth-switch mt-6 border-t border-stone-100 pt-5 text-center">
            {activeTab === 'login' ? (
              <p className="text-[11px] text-stone-500 font-semibold">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setActiveTab('register'); setRegistrationVerificationStep(false); setError(''); setSuccessMessage(''); }}
                  className="auth-accent text-emerald-700 font-bold hover:underline"
                >
                  Register here
                </button>
              </p>
            ) : (
              <p className="text-[11px] text-stone-500 font-semibold">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setActiveTab('login'); setRegistrationVerificationStep(false); setError(''); setSuccessMessage(''); }}
                  className="auth-accent text-emerald-700 font-bold hover:underline"
                >
                  Sign In
                </button>
              </p>
            )}
          </div>
        </div>



        {/* FOOTER */}
        <p className="auth-footer text-center text-[9px] font-extrabold uppercase tracking-widest text-stone-400">
          Barangay Environmental Sinks System • MMJ group • 2026 • All Rights Reserved
        </p>
      </div>

      {/* FORGOT PASSWORD MODAL */}
      {showForgotModal && (
        <div className="auth-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
          <div className="auth-modal-card w-full max-w-md space-y-5 rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
                <HelpCircle className="w-5 h-5" />
              </span>
              <h3 className="text-sm font-black text-stone-800 uppercase tracking-tight">
                {forgotStep === 'email' ? 'Forgot Password?' : 'Enter OTP & New Password'}
              </h3>
            </div>

            <p className="text-[11px] text-stone-500 leading-relaxed font-medium">
              {forgotStep === 'email'
                ? 'Enter your registered email address. We will send a six-digit OTP to your email.'
                : `Enter the OTP sent to ${forgotPasswordEmail} and choose your new password.`}
            </p>

            {forgotStep === 'email' ? (
              <form onSubmit={handleForgotPasswordSubmit} className="auth-form">
                <input
                  type="email"
                  required
                  placeholder="Enter your email address"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-3 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                />

                <div className="auth-modal-actions">
                  <button
                    type="button"
                    onClick={resetForgotPasswordState}
                    className="auth-secondary-action flex-1 rounded-xl border border-stone-200 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-stone-500 transition-colors hover:bg-stone-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="auth-primary-action flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-none bg-emerald-700 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {forgotLoading && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {forgotLoading ? 'Sending...' : 'Send OTP'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleResetPasswordSubmit} className="auth-form">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="Enter 6-digit OTP"
                  value={forgotOtp}
                  onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-3 text-center text-sm font-bold tracking-[0.35em] text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                />

                <div className="auth-actions auth-login-actions px-1">
                  <span className="text-[10px] font-semibold text-stone-500">
                    OTP expires after 10 minutes.
                  </span>

                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={
                      forgotLoading ||
                      resendCountdown > 0
                    }
                    className="auth-accent text-[10px] font-extrabold text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline"
                  >
                    {forgotLoading
                      ? 'Sending...'
                      : resendCountdown > 0
                        ? `Resend in ${resendCountdown}s`
                        : 'Resend OTP'}
                  </button>
                </div>

                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  maxLength={72}
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-3 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                />

                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  maxLength={72}
                  placeholder="Confirm new password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-3 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[10px] font-bold text-stone-500 hover:text-stone-700"
                >
                  {showPassword ? 'Hide passwords' : 'Show passwords'}
                </button>

                <div className="auth-modal-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotStep('email');
                      setForgotOtp('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      setResendCountdown(0);
                      setError('');
                      setSuccessMessage('');
                    }}
                    className="auth-secondary-action flex-1 rounded-xl border border-stone-200 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-stone-500 transition-colors hover:bg-stone-50"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="auth-primary-action flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-none bg-emerald-700 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resetLoading && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {resetLoading
                      ? 'Updating...'
                      : 'Change Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
