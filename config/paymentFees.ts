import "./environment.js";
import { PAYMENT_CATEGORY_LABELS, type PaymentCategoryOption } from "../shared/paymentCategories.js";

function configuredFee(name: string, defaultAmount: number) {
  const raw = process.env[name]?.trim();
  const amount = raw ? Number(raw) : defaultAmount;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new Error(name + " must be a positive amount with at most two decimal places.");
  }
  return amount;
}

export const CATEGORY_AMOUNTS: Record<string, number> = {
  weekly_fee: configuredFee("PAYMENT_WEEKLY_FEE", 5),
  special_heavy_trash: configuredFee("PAYMENT_HEAVY_TRASH_FEE", 80),
  hazardous_disposal: configuredFee("PAYMENT_HAZARDOUS_FEE", 120),
};

export const paymentCategories: PaymentCategoryOption[] = Object.entries(PAYMENT_CATEGORY_LABELS).map(([value, label]) => ({
  value: value as PaymentCategoryOption["value"], label, amount: CATEGORY_AMOUNTS[value],
}));
