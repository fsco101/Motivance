-- Append bilingual engineering definitions. Never rewrite a published version/prescription.
insert into public.exercise_versions(exercise_id,version,algorithm_key,definition,published)
select v.exercise_id,2,v.algorithm_key,v.definition || jsonb_build_object('instructions_fil',
 case v.algorithm_key when 'elbow-flexion-v1' then
 'Ilagay ang camera sa gilid sa isang matatag na patungan. Panatilihing nakikita ang napiling balikat, siko, pulsuhan at balakang. Magsimula nang komportableng tuwid ang braso; ibaluktot at ibalik ito ayon sa itinakdang target.'
 else 'Humarap sa camera na nasa matatag na patungan. Panatilihing nakikita ang balakang, balikat at siko. Magsimula nang nasa tagiliran ang braso; itaas at ibaba ito ayon sa itinakdang target. Panatilihing tuwid ang katawan.' end),true
from public.exercise_versions v
where v.id in ('21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002')
and not exists(select 1 from public.exercise_versions newer where newer.exercise_id=v.exercise_id and newer.version>=2);
