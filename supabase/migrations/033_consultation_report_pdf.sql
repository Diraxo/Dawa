-- Adds a column to persist the path of the generated branded PDF consultation
-- report inside the (new) consultation-reports storage bucket.

alter table public.consultation_summaries
  add column if not exists report_pdf_path text;
