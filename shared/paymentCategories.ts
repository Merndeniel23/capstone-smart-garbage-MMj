export const PAYMENT_CATEGORY_LABELS = {
  weekly_fee: "Weekly Purok Maintenance Fee",
  special_heavy_trash: "Special Heavy Trash Pickup",
  hazardous_disposal: "Hazardous / E-Waste Disposal",
} as const;

export type PaymentCategoryOption = {
  value: keyof typeof PAYMENT_CATEGORY_LABELS;
  label: string;
  amount: number;
};
