// PostGIS spatial operations (raw SQL through Prisma)
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';

const PROPERTY_COLS = Prisma.sql`
  p.id, p.survey_number AS "surveyNumber", p.sub_division AS "subDivision", p.village, p.taluk,
  p.district, p.state, p.owner_name AS "ownerName", p.land_use AS "landUse", p.area_sqm AS "areaSqm",
  ST_AsGeoJSON(p.boundary)::json AS boundary,
  ST_AsGeoJSON(ST_Centroid(p.boundary))::json AS centroid`;

/** Save/replace a parcel boundary from GeoJSON Polygon. area_sqm is set by DB trigger. */
export async function setBoundary(propertyId, geojson) {
  await prisma.$executeRaw`
    UPDATE properties
       SET boundary = ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326))
     WHERE id = ${propertyId}`;
}

export async function getProperty(propertyId) {
  const rows = await prisma.$queryRaw`SELECT ${PROPERTY_COLS} FROM properties p WHERE p.id = ${propertyId}`;
  return rows[0] || null;
}

/** Look up a parcel by its land-record survey number. */
export async function findBySurveyNumber({ surveyNumber, subDivision, village, district }) {
  return prisma.$queryRaw`
    SELECT ${PROPERTY_COLS} FROM properties p
     WHERE p.survey_number = ${surveyNumber}
       AND (${subDivision ?? null}::text IS NULL OR p.sub_division = ${subDivision ?? null})
       AND (${village ?? null}::text IS NULL OR lower(p.village) = lower(${village ?? ''}))
       AND (${district ?? null}::text IS NULL OR lower(p.district) = lower(${district ?? ''}))`;
}

/** Which parcel contains this GPS point? */
export async function findByPoint(lon, lat) {
  return prisma.$queryRaw`
    SELECT ${PROPERTY_COLS} FROM properties p
     WHERE ST_Contains(p.boundary, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))`;
}

/** Parcels within `radiusM` metres of a point, nearest first. */
export async function findNearby(lon, lat, radiusM = 500) {
  return prisma.$queryRaw`
    SELECT ${PROPERTY_COLS},
           ST_Distance(p.boundary::geography, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) AS "distanceM"
      FROM properties p
     WHERE ST_DWithin(p.boundary::geography, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusM})
     ORDER BY "distanceM" ASC
     LIMIT 100`;
}

/** Adjacent parcels (sharing a boundary or within 2 m). */
export async function findNeighbours(propertyId) {
  return prisma.$queryRaw`
    SELECT n.id, n.survey_number AS "surveyNumber", n.sub_division AS "subDivision", n.owner_name AS "ownerName"
      FROM properties p JOIN properties n
        ON n.id <> p.id AND ST_DWithin(p.boundary::geography, n.boundary::geography, 2)
     WHERE p.id = ${propertyId}`;
}

export async function setRegionGeometry(regionId, geojson) {
  await prisma.$executeRaw`
    UPDATE change_regions SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326)
     WHERE id = ${regionId}`;
}

/**
 * Spatial audit of a detection's change regions against the parcel and all neighbours:
 * - area of each region inside the owner's parcel
 * - area spilling outside, and which other survey numbers it overlaps (encroachment)
 */
export async function encroachmentReport(detectionId) {
  return prisma.$queryRaw`
    SELECT r.id AS "regionId", r.type, r.area_sqm AS "areaSqm",
           ST_Area(ST_Intersection(r.geom, p.boundary)::geography) AS "insideSqm",
           ST_Area(ST_Difference(r.geom, p.boundary)::geography)   AS "outsideSqm",
           COALESCE((
             SELECT json_agg(json_build_object(
                      'propertyId', o.id, 'surveyNumber', o.survey_number, 'subDivision', o.sub_division,
                      'ownerName', o.owner_name,
                      'overlapSqm', round(ST_Area(ST_Intersection(r.geom, o.boundary)::geography)::numeric, 1)))
               FROM properties o
              WHERE o.id <> p.id AND ST_Intersects(r.geom, o.boundary)
           ), '[]'::json) AS "overlapsParcels",
           ST_AsGeoJSON(r.geom)::json AS geometry
      FROM change_regions r
      JOIN change_detections d ON d.id = r.detection_id
      JOIN properties p ON p.id = d.property_id
     WHERE r.detection_id = ${detectionId} AND r.geom IS NOT NULL
       AND ST_Intersects(r.geom, p.boundary)   -- only changes originating on this parcel`;
}

/** All parcels as a GeoJSON FeatureCollection (for the map), with open-alert counts. */
export async function propertiesFeatureCollection({ district, village } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.survey_number, p.sub_division, p.village, p.district, p.owner_name, p.land_use, p.area_sqm,
           ST_AsGeoJSON(p.boundary)::json AS geometry,
           (SELECT count(*)::int FROM alerts a WHERE a.property_id = p.id AND a.status = 'OPEN') AS open_alerts,
           (SELECT max(a.severity)::text FROM alerts a WHERE a.property_id = p.id AND a.status = 'OPEN') AS max_severity
      FROM properties p
     WHERE p.boundary IS NOT NULL
       AND (${district ?? null}::text IS NULL OR lower(p.district) = lower(${district ?? ''}))
       AND (${village ?? null}::text IS NULL OR lower(p.village) = lower(${village ?? ''}))`;
  return {
    type: 'FeatureCollection',
    features: rows.map(({ geometry, ...props }) => ({ type: 'Feature', geometry, properties: props })),
  };
}
