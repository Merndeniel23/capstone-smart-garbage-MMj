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

  const mustChangePassword =
    data?.mustChangePassword === true ||
    Number(data?.mustChangePassword) === 1 ||
    Number(data?.user?.must_change_password) === 1;

  const currentScreen = mustChangePassword
    ? "change-initial-password"
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
    password: "",
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
  };

  localStorage.setItem("token", data.token);

  if (!remember) {
    sessionStorage.setItem("token", data.token);
  }

  localStorage.setItem(
    "sg_current_user",
    JSON.stringify(appUser)
  );

  localStorage.setItem("sg_is_logged_in", "true");
  localStorage.setItem("sg_user_role", appRole);
  localStorage.setItem("sg_current_screen", currentScreen);

  if (mustChangePassword) {
    localStorage.setItem(
      "sg_temp_login_email",
      data.user.email
    );
  } else {
    localStorage.removeItem("sg_temp_login_email");
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

    if (regPassword.length < 8) {
      setError('Password must be at least 8 characters.');
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

      setSuccessMessage('Account registered successfully! You can now sign in.');

      setRegFullName('');
      setRegEmail('');
      setRegPhone('');
      setRegBarangayId('');
      setRegPurokId('');
      setRegPassword('');
      setRegConfirmPassword('');

      window.setTimeout(() => {
        setActiveTab('login');
        setSuccessMessage('');
      }, 1200);
    } catch (error) {
      console.error('Registration error:', error);
      setError('Cannot connect to the server.');
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

  if (newPassword.length < 8) {
    setError(
      'New password must be at least 8 characters.',
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
    <div className="min-h-screen w-full bg-[#FAFBF9] flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans text-stone-900 relative">
      {/* Absolute top decoration */}
      <div className="absolute top-0 inset-x-0 h-2 bg-emerald-700" />
      
      {/* Decorative blurred spots */}
      <div className="absolute top-[15%] left-[10%] w-[350px] h-[350px] bg-emerald-700/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[15%] right-[10%] w-[350px] h-[350px] bg-emerald-700/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md z-10 space-y-6">
        {/* APP LOGO & HEADER */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 bg-emerald-700 rounded-2xl flex items-center justify-center shadow-md shadow-emerald-700/20">
            <Leaf className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-stone-850 tracking-tight leading-none uppercase">
              Smart Garbage
            </h1>
            <p className="text-[10px] font-extrabold tracking-[0.25em] text-emerald-700 uppercase mt-1">
              Monitoring System
            </p>
          </div>
        </div>

        {/* MAIN AUTH CONTAINER */}
        <div className="bg-white rounded-3xl border border-stone-200/60 shadow-xl overflow-hidden p-6 sm:p-8 transition-all">
          
          {/* TAB SEGMENT */}
          <div className="flex border-b border-stone-100 pb-5 mb-6">
            <button
              type="button"
              onClick={() => { setActiveTab('login'); setError(''); setSuccessMessage(''); }}
              className={`flex-1 text-center pb-2 text-xs uppercase font-extrabold tracking-wider transition-all relative ${
                activeTab === 'login' ? 'text-emerald-700' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              Sign In
              {activeTab === 'login' && (
                <motion.div layoutId="authUnderline" className="absolute bottom-0 inset-x-0 h-0.5 bg-emerald-700" />
              )}
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('register'); setError(''); setSuccessMessage(''); }}
              className={`flex-1 text-center pb-2 text-xs uppercase font-extrabold tracking-wider transition-all relative ${
                activeTab === 'register' ? 'text-emerald-700' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              Create Account
              {activeTab === 'register' && (
                <motion.div layoutId="authUnderline" className="absolute bottom-0 inset-x-0 h-0.5 bg-emerald-700" />
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
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
                  Email or Household ID
                </label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    required
                    placeholder="test@household.com or HH-2026-904"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
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
                    className="w-full pl-11 pr-11 py-3 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
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

              <div className="flex items-center justify-between pt-1">
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
                  className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>

             <>
  <button
    type="submit"
    className="w-full mt-4 py-3 bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white font-extrabold uppercase text-[10px] tracking-widest rounded-2xl shadow-lg shadow-emerald-800/10 transition-all cursor-pointer border-none"
  >
    Authenticate & Enter Console
  </button>

  <div className="flex items-center my-4">
    <div className="flex-1 border-t border-gray-300"></div>
    <span className="px-3 text-xs text-gray-500 font-semibold">OR</span>
    <div className="flex-1 border-t border-gray-300"></div>
  </div>

  <div className="flex justify-center">
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
            completeLogin(data, true);
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
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
                  Full Name
                </label>
                <div className="relative flex items-center">
                  <User className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g., Mark Rallos"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
                  Email Address
                </label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="email"
                    required
                    placeholder="e.g., mark@household.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
                  Mobile Number
                </label>
                <div className="relative flex items-center">
                  <Phone className="absolute left-4 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g., +63 912 345 6789"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
                  Assigned Communal Zone (Barangay & Purok)
                </label>
                <div className="grid grid-cols-2 gap-3">
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
                      className="w-full pl-11 pr-10 py-2.5 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800 appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
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
                      className="w-full pl-11 pr-10 py-2.5 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800 appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
                    Password
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full px-4 py-2.5 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block ml-1">
                    Confirm Password
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Confirm"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      className="w-full px-4 py-2.5 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
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

              <button
                type="submit"
                className="w-full mt-2 py-3 bg-emerald-750 hover:bg-emerald-800 active:scale-[0.98] text-white font-extrabold uppercase text-[10px] tracking-widest rounded-2xl shadow-lg shadow-emerald-800/10 transition-all cursor-pointer border-none bg-emerald-700"
              >
                Register & Join Network
              </button>
            </form>
          )}

          {/* TOGGLE BOTTOM LINK */}
          <div className="mt-6 pt-5 border-t border-stone-100 text-center">
            {activeTab === 'login' ? (
              <p className="text-[11px] text-stone-500 font-semibold">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setActiveTab('register'); setError(''); setSuccessMessage(''); }}
                  className="text-emerald-700 font-bold hover:underline"
                >
                  Register here
                </button>
              </p>
            ) : (
              <p className="text-[11px] text-stone-500 font-semibold">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setActiveTab('login'); setError(''); setSuccessMessage(''); }}
                  className="text-emerald-700 font-bold hover:underline"
                >
                  Sign In
                </button>
              </p>
            )}
          </div>
        </div>



        {/* FOOTER */}
        <p className="text-[9px] font-extrabold tracking-widest text-stone-400 uppercase text-center">
          Barangay Environmental Sinks System • Powered by mern daniel rallos
        </p>
      </div>

      {/* FORGOT PASSWORD MODAL */}
      {showForgotModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl border border-stone-200 p-6 sm:p-8 max-w-sm w-full space-y-4 shadow-2xl">
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
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-3.5">
                <input
                  type="email"
                  required
                  placeholder="Enter your email address"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                />

                <div className="flex gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={resetForgotPasswordState}
                    className="flex-1 py-2.5 border border-stone-200 rounded-xl text-[10px] font-extrabold text-stone-500 hover:bg-stone-50 transition-colors uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="flex flex-1 items-center justify-center gap-2 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-[10px] font-extrabold transition-colors uppercase tracking-wider border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {forgotLoading && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {forgotLoading ? 'Sending...' : 'Send OTP'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleResetPasswordSubmit} className="space-y-3.5">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="Enter 6-digit OTP"
                  value={forgotOtp}
                  onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 text-center tracking-[0.35em] bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-sm font-bold text-stone-800"
                />

                <div className="flex items-center justify-between px-1">
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
                    className="text-[10px] font-extrabold text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-stone-400 disabled:no-underline"
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
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                />

                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Confirm new password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[#FAFBF9] border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-700/10 focus:border-emerald-700 transition-all text-xs font-semibold text-stone-800"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[10px] font-bold text-stone-500 hover:text-stone-700"
                >
                  {showPassword ? 'Hide passwords' : 'Show passwords'}
                </button>

                <div className="flex gap-2.5 pt-1">
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
                    className="flex-1 py-2.5 border border-stone-200 rounded-xl text-[10px] font-extrabold text-stone-500 hover:bg-stone-50 transition-colors uppercase tracking-wider"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="flex flex-1 items-center justify-center gap-2 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-[10px] font-extrabold transition-colors uppercase tracking-wider border-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
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