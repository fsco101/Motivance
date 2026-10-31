-- Synthetic catalogue only. No patient records, real emails or passwords.
insert into public.exercises(id,code,active) values('10000000-0000-0000-0000-000000000001','elbow-flexion-draft',false);
insert into public.exercise_versions(exercise_id,version,algorithm_key,definition,published)
values('10000000-0000-0000-0000-000000000001',1,'elbow-flexion-draft','{"status":"therapist-review-required","joints":["shoulder","elbow","wrist"],"measurement":"2D included angle; not anatomical ROM until reviewed"}',false);
