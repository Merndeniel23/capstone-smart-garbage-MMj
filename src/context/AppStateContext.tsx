import React, { createContext, useContext, useState, useEffect } from 'react';

export type AppRole =
  | 'household'
  | 'collector'
  | 'leader'
  | 'admin'
  | 'super_admin';

export interface UserProfile {
  name: string;
  email?: string;
  phone?: string;
  address: string;
  householdId: string;
  contactInfo: string;
  communalZone: string;
}
export interface ScheduleItem {
  id: string;
  date: string;
  time: string;
  type: 'Regular Waste' | 'Recyclable' | 'Hazardous' | string;
  status: 'Pending' | 'Confirmed' | 'Completed' | string;
  location: string;
  proofPhotoUrl?: string;
}

export interface ComplaintItem {
  id: string;
  type: string;
  purok: string;
  description: string;
  creator: string;
  phone: string;
  date: string;
  status: 'Pending Review' | 'Assigned' | 'Scheduled' | 'Resolved';
  assignedTo?: string;
  resolutionRemark?: string;
  chats: { sender: string; text: string; time: string; role: string }[];
  visualMockUrl?: string;
}

export interface PaymentItem {
  id: string;
  date: string;
  billingPeriod: string;
  amount: number;
  method: string;
  referenceNo: string;
  category: 'Weekly Fee' | 'Special Heavy Trash' | 'Hazardous Disposal';
  status: 'Paid' | 'Pending Verification' | 'Flagged';
  householdName: string;
  purok: string;
  householdId?: string;
}


export interface BinInspectionItem {
  id: string;
  binId: string;
  location: string;
  purok: string;
  status: 'Empty' | 'Half-full' | 'Full' | 'Overflowing' | 'Damaged';
  estimatedFillLevel: number;
  remarks: string;
  inspectedBy: string;
  inspectionDate: string;
  photoUrl?: string;
  collectionRequested: boolean;
}

export interface BulletinItem {
  id: string;
  title: string;
  priority: 'emergency' | 'schedule' | 'notice';
  message: string;
  audience: string;
  author: string;
  date: string;
  time: string;
  purokTarget?: string;
  readBy: string[]; // usernames that have acknowledged it
}

export interface UserAccount {
  id?: number;
  name: string;
  email: string;
  phone: string;
  communalZone: string;
  password: string;
  role: AppRole;
  address: string;
  householdId: string;

  // Structured assignment fields used by member directories
  // and role-based filtering. They remain optional so older
  // localStorage accounts continue to work.
  barangay?: string;
  purok?: string;
  status?: "active" | "pending" | "inactive";
  createdAt?: string;
}

interface AppState {
  userProfile: UserProfile;
  currentUser: UserAccount | null;
  isLoggedIn: boolean;
  userRole: AppRole;
  registeredUsers: UserAccount[];
  deleteRegisteredUser: (email: string) => void;
  currentScreen: string;
  setCurrentScreen: (screen: any) => void;
  loginUser: (emailOrId: string, password: string, rememberMe?: boolean) => { success: boolean; error?: string };
  registerUser: (account: Omit<UserAccount, 'householdId' | 'role' | 'address'>) => { success: boolean; error?: string };
  logoutUser: () => void;
  schedules: ScheduleItem[];
  complaints: ComplaintItem[];
  payments: PaymentItem[];
  notifications: BulletinItem[];
  binInspections: BinInspectionItem[];
  updateProfile: (profile: Partial<UserProfile>) => void;
  addSchedule: (schedule: Omit<ScheduleItem, 'id'>) => void;
  updateScheduleStatus: (id: string, status: ScheduleItem['status'], proofPhotoUrl?: string) => void;
  addComplaint: (complaint: Omit<ComplaintItem, 'id' | 'chats'>) => void;
  addPayment: (payment: Omit<PaymentItem, 'id'>) => void;
  updateComplaintStatus: (id: string, status: ComplaintItem['status'], assignedTo?: string, remark?: string) => void;
  addComplaintChat: (complaintId: string, text: string, sender: string, role: string) => void;
  updatePaymentStatus: (id: string, status: PaymentItem['status']) => void;
  deleteComplaint: (id: string) => void;
  markNotificationRead: (id: string, username: string) => void;
  markAllNotificationsRead: (username: string) => void;
  addNotification: (bulletin: Omit<BulletinItem, 'id' | 'readBy'>) => void;
  deleteNotification: (id: string) => void;
  addBinInspection: (inspection: Omit<BinInspectionItem, 'id' | 'inspectionDate' | 'collectionRequested'>) => void;
  requestCollectionForInspection: (id: string) => void;
  resetPayments: () => void;
  simulateIncomingPayment: () => void;
  approveAddressCorrection: (householdName: string, purok: string, barangay: string, physicalAddress: string) => void;
}

const defaultProfile: UserProfile = {
  name: 'Mark Rallos',
  address: 'Block 3, Lot 14, Maple Street, Purok 4',
  householdId: 'HH-2026-904',
  contactInfo: '+63 912 345 6789',
  communalZone: 'Purok 4 communal zone',
};

const defaultSchedules: ScheduleItem[] = [
  {
    id: 'SCH-801',
    date: 'Oct 24, 2026',
    time: '09:00 AM - 11:00 AM',
    type: 'Regular Waste',
    status: 'Upcoming',
    location: 'Purok 4 communal zone'
  },
  {
    id: 'SCH-802',
    date: 'Oct 25, 2026',
    time: '02:00 PM - 04:00 PM',
    type: 'Recyclable',
    status: 'Pending',
    location: 'Purok 1 communal zone'
  },
  {
    id: 'SCH-803',
    date: 'Oct 27, 2026',
    time: '10:00 AM - 12:00 PM',
    type: 'Hazardous',
    status: 'Confirmed',
    location: 'Purok 7 communal zone'
  }
];

const defaultComplaints: ComplaintItem[] = [];

const defaultBulletins: BulletinItem[] = [];

export const isNameMatch = (paymentName: string, userName: string) => {
  if (!paymentName || !userName) return false;
  const pName = paymentName.toLowerCase().trim();
  const uName = userName.toLowerCase().trim();
  if (pName === uName) return true;
  
  // Clean common words to compare core names
  const clean = (s: string) => s.replace(/\b(family|household|residence|house|home|purok\s*\d*)\b/gi, '').replace(/[^a-z0-9]/gi, '').trim();
  const pClean = clean(pName);
  const uClean = clean(uName);
  
  if (pClean && uClean) {
    return pClean === uClean || pClean.includes(uClean) || uClean.includes(pClean);
  }
  return false;
};

function extractPurok(value?: string | null) {
  const match = String(value || "")
    .match(/purok\s*\d+/i);

  return match
    ? match[0]
        .replace(/\s+/g, " ")
        .replace(/^purok/i, "Purok")
    : "";
}

function normalizeStoredAccount(
  account: UserAccount,
): UserAccount {
  return {
    ...account,
    barangay:
      account.barangay ||
      "Bang-bang",
    purok:
      account.purok ||
      extractPurok(
        account.communalZone,
      ),
    status:
      account.status || "active",
    createdAt:
      account.createdAt ||
      new Date().toISOString(),
  };
}

const AppStateContext = createContext<AppState | undefined>(undefined);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  // Clear any legacy mock transactional data to ensure a completely fresh system
  useState(() => {
    const resetKey = 'sg_clean_reset_v1_3';
    if (localStorage.getItem(resetKey) !== 'true') {
      localStorage.removeItem('sg_schedules');
      localStorage.removeItem('sg_municipal_complaints');
      localStorage.removeItem('sg_payment_history');
      localStorage.removeItem('sg_municipal_bulletins');
      localStorage.removeItem('sg_current_user');
      localStorage.setItem('sg_is_logged_in', 'false');
      localStorage.removeItem('sg_user_role');
      localStorage.setItem('sg_current_screen', 'registration');
      localStorage.setItem(resetKey, 'true');
    }
  });

  // List of registered accounts
  const [registeredUsers, setRegisteredUsers] = useState<UserAccount[]>(() => {
    const saved = localStorage.getItem('sg_registered_users');
    if (saved) {
      try {
        return (
          JSON.parse(saved) as UserAccount[]
        ).map(normalizeStoredAccount);
      } catch (e) {
        // Fallback below
      }
    }
    const defaults: UserAccount[] = [
      {
        name: 'Mark Rallos',
        email: 'test@household.com',
        phone: '+63 912 345 6789',
        communalZone: 'Purok 4 communal zone',
        password: 'password123',
        role: 'household',
        address: 'Block 3, Lot 14, Maple Street, Purok 4',
        householdId: 'HH-2026-904'
      },
      {
        name: 'Carlos Collector',
        email: 'collector@barangay.gov',
        phone: '+63 922 456 7890',
        communalZone: 'Purok 4',
        password: 'password123',
        role: 'collector',
        address: 'Sanitation Office, Barangay Central',
        householdId: 'COL-2026-101'
      },
      {
        name: 'Leader Mark',
        email: 'leader@barangay.gov',
        phone: '+63 933 567 8901',
        communalZone: 'Purok 4',
        password: 'password123',
        role: 'leader',
        address: 'Barangay Hall, Purok 4',
        householdId: 'LDR-2026-401'
      },
      {
        name: 'Admin Central',
        email: 'admin@barangay.gov',
        phone: '+63 944 678 9012',
        communalZone: 'Purok 4',
        password: 'password123',
        role: 'admin',
        address: 'Municipal Center',
        householdId: 'ADM-2026-001'
      },
      {
        name: 'Municipal System Administrator',
        email: 'superadmin@cordova.gov.ph',
        phone: '',
        communalZone: 'Municipality of Cordova',
        password: '',
        role: 'super_admin',
        address: 'Municipality of Cordova',
        householdId: 'SUP-2026-001'
      }
    ];
    const normalizedDefaults =
      defaults.map(
        normalizeStoredAccount,
      );

    localStorage.setItem(
      'sg_registered_users',
      JSON.stringify(
        normalizedDefaults,
      ),
    );

    return normalizedDefaults;
  });

  // Current logged in user (persisted or from session)
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    const saved = localStorage.getItem('sg_current_user');
    return saved
      ? normalizeStoredAccount(
          JSON.parse(saved),
        )
      : null;
  });

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return localStorage.getItem('sg_is_logged_in') === 'true';
  });

  const [userRole, setUserRole] = useState<AppRole>(() => {
    const savedRole = localStorage.getItem('sg_user_role');

    const validRoles: AppRole[] = [
      'household',
      'collector',
      'leader',
      'admin',
      'super_admin',
    ];

    return validRoles.includes(savedRole as AppRole)
      ? (savedRole as AppRole)
      : 'household';
  });

  const [currentScreen, setCurrentScreen] = useState<string>(() => {
    const savedScreen = localStorage.getItem('sg_current_screen');

    if (savedScreen) {
      return savedScreen;
    }

    if (localStorage.getItem('sg_is_logged_in') !== 'true') {
      return 'registration';
    }

    const savedRole = localStorage.getItem('sg_user_role');

    if (savedRole === 'super_admin') return 'super-admin-dashboard';
    if (savedRole === 'admin') return 'admin-dashboard';
    if (savedRole === 'collector') return 'collector-tasks';
    if (savedRole === 'leader') return 'leader-dashboard';

    return 'dashboard';
  });

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('sg_user_profile');
    return saved ? JSON.parse(saved) : defaultProfile;
  });

  const [schedules, setSchedules] = useState<ScheduleItem[]>(() => {
    const saved = localStorage.getItem('sg_schedules');
    return saved ? JSON.parse(saved) : defaultSchedules;
  });

  const [complaints, setComplaints] = useState<ComplaintItem[]>(() => {
    const saved = localStorage.getItem('sg_municipal_complaints');
    return saved ? JSON.parse(saved) : defaultComplaints;
  });

  const [payments, setPayments] = useState<PaymentItem[]>(() => {
    const saved = localStorage.getItem('sg_payment_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((p: any) => {
          let updated = { ...p };
          if (p.category === 'Monthly Fee') {
            updated.category = 'Weekly Fee';
          }
          if (updated.category === 'Weekly Fee' && updated.amount === 30) {
            updated.amount = 5;
          }
          return updated;
        });
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const [notifications, setNotifications] = useState<BulletinItem[]>(() => {
    const saved = localStorage.getItem('sg_municipal_bulletins');
    return saved ? JSON.parse(saved) : defaultBulletins;
  });


  const [binInspections, setBinInspections] = useState<BinInspectionItem[]>(() => {
    const saved = localStorage.getItem('sg_bin_inspections');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'INSP-1001', binId: 'BIN-P4-01', location: 'Maple Street communal area', purok: 'Purok 4',
        status: 'Half-full', estimatedFillLevel: 55, remarks: 'Waste is properly segregated. Recheck tomorrow.',
        inspectedBy: 'Leader Mark', inspectionDate: 'Jul 21, 2026, 08:30 AM', collectionRequested: false
      },
      {
        id: 'INSP-1002', binId: 'BIN-P4-02', location: 'Barangay covered court', purok: 'Purok 4',
        status: 'Full', estimatedFillLevel: 90, remarks: 'Ready for collection. No visible damage.',
        inspectedBy: 'Leader Mark', inspectionDate: 'Jul 21, 2026, 09:10 AM', collectionRequested: true
      }
    ];
  });

  // Automated pickup reminders states

  // Save changes of registered users
  useEffect(() => {
    localStorage.setItem('sg_registered_users', JSON.stringify(registeredUsers));
  }, [registeredUsers]);

  // Sync auth states to localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('sg_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('sg_current_user');
    }
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('sg_is_logged_in', String(isLoggedIn));
  }, [isLoggedIn]);

  useEffect(() => {
    localStorage.setItem('sg_user_role', userRole);
  }, [userRole]);

  useEffect(() => {
    localStorage.setItem('sg_current_screen', currentScreen);
  }, [currentScreen]);

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }

    const expectedScreen =
      userRole === 'super_admin'
        ? 'super-admin-dashboard'
        : userRole === 'admin'
          ? 'admin-dashboard'
          : userRole === 'collector'
            ? 'collector-tasks'
            : userRole === 'leader'
              ? 'leader-dashboard'
              : 'dashboard';

    const roleDashboardScreens = [
      'dashboard',
      'collector-tasks',
      'leader-dashboard',
      'admin-dashboard',
      'super-admin-dashboard',
      'registration',
    ];

    if (
      currentScreen === 'registration' ||
      (
        roleDashboardScreens.includes(currentScreen) &&
        currentScreen !== expectedScreen
      )
    ) {
      setCurrentScreen(expectedScreen);
    }
  }, [isLoggedIn, userRole, currentScreen]);

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem('sg_user_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    localStorage.setItem('sg_schedules', JSON.stringify(schedules));
  }, [schedules]);

  useEffect(() => {
    localStorage.setItem('sg_municipal_complaints', JSON.stringify(complaints));
  }, [complaints]);

  useEffect(() => {
    localStorage.setItem('sg_payment_history', JSON.stringify(payments));
  }, [payments]);

  useEffect(() => {
    localStorage.setItem('sg_municipal_bulletins', JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem('sg_bin_inspections', JSON.stringify(binInspections));
  }, [binInspections]);

  const loginUser = (emailOrId: string, password: string, rememberMe?: boolean) => {
    const normalizedInput = emailOrId.trim().toLowerCase();
    const user = registeredUsers.find(
      (u) => 
        (u.email.toLowerCase() === normalizedInput || u.householdId.toLowerCase() === normalizedInput) && 
        u.password === password
    );

    if (user) {
      setCurrentUser(user);
      setIsLoggedIn(true);
      setUserRole(user.role);
      
      // Update userProfile state dynamically
      setUserProfile({
        name: user.name,
        address: user.address,
        householdId: user.householdId,
        contactInfo: user.phone,
        communalZone: user.communalZone
      });

      // Save credentials if Remember Me is checked (handled naturally by our localStorage setup)
      
      // Navigate to the correct starting screen based on role.
      if (user.role === 'super_admin') {
        setCurrentScreen('super-admin-dashboard');
      } else if (user.role === 'admin') {
        setCurrentScreen('admin-dashboard');
      } else if (user.role === 'collector') {
        setCurrentScreen('collector-tasks');
      } else if (user.role === 'leader') {
        setCurrentScreen('leader-dashboard');
      } else {
        setCurrentScreen('dashboard');
      }
      return { success: true };
    }
    return { success: false, error: 'Invalid email address/household ID or password.' };
  };

  const registerUser = (account: Omit<UserAccount, 'householdId' | 'role' | 'address'>) => {
    const emailExists = registeredUsers.some(u => u.email.toLowerCase() === account.email.trim().toLowerCase());
    if (emailExists) {
      return { success: false, error: 'Email address is already registered.' };
    }

    const nextIdNum = Math.floor(100 + Math.random() * 900);
    const newAccount: UserAccount =
      normalizeStoredAccount({
        ...account,
        role: 'household',
        address: `Communal Address, ${account.communalZone}`,
        householdId: `HH-2026-${nextIdNum}`,
        barangay: 'Bang-bang',
        purok: extractPurok(
          account.communalZone,
        ),
        status: 'active',
        createdAt:
          new Date().toISOString(),
      });

    setRegisteredUsers(prev => [...prev, newAccount]);
    setCurrentUser(newAccount);
    setIsLoggedIn(true);
    setUserRole('household');
    setUserProfile({
      name: newAccount.name,
      address: newAccount.address,
      householdId: newAccount.householdId,
      contactInfo: newAccount.phone,
      communalZone: newAccount.communalZone
    });
    setCurrentScreen('dashboard');

    return { success: true };
  };

  const deleteRegisteredUser = (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();

    setRegisteredUsers((previousUsers) =>
      previousUsers.filter(
        (user) =>
          user.email.trim().toLowerCase() !== normalizedEmail,
      ),
    );

    if (
      currentUser?.email.trim().toLowerCase() === normalizedEmail
    ) {
      setCurrentUser(null);
      setIsLoggedIn(false);
      setUserRole('household');
      setCurrentScreen('registration');
    }
  };

  const logoutUser = () => {
    setCurrentUser(null);
    setIsLoggedIn(false);
    setUserRole('household');
    setCurrentScreen('registration');
    localStorage.removeItem('sg_current_user');
    localStorage.setItem('sg_is_logged_in', 'false');
    localStorage.removeItem('sg_user_role');
    localStorage.setItem('sg_current_screen', 'registration');
    localStorage.removeItem('token');
    localStorage.removeItem('authToken');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('authToken');
  };

  const updateProfile = (profile: Partial<UserProfile>) => {
    setUserProfile((prev) => {
      const updatedProfile = { ...prev, ...profile };
      
      if (currentUser) {
        const updatedCurrentUser: UserAccount = {
          ...currentUser,
          name: updatedProfile.name ?? currentUser.name,
          address: updatedProfile.address ?? currentUser.address,
          householdId: updatedProfile.householdId ?? currentUser.householdId,
          phone: updatedProfile.contactInfo ?? currentUser.phone,
          communalZone: updatedProfile.communalZone ?? currentUser.communalZone,
          purok:
            extractPurok(
              updatedProfile.communalZone ??
                currentUser.communalZone,
            ) ||
            currentUser.purok,
        };
        setCurrentUser(updatedCurrentUser);

        setRegisteredUsers(prevUsers => 
          prevUsers.map(u => u.email === currentUser.email ? updatedCurrentUser : u)
        );
      }
      return updatedProfile;
    });
  };

  const addSchedule = (schedule: Omit<ScheduleItem, 'id'>) => {
    const newItem: ScheduleItem = {
      ...schedule,
      id: `SCH-${Math.floor(100 + Math.random() * 900)}`,
    };
    setSchedules((prev) => [newItem, ...prev]);
  };

  const updateScheduleStatus = (id: string, status: ScheduleItem['status'], proofPhotoUrl?: string) => {
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status, proofPhotoUrl: proofPhotoUrl || s.proofPhotoUrl } : s))
    );
  };

  const addComplaint = (complaint: Omit<ComplaintItem, 'id' | 'chats'>) => {
    const newItem: ComplaintItem = {
      ...complaint,
      id: `TXN-CMP-${Math.floor(100 + Math.random() * 900)}`,
      chats: [
        { sender: complaint.creator, text: 'Reported to Barangay monitoring services.', time: 'Just now', role: 'household' }
      ],
    };
    setComplaints((prev) => [newItem, ...prev]);
  };

  const addPayment = (payment: Omit<PaymentItem, 'id'>) => {
    const newItem: PaymentItem = {
      ...payment,
      id: `TXN-${Math.floor(1000000 + Math.random() * 9000000)}`,
    };
    setPayments((prev) => [newItem, ...prev]);
  };

  const updateComplaintStatus = (id: string, status: ComplaintItem['status'], assignedTo?: string, remark?: string) => {
    setComplaints((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const updated: ComplaintItem = { ...c, status };
          if (assignedTo) updated.assignedTo = assignedTo;
          if (remark) updated.resolutionRemark = remark;
          return updated;
        }
        return c;
      })
    );
  };

  const addComplaintChat = (complaintId: string, text: string, sender: string, role: string) => {
    setComplaints((prev) =>
      prev.map((c) => {
        if (c.id === complaintId) {
          return {
            ...c,
            chats: [
              ...c.chats,
              { sender, text, time: 'Just now', role },
            ],
          };
        }
        return c;
      })
    );
  };

  const updatePaymentStatus = (id: string, status: PaymentItem['status']) => {
    setPayments((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status } : p))
    );

    // Sync compliant flag in Purok members if relevant
    const targetTxn = payments.find(p => p.id === id);
    if (targetTxn) {
      const savedMembers = localStorage.getItem('sg_purok_members');
      if (savedMembers) {
        try {
          const mList = JSON.parse(savedMembers);
          const updatedM = mList.map((m: any) => {
            const matchesName = isNameMatch(m.name || '', targetTxn.householdName || '');
            if (matchesName) {
              return { ...m, status: status === 'Paid' ? 'Compliant' : 'Warning' };
            }
            return m;
          });
          localStorage.setItem('sg_purok_members', JSON.stringify(updatedM));
        } catch (e) {
          console.error(e);
        }
      }
    }
  };

  const deleteComplaint = (id: string) => {
    setComplaints((prev) => prev.filter((c) => c.id !== id));
  };

  const markNotificationRead = (id: string, username: string) => {
    setNotifications((prev) =>
      prev.map((b) => {
        if (b.id === id) {
          const readSet = new Set(b.readBy);
          readSet.add(username);
          return { ...b, readBy: Array.from(readSet) };
        }
        return b;
      })
    );
  };

  const markAllNotificationsRead = (username: string) => {
    setNotifications((prev) =>
      prev.map((b) => {
        const readSet = new Set(b.readBy);
        readSet.add(username);
        return { ...b, readBy: Array.from(readSet) };
      })
    );
  };

  const addNotification = (bulletin: Omit<BulletinItem, 'id' | 'readBy'>) => {
    const newItem: BulletinItem = {
      ...bulletin,
      id: `BLL-${Math.floor(100 + Math.random() * 900)}`,
      readBy: [],
    };
    setNotifications((prev) => [newItem, ...prev]);
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((b) => b.id !== id));
  };

  const resetPayments = () => {
    setPayments([]);
  };

  const simulateIncomingPayment = () => {
    const names = ['Delacruz Household', 'Daro Family', 'Deatras Residence', 'Estrella Family', 'Salvador Household'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    const randomPurok = `Purok ${Math.floor(1 + Math.random() * 4)}`;
    const randomCategory = Math.random() > 0.6 ? 'Special Heavy Trash' : 'Weekly Fee';
    const randomAmount = randomCategory === 'Weekly Fee' ? 5 : 80;

    const simulated: PaymentItem = {
      id: `TXN-${Math.floor(1000000 + Math.random() * 9000000)}`,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      billingPeriod: randomCategory === 'Weekly Fee' ? 'May 2026' : 'Ad-hoc Request',
      amount: randomAmount,
      method: Math.random() > 0.5 ? 'G-Cash' : 'PayMaya',
      referenceNo: `SIM-${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      category: randomCategory as any,
      status: 'Pending Verification',
      householdName: randomName,
      purok: randomPurok,
    };

    setPayments((prev) => [simulated, ...prev]);
  };


  const addBinInspection = (inspection: Omit<BinInspectionItem, 'id' | 'inspectionDate' | 'collectionRequested'>) => {
    const needsCollection = inspection.status === 'Full' || inspection.status === 'Overflowing';
    const newItem: BinInspectionItem = {
      ...inspection,
      id: `INSP-${Math.floor(1000 + Math.random() * 9000)}`,
      inspectionDate: new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }),
      collectionRequested: needsCollection,
    };
    setBinInspections(prev => [newItem, ...prev]);
    if (needsCollection) {
      addNotification({
        title: `${inspection.status} bin requires collection`,
        priority: 'emergency',
        message: `${inspection.binId} at ${inspection.location}, ${inspection.purok} was manually inspected by ${inspection.inspectedBy}. Status: ${inspection.status} (${inspection.estimatedFillLevel}% estimated).`,
        audience: 'collector', author: inspection.inspectedBy,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        purokTarget: inspection.purok,
      });
    }
  };

  const requestCollectionForInspection = (id: string) => {
    setBinInspections(prev => prev.map(item => item.id === id ? { ...item, collectionRequested: true } : item));
    const item = binInspections.find(i => i.id === id);
    if (item) {
      addNotification({
        title: 'Manual collection request', priority: 'schedule',
        message: `${item.binId} at ${item.location} was submitted for collection after Purok Leader inspection.`,
        audience: 'collector', author: currentUser?.name || 'Purok Leader',
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        purokTarget: item.purok,
      });
    }
  };

  const approveAddressCorrection = (householdName: string, purok: string, barangay: string, physicalAddress: string) => {
    // 1. Update registeredUsers array
    setRegisteredUsers((prevUsers) => 
      prevUsers.map((u) => {
        if (u.name.toLowerCase().trim() === householdName.toLowerCase().trim()) {
          return {
            ...u,
            communalZone: `${purok}, ${barangay}`,
            purok,
            barangay,
            address: physicalAddress
          };
        }
        return u;
      })
    );

    // 2. Update currentUser if names match
    if (currentUser && currentUser.name.toLowerCase().trim() === householdName.toLowerCase().trim()) {
      setCurrentUser((prev) => prev ? {
        ...prev,
        communalZone: `${purok}, ${barangay}`,
        purok,
        barangay,
        address: physicalAddress
      } : null);
    }

    // 3. Update userProfile if names match
    setUserProfile((prev) => {
      if (prev.name.toLowerCase().trim() === householdName.toLowerCase().trim()) {
        return {
          ...prev,
          communalZone: `${purok}, ${barangay}`,
          address: physicalAddress
        };
      }
      return prev;
    });
  };

  return (
    <AppStateContext.Provider
      value={{
        userProfile,
        currentUser,
        isLoggedIn,
        userRole,
        registeredUsers,
        deleteRegisteredUser,
        currentScreen,
        setCurrentScreen,
        loginUser,
        registerUser,
        logoutUser,
        schedules,
        complaints,
        payments,
        notifications,
        binInspections,
        updateProfile,
        addSchedule,
        updateScheduleStatus,
        addComplaint,
        addPayment,
        updateComplaintStatus,
        addComplaintChat,
        updatePaymentStatus,
        deleteComplaint,
        markNotificationRead,
        markAllNotificationsRead,
        addNotification,
        deleteNotification,
        addBinInspection,
        requestCollectionForInspection,
        resetPayments,
        simulateIncomingPayment,
        approveAddressCorrection,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
}