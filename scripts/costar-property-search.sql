-- HAC-59: (re)build the slim site-search projection of costar_properties.
-- Only these fields and provenance entries are read by lib/data/sites.ts. Other provenance
-- keys equal {...source, field: key}, which the search derives itself.
DELETE FROM costar_property_search;
INSERT INTO costar_property_search (property_id, data)
SELECT id, jsonb_build_object(
  'buildingName', data->'buildingName',
  'primaryAddress', jsonb_build_object(
    'streetNumber', data->'primaryAddress'->'streetNumber',
    'streetDirection', data->'primaryAddress'->'streetDirection',
    'streetName', data->'primaryAddress'->'streetName',
    'streetType', data->'primaryAddress'->'streetType',
    'streetSuffix', data->'primaryAddress'->'streetSuffix'
  ),
  'propertyRetail', jsonb_build_object('frontage', data->'propertyRetail'->'frontage'),
  'parking', data->'parking',
  'parkingRatio', data->'parkingRatio',
  -- HAC-76: the scene API reads stories here instead of detoasting the full property blob.
  'numStoriesAboveGrade', data->'numStoriesAboveGrade',
  'provenance', jsonb_strip_nulls(jsonb_build_object(
    'city', data->'provenance'->'city',
    'latitude', data->'provenance'->'latitude',
    'longitude', data->'provenance'->'longitude',
    'buildingName', data->'provenance'->'buildingName',
    'parkingRatio', data->'provenance'->'parkingRatio'
  ))
)
FROM costar_properties;
