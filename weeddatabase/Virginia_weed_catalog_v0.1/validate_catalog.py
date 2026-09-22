import json,pathlib,sys,collections
from jsonschema import Draft202012Validator,FormatChecker
p=pathlib.Path(__file__).parent
c=json.loads((p/'catalog.json').read_text());schema=json.loads((p/'schema/catalog.schema.json').read_text());sources=json.loads((p/'sources.json').read_text());cover=json.loads((p/'coverage.json').read_text())
Draft202012Validator.check_schema(schema)
errors=[f'{list(e.path)}: {e.message}' for e in Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(c)]
ids=[r['catalog_id'] for r in c['records']]
if len(ids)!=len(set(ids)):errors.append('duplicate catalog_id')
for r in c['records']:
 for sid in r['source_ids']:
  if sid not in sources:errors.append(f"{r['catalog_id']}: unknown source {sid}")
 for ev in r['crop_evidence']:
  if ev['source_id'] not in r['source_ids']:errors.append(f"{r['catalog_id']}: crop evidence not in source_ids")
 if r['regulatory'] and r['regulatory']['tier']=='Tier 1' and r['usda_virginia']['status']=='matched':
  errors.append(f"{r['catalog_id']}: Tier 1 must not imply state presence")
 if r['catalog_status']=='crop_context_sourced' and not r['crop_evidence']:errors.append(f"{r['catalog_id']}: unsupported crop status")
if cover['total_catalog_records']!=len(c['records']):errors.append('coverage count mismatch')
if cover['vt_source_records']!=sum(bool(r['vt_profile_url']) for r in c['records']):errors.append('VT source count mismatch')
if cover['crop_context_sourced']!=sum(bool(r['crop_evidence']) for r in c['records']):errors.append('crop context count mismatch')
if cover['regulatory_list_entries']!=sum(bool(r['regulatory']) for r in c['records']):errors.append('regulatory count mismatch')
if any(r['aerial_identification_validated'] for r in c['records']):errors.append('unvalidated aerial identification claim')
if any(r['catalog_status']=='source_index_only' and r['crop_evidence'] for r in c['records']):errors.append('crop evidence left in source-only status')
if 'profiles_checked' in cover and cover['profiles_checked']+cover['profiles_failed']!=cover['vt_source_records']:errors.append('profile review count mismatch')
if errors:
 print('\n'.join(errors),file=sys.stderr);sys.exit(1)
print(f"PASS: {len(ids)} catalog records, {len(sources)} registered sources")
