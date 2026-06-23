-- Migration: add date_of_birth and gender to doctor_profiles
alter table public.doctor_profiles
  add column if not exists date_of_birth date,
  add column if not exists gender text check (gender in ('Male', 'Female'));
