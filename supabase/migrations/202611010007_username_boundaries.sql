-- Avoid matching short offensive terms inside unrelated words such as Scunthorpe.
create or replace function public.username_allowed(value text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(value ~ '^[A-Za-z0-9_]{3,30}$' and
 regexp_replace(translate(lower(value),'01345789','oieastbg'),'_','','g') !~ 'fuck|shit|bitch|(^cunt|cunt$)|motherfucker|putangina|tangina|gago|tanga|ulol|putang|pakyu|(^puta|puta$)|puto|mierda|pendejo|cabron|cojones|joder|merde|putain|salope|connard|scheisse|arschloch|ficken|fotze|caralho|porra|buceta|cazzo|vaffanculo|stronzo|anjing|bangsat|kontol|memek|goblok|bhenchod|madarchod|chutiya|harami|orospu|siktir',false)
$$;
