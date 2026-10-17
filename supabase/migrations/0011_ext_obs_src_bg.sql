-- Background (tracker) readings may be shared: allow src = 'bg'. The client only sends them under strict rules (see extension/background.js).
-- Every other rule stays: contribute flag, 500 rows/user/day, one row per user/product/day, >= reporters thresholds on read.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.ext_price_observations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%src%' loop
    execute format('alter table public.ext_price_observations drop constraint %I', c);
  end loop;
  alter table public.ext_price_observations add constraint ext_price_observations_src_check check (src in ('jsonld','dom','meta','bg'));
end $$;
