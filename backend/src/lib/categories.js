const CANONICAL_CATEGORIES = [
  'Income',
  'Groceries',
  'EatingOut',
  'Utilities',
  'RentMortgage',
  'Transport',
  'Fuel',
  'Entertainment',
  'Subscriptions',
  'Health',
  'Insurance',
  'Education',
  'Travel',
  'Cash',
  'Transfers',
  'DebtRepayment',
  'Fees',
  'GiftsDonations',
  'Childcare',
  'Home',
  'Shopping',
  'Misc',
];

function normaliseCategory(input) {
  if (!input) return 'Misc';
  const probe = String(input).trim().toLowerCase();
  const match = CANONICAL_CATEGORIES.find((category) => category.toLowerCase() === probe);
  return match || 'Misc';
}

module.exports = { CANONICAL_CATEGORIES, normaliseCategory };
