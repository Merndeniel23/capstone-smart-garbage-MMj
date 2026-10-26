import { useEffect, useState } from "react";
import {
  Award,
  Building2,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  Map,
  MapPinned,
  MessageSquare,
  QrCode,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  User,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { apiFetch } from "../services/http";
import type { AppRole } from "../context/AppStateContext";
import type { AdminActionCounts } from "../hooks/useAdminActionCounts";

export interface MenuItem {
  id: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  /** Needs the SGMS workflow migration (SGMS_REVISIONS_ENABLED). */
  revisions?: boolean;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

/** Reads whether the four-role workflow tables are enabled on the server. */
export function useSgmsFlags() {
  const [revisions, setRevisions] = useState(true);

  useEffect(() => {
    let active = true;
    void apiFetch("/api/sgms/config")
      .then((res) => res.json())
      .then((data) => {
        if (active && data.enabled === false) setRevisions(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return { revisions };
}

/**
 * One hierarchy per role, shared by the desktop sidebar and mobile bar:
 * Overview → day-to-day work → services → records → account.
 */
export function menuSections(
  role: AppRole,
  counts: AdminActionCounts & { unseenNotifications: number },
  options: { revisions: boolean; residentRestricted: boolean },
): MenuSection[] {
  const profile: MenuItem = { id: "profile", icon: User, label: "Profile" };

  let sections: MenuSection[];

  switch (role) {
    case "admin":
      sections = [
        { title: "Overview", items: [
          { id: "admin-dashboard", icon: Shield, label: "Barangay Dashboard" },
        ] },
        { title: "Users & Areas", items: [
          { id: "user-management", icon: UserCog, label: "Manage Users", count: counts.unreadAccounts },
          { id: "households", icon: Users, label: "Households & Members", revisions: true },
        ] },
        { title: "Garbage Collection", items: [
          { id: "schedule", icon: Calendar, label: "Collection Schedule" },
          { id: "garbage-bins", icon: MapPinned, label: "Garbage Bins" },
          { id: "collection-records", icon: ClipboardList, label: "Segregation Records", revisions: true },
          { id: "bin-inspections", icon: ClipboardCheck, label: "Inspection Records" },
        ] },
        { title: "Monitoring", items: [
          { id: "violations", icon: ShieldAlert, label: "Violations", revisions: true },
          { id: "complaints", icon: MessageSquare, label: "Complaints", count: counts.unreadComplaints },
        ] },
        { title: "Documents", items: [
          { id: "endorsements", icon: Award, label: "Endorsements", count: counts.pendingEndorsements },
        ] },
        { title: "Records", items: [
          { id: "activity-logs", icon: History, label: "Activity Logs", count: counts.pendingScanDecisions, revisions: true },
        ] },
        { title: "Settings", items: [
          profile,
        ] },
      ];
      break;

    case "leader":
      sections = [
        { title: "Overview", items: [
          { id: "leader-dashboard", icon: LayoutDashboard, label: "Leader Dashboard" },
        ] },
        { title: "My Purok", items: [
          {
            id: "members-list",
            icon: Users,
            label: "Purok Members",
            count: counts.pendingPayments + counts.pendingScanDecisions,
          },
          { id: "households", icon: Building2, label: "Households & Bins", revisions: true },
          { id: "garbage-bins", icon: MapPinned, label: "Garbage Bins" },
          { id: "schedule", icon: Calendar, label: "Collection Schedule" },
        ] },
        { title: "Resident Services", items: [
          { id: "endorsements", icon: Award, label: "Endorsements", count: counts.pendingEndorsements },
          { id: "complaints", icon: MessageSquare, label: "Complaints", count: counts.unreadComplaints },
        ] },
        { title: "Records", items: [
          { id: "archives", icon: ScrollText, label: "Archives", revisions: true },
        ] },
        { title: "Account", items: [profile] },
      ];
      break;

    case "collector":
      sections = [
        { title: "Overview", items: [
          { id: "collector-tasks", icon: LayoutDashboard, label: "Collector Dashboard" },
        ] },
        { title: "Garbage Collection", items: [
          { id: "collection-records", icon: QrCode, label: "QR Bin Scanner", revisions: true },
          { id: "schedule", icon: Calendar, label: "Collection Schedule" },
          { id: "route-map", icon: Map, label: "Route Map" },
        ] },
        { title: "Monitoring", items: [
          { id: "complaints", icon: MessageSquare, label: "Assigned Complaints", count: counts.unreadComplaints },
        ] },
        { title: "Records", items: [
          { id: "activity-logs", icon: History, label: "Scan History", revisions: true },
        ] },
        { title: "Account", items: [profile] },
      ];
      break;

    default:
      sections = options.residentRestricted
        ? [{ title: "Account", items: [profile] }]
        : [
            { title: "Overview", items: [
              { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
                ] },
            { title: "My Household", items: [
              { id: "households", icon: Users, label: "My Household", revisions: true },
              { id: "schedule", icon: Calendar, label: "Collection Schedule" },
              { id: "collection-records", icon: ClipboardList, label: "Segregation Records", revisions: true },
              { id: "violations", icon: ShieldAlert, label: "Violations", revisions: true },
            ] },
            { title: "Services", items: [
              { id: "payments", icon: Wallet, label: "Payments" },
              { id: "endorsements", icon: Award, label: "Request Endorsement" },
              { id: "complaints", icon: MessageSquare, label: "Complaints", count: counts.unreadComplaints },
            ] },
            { title: "Records", items: [
              { id: "payment-history", icon: Receipt, label: "Payment History", revisions: true },
              { id: "activity-logs", icon: History, label: "Activity History", revisions: true },
            ] },
            { title: "Account", items: [profile] },
          ];
  }

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => options.revisions || !item.revisions),
    }))
    .filter((section) => section.items.length > 0);
}

export function roleLabel(role: AppRole) {
  switch (role) {
    case "admin":
      return "Barangay Captain";
    case "leader":
      return "Purok Leader";
    case "collector":
      return "Garbage Collector";
    default:
      return "Resident";
  }
}
