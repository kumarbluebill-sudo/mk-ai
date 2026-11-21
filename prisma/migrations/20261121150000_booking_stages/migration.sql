-- RESERVED: a supplier hold exists but nothing is confirmed or charged.
-- PENDING_SUPPLIER: the supplier has the request but has not confirmed it (on-request inventory).
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'RESERVED';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PENDING_SUPPLIER';
