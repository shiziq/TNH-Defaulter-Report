-- ============================================================
-- TNH SACCO Debt Collector — Supabase schema
-- Run this in Supabase SQL Editor (Dashboard → SQL → New query).
-- Works with the anon/publishable key (Row Level Security allows all).
-- For production, tighten RLS (see bottom).
-- ============================================================

-- 1. Debtors (was localStorage STORAGE_KEY = tnh_debt_records_v3)
CREATE TABLE IF NOT EXISTS public.debtors (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  member_ref    text,
  national_id   text,
  phone         text,
  employment_status text,
  category      text DEFAULT '',
  status        text,
  loan_amount   numeric DEFAULT 0,
  deposits      numeric DEFAULT 0,
  outstanding   numeric DEFAULT 0,
  interview_date text,
  officer       text,
  compliance_level text,
  willingness_score integer DEFAULT 5,
  recommended_option text,
  notes         text,
  next_step     text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- 2. Payments (was PAYMENTS_KEY = tnh_payments_v1 ; stored as {debtorId: [payments]})
CREATE TABLE IF NOT EXISTS public.payments (
  id          text PRIMARY KEY,
  debtor_id   text NOT NULL REFERENCES public.debtors(id) ON DELETE CASCADE,
  amount      numeric DEFAULT 0,
  date        text,
  method      text,
  status      text,
  ref         text,
  note        text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_debtor ON public.payments(debtor_id);

-- 3. Attachments metadata (was ATTACHMENTS_KEY = tnh_attachments_v1)
--    File bytes live in Supabase Storage bucket "attachments".
CREATE TABLE IF NOT EXISTS public.attachments (
  id          text PRIMARY KEY,
  debtor_id   text NOT NULL REFERENCES public.debtors(id) ON DELETE CASCADE,
  name        text,
  size        bigint,
  type        text,
  storage_path text,            -- path inside the "attachments" bucket
  added       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attach_debtor ON public.attachments(debtor_id);

-- 4. Storage bucket for attachment files
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Realtime: enable publication for the three tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.debtors;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attachments;

-- ============================================================
-- Row Level Security — open for anon (simple, no auth).
-- NOTE: This is convenient for a quick deploy but allows anyone
-- with the anon key to read/write. Tighten before production:
--   - Enable Supabase Auth, require a session, and scope by user/role.
--   - Or restrict to your org's IP / use a service role server-side.
-- ============================================================
ALTER TABLE public.debtors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all_debtors"     ON public.debtors     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_payments"   ON public.payments    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_attachments" ON public.attachments FOR ALL USING (true) WITH CHECK (true);

-- Storage policy: allow anon to upload/read/delete in the attachments bucket
CREATE POLICY "attachments_all" ON storage.objects FOR ALL USING (bucket_id = 'attachments') WITH CHECK (bucket_id = 'attachments');
