-- Sprint 1: identities, immutable prescriptions and patient-scoped records.
create table public.profiles (
 id uuid primary key references auth.users(id), display_name text not null default '',
 locale text not null default 'en' check(locale in ('en','fil')), active boolean not null default true
);
create table public.user_roles (
 user_id uuid references public.profiles(id), role text check(role in ('patient','therapist','admin')), primary key(user_id,role)
);
create table public.patients (id uuid primary key references public.profiles(id), created_at timestamptz not null default now());
create table public.therapist_patients (
 therapist_id uuid references public.profiles(id), patient_id uuid references public.patients(id),
 active boolean not null default true, assigned_by uuid references public.profiles(id), primary key(therapist_id,patient_id)
);
create table public.exercises (id uuid primary key default gen_random_uuid(), code text unique not null, active boolean not null default false);
create table public.exercise_versions (
 id uuid primary key default gen_random_uuid(), exercise_id uuid not null references public.exercises(id),
 version integer not null check(version>0), algorithm_key text not null, definition jsonb not null check(jsonb_typeof(definition)='object'),
 published boolean not null default false, created_at timestamptz not null default now(), unique(exercise_id,version)
);
create table public.exercise_assignments (
 id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id),
 therapist_id uuid not null references public.profiles(id), active boolean not null default true,
 created_at timestamptz not null default now(), unique(id,patient_id),
 foreign key(therapist_id,patient_id) references public.therapist_patients(therapist_id,patient_id)
);
create table public.prescription_versions (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null, patient_id uuid not null,
 exercise_version_id uuid not null references public.exercise_versions(id), version integer not null check(version>0),
 side text not null check(side in ('left','right','bilateral')), minimum_degrees numeric not null,
 maximum_degrees numeric not null, target_repetitions integer not null check(target_repetitions>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 check(minimum_degrees < maximum_degrees and minimum_degrees > '-Infinity'::numeric and maximum_degrees < 'Infinity'::numeric),
 unique(assignment_id,version), unique(id,patient_id),
 foreign key(assignment_id,patient_id) references public.exercise_assignments(id,patient_id)
);
create table public.sessions (
 id uuid primary key, patient_id uuid not null references public.patients(id), prescription_version_id uuid not null,
 started_at timestamptz not null, ended_at timestamptz not null, status text not null check(status in ('completed','interrupted')),
 app_version text not null, model_version text not null, algorithm_version text not null,
 check(ended_at>=started_at), unique(id,patient_id),
 foreign key(prescription_version_id,patient_id) references public.prescription_versions(id,patient_id)
);
create table public.session_measurements (
 session_id uuid not null references public.sessions(id), metric_key text not null,
 side text not null check(side in ('left','right','bilateral')), minimum_degrees numeric not null, maximum_degrees numeric not null,
 rom_degrees numeric generated always as (maximum_degrees-minimum_degrees) stored,
 completed_repetitions integer not null check(completed_repetitions>=0), incomplete_repetitions integer not null default 0 check(incomplete_repetitions>=0),
 quality text not null check(quality in ('valid','limited','invalid')),
 primary key(session_id,metric_key),
 check(minimum_degrees<=maximum_degrees and minimum_degrees > '-Infinity'::numeric and maximum_degrees < 'Infinity'::numeric)
);
create table public.consents (
 id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id),
 consent_type text not null, version text not null, event text not null check(event in ('granted','withdrawn')), recorded_at timestamptz not null default now()
);
create table public.audit_events (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null,
 target_type text not null, target_id text not null, recorded_at timestamptz not null default now()
);
create index links_patient_active on public.therapist_patients(patient_id,therapist_id) where active;
create index assignments_patient_active on public.exercise_assignments(patient_id) where active;
create index sessions_patient_time on public.sessions(patient_id,started_at desc);
create index consents_patient_time on public.consents(patient_id,recorded_at desc);

create function public.is_active_user() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active)
$$;
create function public.has_role(wanted text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(select 1 from public.user_roles where user_id=auth.uid() and role=wanted)
$$;
create function public.can_read_patient(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and (target=auth.uid() or public.has_role('admin') or
 (public.has_role('therapist') and exists(select 1 from public.therapist_patients where therapist_id=auth.uid() and patient_id=target and active)))
$$;
create function public.can_prescribe(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_role('therapist') and exists(select 1 from public.therapist_patients where therapist_id=auth.uid() and patient_id=target and active)
$$;
create function public.on_user_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id) values(new.id);
 -- Ignore role claims in signup metadata; only trusted backend provisioning adds staff.
 insert into public.user_roles(user_id,role) values(new.id,'patient');
 insert into public.patients(id) values(new.id);
 return new;
end $$;
create trigger provision_patient after insert on auth.users for each row execute function public.on_user_created();
create function public.reject_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Historical records are immutable; append a new version or event'; end $$;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

alter table public.patients enable row level security;
revoke all on public.patients from anon, authenticated;
grant select on public.patients to authenticated;

alter table public.therapist_patients enable row level security;
revoke all on public.therapist_patients from anon, authenticated;
grant select on public.therapist_patients to authenticated;

alter table public.exercises enable row level security;
revoke all on public.exercises from anon, authenticated;
grant select on public.exercises to authenticated;

alter table public.exercise_versions enable row level security;
revoke all on public.exercise_versions from anon, authenticated;
grant select on public.exercise_versions to authenticated;

alter table public.exercise_assignments enable row level security;
revoke all on public.exercise_assignments from anon, authenticated;
grant select on public.exercise_assignments to authenticated;

alter table public.prescription_versions enable row level security;
revoke all on public.prescription_versions from anon, authenticated;
grant select on public.prescription_versions to authenticated;

alter table public.sessions enable row level security;
revoke all on public.sessions from anon, authenticated;
grant select on public.sessions to authenticated;

alter table public.session_measurements enable row level security;
revoke all on public.session_measurements from anon, authenticated;
grant select on public.session_measurements to authenticated;

alter table public.consents enable row level security;
revoke all on public.consents from anon, authenticated;
grant select on public.consents to authenticated;

alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
create trigger immutable_exercise_versions before update or delete on public.exercise_versions for each row execute function public.reject_mutation();
create trigger immutable_prescription_versions before update or delete on public.prescription_versions for each row execute function public.reject_mutation();
create trigger immutable_sessions before update or delete on public.sessions for each row execute function public.reject_mutation();
create trigger immutable_session_measurements before update or delete on public.session_measurements for each row execute function public.reject_mutation();
create trigger immutable_consents before update or delete on public.consents for each row execute function public.reject_mutation();
create trigger immutable_audit_events before update or delete on public.audit_events for each row execute function public.reject_mutation();

create policy own_profile on public.profiles for select to authenticated using(public.can_read_patient(id));
grant update(display_name,locale) on public.profiles to authenticated;
create policy edit_profile on public.profiles for update to authenticated using(id=auth.uid() and public.is_active_user()) with check(id=auth.uid() and public.is_active_user());
create policy own_roles on public.user_roles for select to authenticated using(public.is_active_user() and (user_id=auth.uid() or public.has_role('admin')));
create policy patients_read on public.patients for select to authenticated using(public.can_read_patient(id));
create policy links_read on public.therapist_patients for select to authenticated using(public.is_active_user() and (patient_id=auth.uid() or therapist_id=auth.uid() or public.has_role('admin')));
create policy exercises_read on public.exercises for select to authenticated using(public.is_active_user() and active);
create policy versions_read on public.exercise_versions for select to authenticated using(public.is_active_user() and published);
create policy assignments_read on public.exercise_assignments for select to authenticated using(public.can_read_patient(patient_id));
grant insert on public.exercise_assignments to authenticated;
create policy assignments_insert on public.exercise_assignments for insert to authenticated with check(therapist_id=auth.uid() and public.can_prescribe(patient_id));
create policy prescriptions_read on public.prescription_versions for select to authenticated using(public.can_read_patient(patient_id));
grant insert on public.prescription_versions to authenticated;
create policy prescriptions_insert on public.prescription_versions for insert to authenticated with check(created_by=auth.uid() and public.can_prescribe(patient_id) and exists(select 1 from public.exercise_assignments a where a.id=assignment_id and a.therapist_id=auth.uid() and a.active) and exists(select 1 from public.exercise_versions e where e.id=exercise_version_id and e.published));
create policy sessions_read on public.sessions for select to authenticated using(public.can_read_patient(patient_id));
grant insert on public.sessions to authenticated;
create policy sessions_insert on public.sessions for insert to authenticated with check(patient_id=auth.uid() and public.is_active_user());
create policy measurements_read on public.session_measurements for select to authenticated using(exists(select 1 from public.sessions s where s.id=session_id and public.can_read_patient(s.patient_id)));
grant insert on public.session_measurements to authenticated;
create policy measurements_insert on public.session_measurements for insert to authenticated with check(public.is_active_user() and exists(select 1 from public.sessions s where s.id=session_id and s.patient_id=auth.uid()));
create policy consents_read on public.consents for select to authenticated using(public.can_read_patient(patient_id));
grant insert on public.consents to authenticated;
create policy consents_insert on public.consents for insert to authenticated with check(patient_id=auth.uid() and public.is_active_user());
create policy audit_read on public.audit_events for select to authenticated using(public.has_role('admin'));
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_active_user(),public.has_role(text),public.can_read_patient(uuid),public.can_prescribe(uuid) to authenticated;
