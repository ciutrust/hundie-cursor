-- Before-user-created Auth Hook: only Alex and Claudia may obtain a JWT.
-- Emails are hardcoded in this function (no table, no PostgREST/service-role write path).
-- Enable in Dashboard → Authentication → Hooks → Before User Created →
--   pg-functions://postgres/public/hook_restrict_signup_to_allowed_operators
-- IDEMPOTENT: create-or-replace + grant/revoke.

create or replace function public.hook_restrict_signup_to_allowed_operators(event jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  email text;
begin
  email := lower(trim(coalesce(event->'user'->>'email', '')));

  if email in ('alexbhp@gmail.com', 'clauciun@gmail.com') then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This application is limited to invited operators.',
      'http_code', 403
    )
  );
end;
$$;

grant execute
  on function public.hook_restrict_signup_to_allowed_operators(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.hook_restrict_signup_to_allowed_operators(jsonb)
  from public, anon, authenticated, service_role;
