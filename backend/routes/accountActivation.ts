import { Router } from "express";
import bcrypt from "bcryptjs";
import { isStrongPassword } from "../config/security.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { activationHash, sendAccountActivation } from "../services/accountActivation.js";
import { audit, DomainError, positiveId, revisionsEnabled, transaction } from "../services/sgms.js";

const router = Router();
router.get("/config", (_req, res) => res.json({enabled: revisionsEnabled()}));
router.use((_req, res, next) => revisionsEnabled() ? next() : res.status(503).json({message: "Account setup is awaiting migration and configuration."}));
router.post("/complete", async (req, res) => {
  try {
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");
    if (!/^[a-f0-9]{64}$/.test(token) || !isStrongPassword(password) || password !== req.body.confirmPassword) throw new DomainError("Enter a valid setup link and matching passwords (8–72 bytes, uppercase, lowercase and number).");
    const hash = await bcrypt.hash(password, 12);
    await transaction(async connection => {
      const [rows] = await connection.query<any[]>(
        `SELECT u.id, u.role, u.email, u.status, u.barangay_id, u.purok_id FROM account_activations a
         JOIN users u ON u.id = a.user_id
         WHERE a.token_hash = ? AND a.consumed_at IS NULL AND a.expires_at > NOW() AND u.archived_at IS NULL
         LIMIT 1 FOR UPDATE`, [activationHash(token)],
      );
      const user = rows[0];
      if (!user || user.status !== "pending_activation" || !["collector","purok_leader","resident"].includes(user.role)) throw new DomainError("This setup link is invalid, expired or already used.");
      await connection.execute("UPDATE users SET password_hash = ?, status = 'active', must_change_password = 0, email_verified_at = NOW() WHERE id = ? AND status = 'pending_activation'", [hash, user.id]);
      await connection.execute("UPDATE account_activations SET consumed_at = NOW() WHERE user_id = ?", [user.id]);
      await audit(connection, user, "account_activated", "users", user.id, user);
    });
    return res.json({message: "Password saved and account activated. You can now sign in."});
  } catch (error) { return res.status(error instanceof DomainError ? error.status : 500).json({message: error instanceof DomainError ? error.message : "Unable to activate the account."}); }
});
router.post("/:id/resend", requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!["admin","super_admin"].includes(req.user!.role)) throw new DomainError("Administrator access required.", 403);
    await transaction(async connection => {
      const [rows] = await connection.query<any[]>("SELECT id, email, full_name, role, barangay_id, status FROM users WHERE id = ? AND archived_at IS NULL FOR UPDATE", [id]);
      const user = rows[0];
      if (!user || !["collector","purok_leader","resident"].includes(user.role) || (req.user!.role === "admin" && Number(user.barangay_id) !== Number(req.user!.barangay_id))) throw new DomainError("Account not found.", 404);
      if (user.status !== "pending_activation") throw new DomainError("This account is not awaiting password setup.", 409);
      const [recent] = await connection.query<any[]>("SELECT user_id FROM account_activations WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)", [id]);
      if (recent.length) throw new DomainError("Wait one minute before sending another setup link.", 429);
      await sendAccountActivation(connection, user);
      await audit(connection, req.user!, "activation_link_resent", "users", id, user);
    });
    return res.json({message: "A new setup link was sent. Previous links are invalid."});
  } catch (error) { return res.status(error instanceof DomainError ? error.status : 500).json({message: error instanceof DomainError ? error.message : "Unable to resend setup link."}); }
});
export default router;
