import { apiFetch } from "../services/http";
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleLogin } from '@react-oauth/google';
import EmailVerificationForm from './EmailVerificationForm';
import RegistrationLegalDialog from './RegistrationLegalDialog';
import {
  User, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  ShieldAlert, 
  Leaf, 
  CheckCircle,
  HelpCircle,
  Loader2
} from 'lucide-react';


export default function Registration() {
  const googleSignInEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim());
  
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
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [legalDocument, setLegalDocument] = useState<'privacy' | 'terms' | null>(null);
  const [pendingGoogleRegistration, setPendingGoogleRegistration] = useState<{
    credential: string;
    fullName: string;
    email: string;
  } | null>(null);
  // A Gmail signup sets its own password before it can enter the system.
  const [googlePassword, setGooglePassword] = useState('');
  const [googleConfirmPassword, setGoogleConfirmPassword] = useState('');
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const [registrationVerificationEmail, setRegistrationVerificationEmail] = useState('');
  const [registrationToken, setRegistrationToken] = useState('');
  const [registrationVerificationStep, setRegistrationVerificationStep] = useState(false);
  const [registrationResendCountdown, setRegistrationResendCountdown] = useState(0);
  
  const [error, setError] = useState('');
const [successMessage, setSuccessMessage] = useState('');

const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
const [showForgotModal, setShowForgotModal] = useState(false);
const [forgotError, setForgotError] = useState('');
const [forgotNotice, setForgotNotice] = useState('');
const forgotDialogRef = useRef<HTMLDialogElement>(null);
const forgotFeedbackRef = useRef<HTMLDivElement>(null);
const recoveryRequestInFlight = useRef(false);

const [forgotStep, setForgotStep] = useState<'email' | 'reset'>('email');
const [forgotOtp, setForgotOtp] = useState('');
const [newPassword, setNewPassword] = useState('');
const [confirmNewPassword, setConfirmNewPassword] = useState('');

const [forgotLoading, setForgotLoading] = useState(false);
const [resetLoading, setResetLoading] = useState(false);
const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    const dialog = forgotDialogRef.current;
    if (!showForgotModal || !dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [showForgotModal]);

  useEffect(() => {
    if (forgotError) forgotFeedbackRef.current?.scrollIntoView({ block: 'nearest' });
  }, [forgotError]);


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
    setForgotError('');
    setForgotNotice('');
    setError('');
    setSuccessMessage('');
  };

  const validateEmail = (emailStr: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);
  };

  const switchAuthTab = (tab: 'login' | 'register') => {
    setActiveTab(tab);
    setRegistrationVerificationStep(false);
    setPendingGoogleRegistration(null);
    setGooglePassword('');
    setGoogleConfirmPassword('');
    setAcceptedPolicies(false);
    setError('');
    setSuccessMessage('');
  };

  const passwordProblem = (password: string, confirmation: string) => {
    if (
      password.length < 8 ||
      password.length > 72 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      return 'Password must be 8-72 characters with uppercase, lowercase, and a number.';
    }

    return password === confirmation ? '' : 'Passwords do not match.';
  };

 

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
    status: data.user.status || "active",
    barangay: data.user.barangay_name || "",
    purok: data.user.purok_name || "",
    barangayId: data.user.barangay_id ?? null,
    purokId: data.user.purok_id ?? null,
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
      const response = await apiFetch('/api/auth/login', {
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
        if (data.requiresEmailVerification && data.email) {
          setRegistrationVerificationEmail(data.email);
          setRegistrationToken('');
          setRegistrationResendCountdown(Number(data.resendAfter) || 0);
          setRegistrationVerificationStep(true);
          setLoginPassword('');
          return;
        }
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
    if (registrationSubmitting) return;
    setError('');
    setSuccessMessage('');

    if (!acceptedPolicies) {
      setError('Please agree to the Terms and Conditions and acknowledge the Privacy Policy before registering.');
      return;
    }

    if (pendingGoogleRegistration) {
      const problem = passwordProblem(googlePassword, googleConfirmPassword);
      if (problem) {
        setError(problem);
        return;
      }
      await handleGoogleLogin(pendingGoogleRegistration.credential);
      return;
    }

    if (
      !regFullName.trim() ||
      !regEmail.trim() ||
      !regPassword ||
      !regConfirmPassword
    ) {
      setError('Please fill in your name, email, and password fields.');
      return;
    }

    if (!validateEmail(regEmail.trim())) {
      setError('Please enter a valid email address.');
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

    setRegistrationSubmitting(true);
    try {
      const response = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: regFullName.trim(),
          email: regEmail.trim().toLowerCase(),
          password: regPassword,
          acceptedPolicies,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || 'Registration failed.');
        return;
      }

      setRegistrationVerificationEmail(data.email || regEmail.trim().toLowerCase());
      setRegistrationToken(data.registrationToken || '');
      setRegistrationVerificationStep(true);
      setRegistrationResendCountdown(Number(data.resendAfter) || 60);
      setSuccessMessage(data.message || 'Check your email for the code. Your account will be created after verification.');

      setRegFullName('');
      setRegEmail('');
      setRegPassword('');
      setRegConfirmPassword('');
      setAcceptedPolicies(false);

    } catch (error) {
      console.error('Registration error:', error);
      setError('Cannot connect to the server.');
    } finally {
      setRegistrationSubmitting(false);
    }
  };

  const handleGoogleLogin = async (credential: string) => {
    if (registrationSubmitting) return;
    setError('');
    setSuccessMessage('');
    setRegistrationSubmitting(true);

    try {
      const response = await apiFetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential,
          acceptedPolicies,
          ...(pendingGoogleRegistration
            ? { password: googlePassword, confirmPassword: googleConfirmPassword }
            : {}),
        }),
      });
      const data = await response.json();

      if (data.requiresPolicyAcceptance && !pendingGoogleRegistration) {
        setPendingGoogleRegistration({
          credential,
          fullName: data.fullName || 'Google account',
          email: data.email || '',
        });
        setActiveTab('register');
        setAcceptedPolicies(false);
        setSuccessMessage(data.message || 'Review the policies before creating your Google account.');
        return;
      }

      if (data.requiresEmailVerification && data.email) {
        setRegistrationVerificationEmail(data.email);
        setRegistrationToken(data.registrationToken || '');
        setRegistrationResendCountdown(Number(data.resendAfter) || 0);
        setRegistrationVerificationStep(true);
        setPendingGoogleRegistration(null);
        setGooglePassword('');
        setGoogleConfirmPassword('');
        setAcceptedPolicies(false);
        setSuccessMessage(response.ok ? data.message || '' : '');
        return;
      }

      if (!response.ok) {
        setError(data.message || 'Google login failed.');
        return;
      }

      setSuccessMessage('Google login successful!');
      window.setTimeout(() => completeLogin(data, rememberMe), 300);
    } catch (requestError) {
      console.error('Google login error:', requestError);
      setError('Unable to connect to the server.');
    } finally {
      setRegistrationSubmitting(false);
    }
  };

const sendForgotPasswordOtp = async () => {
  if (recoveryRequestInFlight.current) return false;
  setForgotError('');
  setForgotNotice('');

  const email = forgotPasswordEmail.trim().toLowerCase();

  if (!email) {
    setForgotError('Please enter your email.');
    return false;
  }

  if (!validateEmail(email)) {
    setForgotError('Please enter a valid email address.');
    return false;
  }

  recoveryRequestInFlight.current = true;
  setForgotLoading(true);

  try {
    const response = await apiFetch(
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
      setForgotError(
        data.message || (response.status >= 500
          ? 'Password recovery is temporarily unavailable. Please try again.'
          : 'Unable to send the code. Please try again.'),
      );
      return false;
    }

    setForgotNotice(
      data.message ||
        'If the account exists, an OTP has been sent.',
    );

    setForgotStep('reset');
    setForgotOtp('');
    setResendCountdown(60);
    return true;
  } catch (err) {
    console.error(err);
    setForgotError('Cannot connect to the server. Please try again.');
    return false;
  } finally {
    recoveryRequestInFlight.current = false;
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
  if (recoveryRequestInFlight.current || resendCountdown > 0) {
    return;
  }

  await sendForgotPasswordOtp();
};

const handleResetPasswordSubmit = async (
  e: React.FormEvent,
) => {
  e.preventDefault();

  if (recoveryRequestInFlight.current) return;
  setForgotError('');
  setForgotNotice('');

  const normalizedEmail =
    forgotPasswordEmail.trim().toLowerCase();

  if (!/^\d{6}$/.test(forgotOtp.trim())) {
    setForgotError('Please enter a valid 6-digit OTP.');
    return;
  }

  if (!newPassword || !confirmNewPassword) {
    setForgotError(
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
    setForgotError(
      'New password must be 8-72 characters with uppercase, lowercase, and a number.',
    );
    return;
  }

  if (newPassword !== confirmNewPassword) {
    setForgotError('New passwords do not match.');
    return;
  }

  recoveryRequestInFlight.current = true;
  setResetLoading(true);

  try {
    const response = await apiFetch(
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
      setForgotError(
        data.message ||
          (response.status >= 500
            ? 'Password recovery is temporarily unavailable. Please try again.'
            : 'Unable to reset the password. Check the latest code and try again.'),
      );
      return;
    }

    resetForgotPasswordState();
    setActiveTab('login');
    setLoginEmail(normalizedEmail);
    setLoginPassword('');
    setShowPassword(false);
    setSuccessMessage(data.message || 'Password changed successfully. You may now sign in.');
  } catch (err) {
    console.error(err);
    setForgotError('Cannot connect to the server. Please try again.');
  } finally {
    recoveryRequestInFlight.current = false;
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
              onClick={() => switchAuthTab('login')}
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
              onClick={() => switchAuthTab('register')}
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
          {registrationVerificationStep ? (
            <EmailVerificationForm
              key={registrationVerificationEmail || 'request-code'}
              email={registrationVerificationEmail}
              registrationToken={registrationToken}
              initialResendAfter={registrationResendCountdown}
              onVerified={(email, message) => {
                setRegistrationVerificationStep(false);
                setRegistrationVerificationEmail('');
                setRegistrationToken('');
                setPendingGoogleRegistration(null);
                setAcceptedPolicies(false);
                setActiveTab('login');
                setLoginEmail(email);
                setError('');
                setSuccessMessage(message || 'Email verified. You may now sign in.');
              }}
              onBack={() => {
                setRegistrationVerificationStep(false);
                setRegistrationVerificationEmail('');
                setRegistrationToken('');
                setPendingGoogleRegistration(null);
                setAcceptedPolicies(false);
                setActiveTab('login');
                setError('');
                setSuccessMessage('');
              }}
            />
          ) : activeTab === 'login' ? (
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
                    setForgotError('');
                    setForgotNotice('');
                    setShowPassword(false);
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

  {googleSignInEnabled && (
    <>
  <div className="auth-divider flex items-center">
    <div className="flex-1 border-t border-gray-300"></div>
    <span className="px-3 text-xs text-gray-500 font-semibold">OR</span>
    <div className="flex-1 border-t border-gray-300"></div>
  </div>

  <div className="auth-google">
    <GoogleLogin
      onSuccess={(credentialResponse) => {
        if (!credentialResponse.credential) {
          setError('Google did not return a valid credential.');
          return;
        }
        void handleGoogleLogin(credentialResponse.credential);
      }}
      onError={() => {
        setError('Google Sign-In failed.');
      }}
    />
  </div>
    </>
  )}
</>
            </form>
          ) : (
            /* REGISTRATION SCREEN */
            <form onSubmit={handleRegisterSubmit} className="auth-form auth-form--register">
              {pendingGoogleRegistration ? (
                <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <h2 className="text-sm font-bold text-stone-800">Complete your Google registration</h2>
                  <p className="mt-2 text-xs font-semibold text-stone-700">{pendingGoogleRegistration.fullName}</p>
                  <p className="mt-1 break-all text-xs text-stone-500">{pendingGoogleRegistration.email}</p>
                  <p className="mt-3 text-xs leading-relaxed text-stone-600">Create your password now. You can sign in with Google or with this email and password after verifying your email.</p>
                  <fieldset className="mt-3 space-y-3" disabled={registrationSubmitting}>
                    <legend className="sr-only">Create your password</legend>
                    {[
                      { label: 'Password', value: googlePassword, onChange: setGooglePassword, placeholder: '8+ chars, upper/lower/number' },
                      { label: 'Confirm Password', value: googleConfirmPassword, onChange: setGoogleConfirmPassword, placeholder: 'Confirm password' },
                    ].map((field) => (
                      <label key={field.label} className="block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                        {field.label}
                        <div className="relative mt-1 flex items-center">
                          <Lock className="absolute left-4 h-4 w-4 text-stone-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            maxLength={72}
                            autoComplete="new-password"
                            placeholder={field.placeholder}
                            value={field.value}
                            onChange={(event) => field.onChange(event.target.value)}
                            className="auth-input w-full rounded-2xl border border-stone-200 bg-white py-3 pl-11 pr-4 text-xs font-semibold normal-case tracking-normal text-stone-800 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                          />
                        </div>
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-[10px] font-bold text-emerald-700 hover:underline"
                    >
                      {showPassword ? 'Hide passwords' : 'Show passwords'}
                    </button>
                  </fieldset>
                  <button
                    type="button"
                    disabled={registrationSubmitting}
                    onClick={() => switchAuthTab('register')}
                    className="mt-3 text-xs font-bold text-emerald-700 underline underline-offset-2 disabled:opacity-60"
                  >
                    Use email and password instead
                  </button>
                </section>
              ) : (
              <fieldset className="auth-form-section" disabled={registrationSubmitting}>
                <legend className="auth-form-section-title">Create your account</legend>
                <p className="auth-form-section-intro text-[11px] font-semibold leading-relaxed text-stone-400">
                  Start with your basic login details. After your first sign-in, you will complete your mobile number, barangay, purok, and address.
                </p>

                <div className="auth-form-grid">
                  <div className="auth-field">
                    <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                      Full Name
                    </label>
                    <div className="relative flex items-center">
                      <User className="absolute left-4 h-4 w-4 text-stone-400" />
                      <input
                        type="text"
                        required
                        maxLength={150}
                        autoComplete="name"
                        placeholder="Enter full name"
                        value={regFullName}
                        onChange={(e) => setRegFullName(e.target.value)}
                        className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-3 pl-11 pr-4 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                      />
                    </div>
                  </div>

                  <div className="auth-field">
                    <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                      Email Address
                    </label>
                    <div className="relative flex items-center">
                      <Mail className="absolute left-4 h-4 w-4 text-stone-400" />
                      <input
                        type="email"
                        required
                        maxLength={150}
                        autoComplete="email"
                        placeholder="Enter email address"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-3 pl-11 pr-4 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                      />
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                      Use an inbox you can open. Your account is created only after you enter the email verification code.
                    </p>
                  </div>

                  <div className="auth-field">
                    <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                      Password
                    </label>
                    <div className="relative flex items-center">
                      <Lock className="absolute left-4 h-4 w-4 text-stone-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        maxLength={72}
                        autoComplete="new-password"
                        placeholder="8+ chars, upper/lower/number"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-3 pl-11 pr-11 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                      />
                    </div>
                  </div>

                  <div className="auth-field">
                    <label className="auth-label ml-1 block text-[11px] font-bold uppercase tracking-widest text-stone-500">
                      Confirm Password
                    </label>
                    <div className="relative flex items-center">
                      <Lock className="absolute left-4 h-4 w-4 text-stone-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        maxLength={72}
                        autoComplete="new-password"
                        placeholder="Confirm password"
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] py-3 pl-11 pr-11 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                  <p className="text-[10px] font-semibold leading-relaxed text-emerald-800">
                    After verification and first login, complete your phone number, barangay, purok, and full address before using resident features.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="shrink-0 text-[10px] font-bold text-emerald-700 hover:underline"
                  >
                    {showPassword ? 'Hide passwords' : 'Show passwords'}
                  </button>
                </div>
              </fieldset>
              )}

              <div className="rounded-2xl border border-stone-200 bg-[#FAFBF9] p-3.5">
                <div className="flex items-start gap-3">
                  <input
                    id="registration-policies"
                    type="checkbox"
                    required
                    checked={acceptedPolicies}
                    disabled={registrationSubmitting}
                    onChange={(event) => setAcceptedPolicies(event.target.checked)}
                    aria-labelledby="registration-policy-label"
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-stone-300 accent-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed"
                  />
                  <p id="registration-policy-label" className="text-xs leading-relaxed text-stone-600">
                    <label htmlFor="registration-policies" className="cursor-pointer">I agree to the </label>
                    <button type="button" onClick={() => setLegalDocument('terms')} className="auth-accent font-bold text-emerald-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Terms and Conditions</button>
                    <label htmlFor="registration-policies" className="cursor-pointer"> and acknowledge the </label>
                    <button type="button" onClick={() => setLegalDocument('privacy')} className="auth-accent font-bold text-emerald-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Privacy Policy</button>.
                  </p>
                </div>
              </div>

              <button
                type="submit"
                disabled={registrationSubmitting || !acceptedPolicies}
                className="auth-primary-action mt-1 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-none bg-emerald-700 py-3 text-[10px] font-extrabold uppercase tracking-widest text-white shadow-lg shadow-emerald-800/10 transition-all hover:bg-emerald-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {registrationSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {registrationSubmitting ? 'Checking Email & Sending Code...' : pendingGoogleRegistration ? 'Continue with Google' : 'Verify Email to Register'}
              </button>
            </form>
          )}

          {/* TOGGLE BOTTOM LINK */}
          {!registrationVerificationStep && <div className="auth-switch mt-6 border-t border-stone-100 pt-5 text-center">
            {activeTab === 'login' ? (
              <p className="text-[11px] text-stone-500 font-semibold">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchAuthTab('register')}
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
                  onClick={() => switchAuthTab('login')}
                  className="auth-accent text-emerald-700 font-bold hover:underline"
                >
                  Sign In
                </button>
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setRegistrationVerificationEmail('');
                setRegistrationToken('');
                setRegistrationResendCountdown(0);
                setPendingGoogleRegistration(null);
                setAcceptedPolicies(false);
                setRegistrationVerificationStep(true);
                setError('');
                setSuccessMessage('');
              }}
              className="auth-accent mt-2 text-[11px] font-bold text-emerald-700 hover:underline"
            >
              Verify an existing account
            </button>
          </div>}
        </div>



        {/* FOOTER */}
        <p className="auth-footer text-center text-[9px] font-extrabold uppercase tracking-widest text-stone-400">
          Barangay Environmental Sinks System • MMJ group • 2026 • All Rights Reserved
        </p>
      </div>

      <RegistrationLegalDialog document={legalDocument} onClose={() => setLegalDocument(null)} />

      {/* FORGOT PASSWORD MODAL */}
      {showForgotModal && (
          <dialog
            ref={forgotDialogRef}
            aria-labelledby="forgot-password-title"
            aria-describedby="forgot-password-description"
            aria-busy={forgotLoading || resetLoading}
            onCancel={(event) => {
              event.preventDefault();
              if (!recoveryRequestInFlight.current) resetForgotPasswordState();
            }}
            className="auth-modal-card m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md space-y-5 overflow-y-auto overscroll-contain rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl backdrop:bg-stone-900/60 backdrop:backdrop-blur-sm sm:p-8"
          >
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
                <HelpCircle className="w-5 h-5" />
              </span>
              <h3 id="forgot-password-title" className="text-sm font-black text-stone-800 uppercase tracking-tight">
                {forgotStep === 'email' ? 'Forgot Password?' : 'Enter OTP & New Password'}
              </h3>
            </div>

            <p id="forgot-password-description" className="text-[11px] text-stone-500 leading-relaxed font-medium">
              {forgotStep === 'email'
                ? 'Enter your registered or recovery email address. We will send a six-digit OTP to your email.'
                : `Enter the OTP sent to ${forgotPasswordEmail} and choose your new password.`}
            </p>

            {forgotError && (
              <div ref={forgotFeedbackRef} role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold leading-relaxed text-rose-700">
                <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{forgotError}</p>
              </div>
            )}
            {forgotNotice && (
              <div role="status" className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold leading-relaxed text-emerald-800">
                <CheckCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{forgotNotice}</p>
              </div>
            )}

            {forgotStep === 'email' ? (
              <form key="request-reset-code" onSubmit={handleForgotPasswordSubmit} className="auth-form">
                <input
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  disabled={forgotLoading || resetLoading}
                  placeholder="Enter your email address"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  className="auth-input w-full rounded-2xl border border-stone-200 bg-[#FAFBF9] px-4 py-3 text-xs font-semibold text-stone-800 transition-all focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/10"
                />

                <div className="auth-modal-actions">
                  <button
                    type="button"
                    onClick={resetForgotPasswordState}
                    disabled={forgotLoading || resetLoading}
                    className="auth-secondary-action flex-1 rounded-xl border border-stone-200 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-stone-500 transition-colors hover:bg-stone-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading || resetLoading}
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
              <form key="confirm-password-reset" onSubmit={handleResetPasswordSubmit} className="auth-form">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  disabled={forgotLoading || resetLoading}
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
                      resetLoading ||
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

                <p className="text-[11px] leading-relaxed text-stone-500">
                  Use the code from the most recent email. Resending replaces the previous code.
                </p>

                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  disabled={forgotLoading || resetLoading}
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
                  autoComplete="new-password"
                  disabled={forgotLoading || resetLoading}
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
                    disabled={forgotLoading || resetLoading}
                    onClick={() => {
                      setForgotStep('email');
                      setForgotOtp('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      setResendCountdown(0);
                      setForgotError('');
                      setForgotNotice('');
                    }}
                    className="auth-secondary-action flex-1 rounded-xl border border-stone-200 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-stone-500 transition-colors hover:bg-stone-50"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading || resetLoading}
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
          </dialog>
      )}
    </div>
  );
}
