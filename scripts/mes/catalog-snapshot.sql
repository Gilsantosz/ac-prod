-- Read-only catalog evidence. No application rows, sequence values or secret values.
-- Definitions are evidence, NOT an executable migration or pg_dump replacement.
-- Change the final kind filter to page large results; retain identical snapshot metadata.
BEGIN READ ONLY;
SET LOCAL search_path = '';
SET LOCAL statement_timeout = '15s';
WITH relations AS (
  SELECT c.*, n.nspname FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S','f')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
), routines AS (
  SELECT p.*, n.nspname FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
), objects AS (
  SELECT 'schema'::text AS kind, n.nspname::text AS identity,
    jsonb_build_object('name',n.nspname,'owner',pg_catalog.pg_get_userbyid(n.nspowner),'acl',n.nspacl) AS definition
  FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public','private')
  UNION ALL
  SELECT 'extension', e.extname, jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion,'relocatable',e.extrelocatable)
  FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
  UNION ALL
  SELECT 'relation', format('%I.%I',r.nspname,r.relname), jsonb_build_object(
    'schema',r.nspname,'name',r.relname,'kind',r.relkind,'owner',pg_catalog.pg_get_userbyid(r.relowner),
    'acl',r.relacl,'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'options',r.reloptions,
    'replica_identity',r.relreplident,'persistence',r.relpersistence,
    'partition_key',CASE WHEN r.relkind='p' THEN pg_catalog.pg_get_partkeydef(r.oid) END,
    'partition_bound',pg_catalog.pg_get_expr(r.relpartbound,r.oid),
    'parents',(SELECT jsonb_agg(format('%I.%I',pn.nspname,pc.relname) ORDER BY i.inhseqno) FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class pc ON pc.oid=i.inhparent JOIN pg_catalog.pg_namespace pn ON pn.oid=pc.relnamespace WHERE i.inhrelid=r.oid),
    'view_definition',CASE WHEN r.relkind IN ('v','m') THEN pg_catalog.pg_get_viewdef(r.oid,false) END,
    'columns',coalesce((SELECT jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,
      'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'identity',a.attidentity,'generated',a.attgenerated,
      'default',pg_catalog.pg_get_expr(ad.adbin,ad.adrelid,false),
      'collation',CASE WHEN a.attcollation<>0 THEN format('%I.%I',cn.nspname,coll.collname) END,
      'acl',a.attacl) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      LEFT JOIN pg_catalog.pg_collation coll ON coll.oid=a.attcollation LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=coll.collnamespace
      WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb))
  FROM relations r
  UNION ALL
  SELECT 'constraint',format('%I.%I.%I',r.nspname,r.relname,c.conname),jsonb_build_object(
    'relation',format('%I.%I',r.nspname,r.relname),'name',c.conname,'kind',c.contype,
    'definition',pg_catalog.pg_get_constraintdef(c.oid,false),'validated',c.convalidated,
    'deferrable',c.condeferrable,'deferred',c.condeferred)
  FROM pg_catalog.pg_constraint c JOIN relations r ON r.oid=c.conrelid
  UNION ALL
  SELECT 'index',format('%I.%I',r.nspname,ic.relname),jsonb_build_object(
    'relation',format('%I.%I',r.nspname,r.relname),'name',ic.relname,
    'definition',pg_catalog.pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,
    'constraint_owned',EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conindid=i.indexrelid))
  FROM pg_catalog.pg_index i JOIN relations r ON r.oid=i.indrelid JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
  UNION ALL
  SELECT 'routine',format('%I.%I(%s)',p.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)),jsonb_build_object(
    'schema',p.nspname,'name',p.proname,'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),
    'kind',p.prokind,'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',p.proacl,
    'security_definer',p.prosecdef,'config',p.proconfig,'language',l.lanname,
    'definition',pg_catalog.pg_get_functiondef(p.oid))
  FROM routines p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  UNION ALL
  SELECT 'trigger',format('%I.%I.%I',r.nspname,r.relname,t.tgname),jsonb_build_object(
    'relation',format('%I.%I',r.nspname,r.relname),'name',t.tgname,'enabled',t.tgenabled,
    'definition',pg_catalog.pg_get_triggerdef(t.oid,false))
  FROM pg_catalog.pg_trigger t JOIN relations r ON r.oid=t.tgrelid WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'policy',format('%I.%I.%I',n.nspname,c.relname,p.polname),jsonb_build_object(
    'relation',format('%I.%I',n.nspname,c.relname),'name',p.polname,'permissive',p.polpermissive,
    'command',p.polcmd,'roles',(SELECT jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid) END ORDER BY role_oid) FROM unnest(p.polroles) role_oid),
    'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid,false),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,false))
  FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','private') OR (n.nspname='realtime' AND c.relname='messages')
  UNION ALL
  SELECT 'sequence',format('%I.%I',r.nspname,r.relname),jsonb_build_object(
    'type',pg_catalog.format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,
    'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle,
    'owned_by',(SELECT jsonb_agg(jsonb_build_object('relation',format('%I.%I',n.nspname,c.relname),'column',a.attname,'dependency',d.deptype))
      FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class c ON c.oid=d.refobjid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.refobjsubid
      WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=r.oid AND d.deptype IN ('a','i')))
  FROM pg_catalog.pg_sequence s JOIN relations r ON r.oid=s.seqrelid
  UNION ALL
  SELECT 'type',format('%I.%I',n.nspname,t.typname),jsonb_build_object('schema',n.nspname,'name',t.typname,
    'kind',t.typtype,'owner',pg_catalog.pg_get_userbyid(t.typowner),'acl',t.typacl,
    'base',CASE WHEN t.typbasetype<>0 THEN pg_catalog.format_type(t.typbasetype,t.typtypmod) END,
    'not_null',t.typnotnull,'default',t.typdefault,
    'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_catalog.pg_get_constraintdef(c.oid,false)) ORDER BY c.conname) FROM pg_catalog.pg_constraint c WHERE c.contypid=t.oid))
  FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname IN ('public','private') AND t.typtype IN ('e','d','r','m')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')
  UNION ALL
  SELECT 'default_acl',format('%s:%s:%s',pg_catalog.pg_get_userbyid(a.defaclrole),coalesce(n.nspname,''),a.defaclobjtype),
    jsonb_build_object('owner',pg_catalog.pg_get_userbyid(a.defaclrole),'schema',n.nspname,'object_type',a.defaclobjtype,'acl',a.defaclacl)
  FROM pg_catalog.pg_default_acl a LEFT JOIN pg_catalog.pg_namespace n ON n.oid=a.defaclnamespace
  WHERE n.nspname IN ('public','private') OR a.defaclnamespace=0
  UNION ALL
  SELECT 'publication',p.pubname,jsonb_build_object('name',p.pubname,'owner',pg_catalog.pg_get_userbyid(p.pubowner),
    'all_tables',p.puballtables,'insert',p.pubinsert,'update',p.pubupdate,'delete',p.pubdelete,'truncate',p.pubtruncate,
    'via_root',p.pubviaroot,'members',(SELECT jsonb_agg(jsonb_build_object('schema',t.schemaname,'table',t.tablename,'columns',t.attnames,'filter',t.rowfilter) ORDER BY t.schemaname,t.tablename) FROM pg_catalog.pg_publication_tables t WHERE t.pubname=p.pubname))
  FROM pg_catalog.pg_publication p
), screened AS (
  SELECT *, definition::text ~* '(eyJ[A-Za-z0-9_-]{12,}[.][A-Za-z0-9_-]+[.]|sb_secret_[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,})' AS sensitive_literal
  FROM objects
)
SELECT kind, identity,
  encode(sha256(convert_to(definition::text,'UTF8')),'hex') AS catalog_sha256,
  CASE WHEN sensitive_literal THEN NULL ELSE definition END AS definition,
  sensitive_literal AS definition_withheld,
  jsonb_build_object('production_reference',definition::text LIKE '%uozuzdfvnufsjsonswag%',
    'external_or_secret_dependency',definition::text ~* '(vault[.]|net[.]http|cron[.]|dblink)') AS risks
FROM screened
WHERE true -- PAGE_FILTER
ORDER BY kind, identity;
COMMIT;
