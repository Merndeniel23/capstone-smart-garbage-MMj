import { useState, type FormEvent } from "react";

export default function PasswordSetup() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("setup-password") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/account-setup/complete", {method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({token, password, confirmPassword})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setPassword(""); setConfirm(""); setDone(true); setMessage(result.message);
      window.history.replaceState(null, "", window.location.pathname);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to set password."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-dvh bg-slate-100 p-6 flex items-center justify-center"><form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 space-y-4 shadow-xl"><h1 className="text-xl font-black">Set your SGMS password</h1><p className="text-sm text-slate-600">Your account becomes active after you create a password. Use 8–72 bytes with uppercase, lowercase and a number.</p>{!done && <><label className="block">Password<input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} className="block w-full rounded border p-3" /></label><label className="block">Confirm password<input required type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirmPassword} onChange={e=>setConfirm(e.target.value)} className="block w-full rounded border p-3" /></label><button disabled={busy} className="rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Activate account"}</button></>}<p role="status" className="text-sm">{message}</p><a className="block text-emerald-700 underline" href="/">Back to sign in</a></form></main>;
}
