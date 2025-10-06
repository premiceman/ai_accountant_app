#!/usr/bin/env node
/* eslint-disable no-console */
try {
  require('dotenv').config();
} catch (err) {
  console.warn('⚠️  dotenv not installed; proceeding without loading .env');
}

process.env.PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

function loadAccountsSeed() {
  try {
    // eslint-disable-next-line global-require
    const { accounts } = require('../data/accounts.json');
    return Array.isArray(accounts) ? accounts : [];
  } catch (err) {
    console.warn('⚠️  Could not load accounts seed:', err.message);
    return [];
  }
}

function parseArgs(argv) {
  const args = { dataset: 'default' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--user' || arg === '-u') {
      args.user = argv[i + 1];
      i += 1;
    } else if (arg === '--userId') {
      args.userId = argv[i + 1];
      i += 1;
    } else if (arg === '--dataset') {
      args.dataset = argv[i + 1] || 'default';
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

async function resolveUser(models, { user, userId }) {
  const { User } = models;
  if (userId) {
    const byId = await User.findById(userId);
    if (!byId) throw new Error(`No user found with id ${userId}`);
    return byId;
  }
  if (!user) throw new Error('Provide --user <email> or --userId <id>');
  const byEmail = await User.findOne({ email: user });
  if (!byEmail) throw new Error(`No user found with email ${user}`);
  return byEmail;
}

async function resetForUser(models, targetUser) {
  const { PlaidItem, Transaction } = models;
  await PlaidItem.deleteMany({ userId: targetUser._id });
  await Transaction.deleteMany({ userId: targetUser._id });
}

async function seedItemForUser(models, targetUser, dataset) {
  const { PlaidItem, syncTransactionsForItem, encrypt } = models;
  const accountsSeed = loadAccountsSeed();
  const now = Date.now();
  const item = new PlaidItem({
    userId: targetUser._id,
    plaidItemId: `sandbox-${dataset}-${now}`,
    accessToken: encrypt(`sandbox-token-${dataset}-${now}`),
    institution: {
      id: `sandbox-${dataset}`,
      name: 'Sandbox Bank',
    },
    accounts: accountsSeed.map((account) => ({
      accountId: account.id,
      name: account.name,
      officialName: account.name,
      mask: account.id ? String(account.id).slice(-4) : null,
      subtype: account.type,
      type: account.type,
      balances: { current: account.balance, available: account.balance },
      currency: 'GBP',
    })),
    status: { code: 'sandbox', description: 'Seeded sandbox item' },
    lastSyncedAt: new Date(),
  });
  await item.save();
  await syncTransactionsForItem(item, { force: true });
  return item;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/plaidSandboxFixtures.js --user <email> [--dataset default]');
    process.exit(0);
  }

  const mongoose = require('mongoose');
  const PlaidItem = require('../backend/models/PlaidItem');
  const Transaction = require('../backend/models/Transaction');
  const User = require('../backend/models/User');
  const { encrypt } = require('../backend/utils/secure');
  const { syncTransactionsForItem } = require('../backend/services/plaidSyncWorker');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai_accountant_app';
  await mongoose.connect(mongoUri);

  try {
    const targetUser = await resolveUser({ User }, args);
    console.log(`Resetting Plaid sandbox data for ${targetUser.email}`);
    await resetForUser({ PlaidItem, Transaction }, targetUser);
    const item = await seedItemForUser({ PlaidItem, syncTransactionsForItem, encrypt }, targetUser, args.dataset);
    console.log(`Seeded sandbox item ${item.plaidItemId} with ${item.accounts.length} accounts`);
  } catch (err) {
    console.error('Failed to seed sandbox data:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}
