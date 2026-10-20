import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface RegistrationLegalDialogProps {
  document: 'privacy' | 'terms' | null;
  onClose: () => void;
}

const privacySections = [
  {
    title: 'Who manages your information',
    paragraphs: [
      'Smart Garbage Monitoring System supports local waste collection and community services. The barangay or municipality administering your account manages its service records and staff access. Contact its authorized office with questions about your information.',
    ],
  },
  {
    title: 'Information we collect',
    paragraphs: [
      'Registration uses your name, email address, and account credentials. Passwords are stored as hashes. Profile setup may add your phone number, address, barangay, purok, and optional profile photo.',
      'Using services may create collection and bin records, complaints and uploaded photos, payment details and proof images, endorsements, messages, and account activity. Submit only information needed for the service, and avoid including other people\u2019s private information unnecessarily.',
      'Collectors may enable browser location permission to share their GPS position while on duty. Location sharing is used to coordinate collection; it is optional and depends on the collector\u2019s permission.',
    ],
  },
  {
    title: 'How information is used and accessed',
    paragraphs: [
      'Information helps authenticate accounts, deliver email verification and password-reset codes, confirm service-area assignments, coordinate collections, review payments, handle complaints, and prepare operational reports.',
      'Authorized staff access records according to their role and assigned service area. Necessary records may be available to administrators, purok leaders, and collection staff responsible for the service.',
    ],
  },
  {
    title: 'Service providers and the chat assistant',
    paragraphs: [
      'The system uses configured hosting, email-delivery, and cloud-storage providers to operate its services. If you choose Google Sign-In, Google provides the account information needed to sign in.',
      'When you use the AI chat assistant, your questions, conversation history, and relevant information available to your account role may be sent to the configured AI provider to generate a response. Avoid sharing passwords, verification codes, financial credentials, or unnecessary sensitive details in chat.',
    ],
  },
  {
    title: 'Browser storage and retention',
    paragraphs: [
      'Your browser stores login information and preferences in session or local storage. Remember Me keeps login information in local storage between browser sessions. Sign out when using a shared device.',
      'Account and service information is retained while needed for account administration, collection services, and operational records. Deletion is managed by authorized administrators. Linked payment, complaint, or collection history may need to be retained for operational or applicable recordkeeping requirements.',
    ],
  },
  {
    title: 'Your requests and policy updates',
    paragraphs: [
      'You may ask the administering barangay or municipal office to access, correct, or delete your personal information, or raise an objection to its use. Staff may need to verify your identity and explain any records that must be retained. This notice may be updated when services or information practices change; check the date above.',
    ],
  },
];

const termsSections = [
  {
    title: 'Account registration and access',
    paragraphs: [
      'By creating an account, you agree to these Terms and Conditions and acknowledge that you have read the Privacy Policy. Provide accurate account details, use an email inbox you can access, and complete email verification. Residents must complete their barangay and purok assignment and any required approval before using services that depend on that assignment.',
      'Keep your password and verification codes private. Use only your own account or an account you are authorized to manage. Sign out on shared devices and report suspected unauthorized access to the administering office.',
    ],
  },
  {
    title: 'Responsible use',
    paragraphs: [
      'Use the system for waste collection and related community services. Do not impersonate another person, submit fraudulent records, harass others, upload harmful or unlawful content, attempt unauthorized access, or interfere with the system or other users.',
      'Keep profile and service-area information current. Submit complaints, photos, endorsements, and other records honestly and only when you are entitled to share the information. Avoid unnecessary private details about other people.',
    ],
  },
  {
    title: 'Payments and service requests',
    paragraphs: [
      'Payment proofs must be authentic and match the payment you report. Uploading a receipt or proof does not automatically confirm payment: authorized staff review and verify submissions. Contact the responsible office about disputed or incorrect records.',
      'Complaint and service-request updates reflect staff review and available resources. Follow instructions from the authorized barangay or municipal office.',
    ],
  },
  {
    title: 'Collection information and availability',
    paragraphs: [
      'Collection schedules and routes may change because of weather, vehicle availability, or operational needs. Check current notifications and official announcements, and contact local staff when information is unclear.',
      'Bin status and collection updates depend on records entered by authorized users and may not immediately reflect conditions on site. Access and uninterrupted availability are not guaranteed. The AI assistant provides guidance; confirm service decisions and payment status with authorized staff.',
    ],
  },
  {
    title: 'Account restrictions, changes, and contact',
    paragraphs: [
      'Administrators may restrict or suspend accounts involved in misuse, fraud, or unauthorized activity. Contact the administering office if you believe an action is incorrect or need help resolving an account issue.',
      'These terms may be updated as services change. Review the current terms and the date above. For account, collection, payment, privacy, or policy questions, contact your official barangay or municipal office.',
    ],
  },
];

export default function RegistrationLegalDialog({
  document: legalDocument,
  onClose,
}: RegistrationLegalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const isPrivacy = legalDocument === 'privacy';
  const title = isPrivacy ? 'Privacy Policy' : 'Terms and Conditions';
  const sections = isPrivacy ? privacySections : termsSections;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !legalDocument) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;

    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = 'hidden';
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true });

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [legalDocument]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom
        ) onClose();
      }}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-2xl backdrop:bg-slate-950/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 p-5 sm:p-6 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Smart Garbage Monitoring System</p>
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className="mt-1 text-xl font-extrabold outline-none sm:text-2xl">{title}</h2>
            <p id={descriptionId} className="mt-2 text-xs text-stone-500 dark:text-slate-400">Last updated October 16, 2026</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:ring-emerald-400 dark:focus-visible:ring-offset-slate-900"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        <div ref={bodyRef} className="min-h-0 space-y-6 overflow-y-auto overscroll-contain p-5 text-sm leading-7 text-stone-600 sm:p-6 dark:text-slate-300">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-2 text-sm font-bold text-stone-900 dark:text-slate-100">{section.title}</h3>
              <div className="space-y-3">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
          {isPrivacy && (
            <p className="border-t border-stone-200 pt-4 text-xs leading-6 dark:border-slate-700">
              Learn more about your personal data rights from the{' '}
              <a
                href="https://privacy.gov.ph/data-subject-rights/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-emerald-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 dark:text-emerald-400"
              >
                National Privacy Commission (opens in a new tab)
              </a>.
            </p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end border-t border-stone-200 p-4 sm:px-6 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 dark:focus-visible:ring-emerald-400 dark:focus-visible:ring-offset-slate-900"
          >
            Close
          </button>
        </footer>
      </div>
    </dialog>
  );
}
