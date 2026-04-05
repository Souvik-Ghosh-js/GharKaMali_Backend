-- Update Payments table to include missing transaction tracking columns
ALTER TABLE payments ADD COLUMN IF NOT EXISTS txn_id VARCHAR(100) AFTER transaction_id;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_for VARCHAR(100) AFTER txn_id;
