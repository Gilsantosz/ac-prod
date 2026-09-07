BEGIN READ ONLY; SET LOCAL search_path=''; SET LOCAL statement_timeout='15s';
select format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.oidvectortypes(p.proargtypes)) identity,
format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)) catalog_identity,
encode(sha256(convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256,
(select jsonb_agg(jsonb_build_object('refclass',d.refclassid::regclass::text,'reference',pg_catalog.pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'dependency',d.deptype) order by d.refclassid,d.refobjid,d.refobjsubid) from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid) dependencies
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind in ('f','p')
and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
order by identity;COMMIT;
