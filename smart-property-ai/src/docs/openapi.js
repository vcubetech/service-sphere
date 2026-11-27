// OpenAPI 3.0 spec for the Smart Property AI REST API.
// Served as JSON at /api/openapi.json and rendered by Swagger UI at /api/docs.
// Keep in sync with src/routes/* (request shapes mirror the zod schemas there).

const id = (name, description) => ({ name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' } });
const q = (name, description, schema = { type: 'string' }, required = false) => ({ name, in: 'query', required, description, schema });
const json = (schema, example) => ({ content: { 'application/json': { schema, ...(example && { example }) } } });
const ok = (description, schema = { type: 'object' }) => ({ description, ...json(schema) });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const err = (description) => ({ description, ...json(ref('Error')) });

const E400 = err('Validation failed');
const E404 = err('Not found');

const enums = {
  LandUse: ['RESIDENTIAL', 'COMMERCIAL', 'AGRICULTURAL', 'INDUSTRIAL', 'GOVERNMENT', 'VACANT'],
  AlertStatus: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'],
  Severity: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  ProjectStatus: ['PLANNED', 'IN_PROGRESS', 'STALLED', 'COMPLETED'],
};

const PairBody = {
  required: false,
  ...json(ref('ImagePairInput'), {}),
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Smart Property AI API',
    version: '1.0.0',
    description:
      'Satellite change detection, construction monitoring, survey-number parcels and agentic AI alerts.\n\n' +
      '**Tip:** call `GET /api/properties` first and copy a parcel `id` for the `{id}` parameters. ' +
      'The seeded parcel with alerts is **Sy. No. 123/4** (Yelahanka).\n\n' +
      '`POST /api/agent/chat` requires `OPENAI_API_KEY`; everything else works in rules-only mode.',
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'System', description: 'Health and dashboard' },
    { name: 'Properties', description: 'Survey-number parcels (PostGIS)' },
    { name: 'Images', description: 'Satellite / drone imagery' },
    { name: 'Detection & AI scan', description: 'Change detection and the LangGraph monitoring agent' },
    { name: 'Construction', description: 'Permit projects and progress vs plan' },
    { name: 'Alerts', description: 'AI alerts' },
    { name: 'Knowledge (RAG)', description: 'Regulation documents in pgvector' },
    { name: 'AI Assistant', description: 'ReAct agent chat (needs LLM)' },
  ],
  paths: {
    // ---- System -------------------------------------------------------------
    '/api/health': {
      get: {
        tags: ['System'], summary: 'Health check and LLM mode',
        responses: { 200: ok('OK', { type: 'object', properties: { ok: { type: 'boolean' }, llm: { type: 'string' } } }) },
      },
    },
    '/api/dashboard/stats': {
      get: {
        tags: ['System'], summary: 'Counts, open alerts by severity/type, projects by status',
        responses: { 200: ok('Dashboard stats', ref('DashboardStats')) },
      },
    },

    // ---- Properties ---------------------------------------------------------
    '/api/properties': {
      get: {
        tags: ['Properties'], summary: 'List parcels (max 500)',
        parameters: [
          q('district', 'Exact district (case-insensitive)'),
          q('village', 'Exact village (case-insensitive)'),
          q('landUse', 'Land use', { type: 'string', enum: enums.LandUse }),
          q('q', 'Search survey number or owner name'),
        ],
        responses: { 200: ok('Parcels', { type: 'array', items: ref('Property') }) },
      },
      post: {
        tags: ['Properties'], summary: 'Create a parcel',
        requestBody: {
          required: true,
          ...json(ref('PropertyInput'), {
            surveyNumber: '210', subDivision: '2', village: 'Jakkur', taluk: 'Yelahanka',
            district: 'Bengaluru Urban', state: 'Karnataka', ownerName: 'Anita Rao', landUse: 'RESIDENTIAL',
            boundary: { type: 'Polygon', coordinates: [[[77.6001, 12.9801], [77.6004, 12.9801], [77.6004, 12.9804], [77.6001, 12.9804], [77.6001, 12.9801]]] },
          }),
        },
        responses: { 201: ok('Created', ref('Property')), 400: E400, 409: err('Duplicate survey key') },
      },
    },
    '/api/properties/geojson': {
      get: {
        tags: ['Properties'], summary: 'All parcels as a GeoJSON FeatureCollection (with open-alert severity)',
        parameters: [q('district', 'Filter by district'), q('village', 'Filter by village')],
        responses: { 200: ok('FeatureCollection') },
      },
    },
    '/api/properties/survey/{surveyNumber}': {
      get: {
        tags: ['Properties'], summary: 'Survey-number lookup',
        parameters: [
          { name: 'surveyNumber', in: 'path', required: true, schema: { type: 'string' }, example: '123' },
          { ...q('subDivision', 'Sub-division, e.g. 4'), example: '4' },
          { ...q('village', 'Village (case-insensitive)'), example: 'Yelahanka' },
          q('district', 'District (case-insensitive)'),
        ],
        responses: { 200: ok('Matching parcels', { type: 'array', items: ref('Property') }), 404: E404 },
      },
    },
    '/api/properties/at': {
      get: {
        tags: ['Properties'], summary: 'Parcel containing a GPS point, or parcels within a radius',
        parameters: [
          { ...q('lon', 'Longitude (EPSG:4326)', { type: 'number' }, true), example: 77.59075 },
          { ...q('lat', 'Latitude (EPSG:4326)', { type: 'number' }, true), example: 12.97075 },
          q('radius', 'If set, return parcels within this many metres (sorted by distance)', { type: 'number' }),
        ],
        responses: { 200: ok('Parcels', { type: 'array', items: ref('Property') }), 400: E400 },
      },
    },
    '/api/properties/{id}': {
      get: {
        tags: ['Properties'], summary: 'Parcel detail with neighbours, open alerts and projects',
        parameters: [id('id', 'Property id')],
        responses: { 200: ok('Property detail'), 404: E404 },
      },
      patch: {
        tags: ['Properties'], summary: 'Update a parcel (any subset of fields)',
        parameters: [id('id', 'Property id')],
        requestBody: { required: true, ...json(ref('PropertyInput'), { ownerContact: '+91 98450 00000' }) },
        responses: { 200: ok('Updated', ref('Property')), 400: E400, 404: E404 },
      },
      delete: {
        tags: ['Properties'], summary: 'Delete a parcel (cascades to images, detections, alerts)',
        parameters: [id('id', 'Property id')],
        responses: { 204: { description: 'Deleted' }, 404: E404 },
      },
    },

    // ---- Images -------------------------------------------------------------
    '/api/properties/{id}/images': {
      get: {
        tags: ['Images'], summary: 'Image timeline for a parcel',
        parameters: [id('id', 'Property id')],
        responses: { 200: ok('Images', { type: 'array', items: ref('SatelliteImage') }) },
      },
      post: {
        tags: ['Images'], summary: 'Upload a satellite / drone image with its geographic extent',
        parameters: [id('id', 'Property id')],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['image', 'capturedAt', 'minLon', 'minLat', 'maxLon', 'maxLat'],
                properties: {
                  image: { type: 'string', format: 'binary', description: 'png / jpg / tiff / webp, max 200 MB' },
                  capturedAt: { type: 'string', format: 'date', example: '2026-11-20' },
                  source: { type: 'string', example: 'DRONE', description: 'SENTINEL-2, PLANET, DRONE, UPLOAD…' },
                  minLon: { type: 'number', example: 77.59 },
                  minLat: { type: 'number', example: 12.97 },
                  maxLon: { type: 'number', example: 77.5915 },
                  maxLat: { type: 'number', example: 12.9715 },
                  resolutionM: { type: 'number' },
                  cloudCover: { type: 'number', minimum: 0, maximum: 100 },
                },
              },
            },
          },
        },
        responses: { 201: ok('Registered', ref('SatelliteImage')), 400: E400 },
      },
    },
    '/api/images/{id}/file': {
      get: {
        tags: ['Images'], summary: 'Raw image file',
        parameters: [id('id', 'Image id')],
        responses: { 200: { description: 'Image', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } }, 404: E404 },
      },
    },

    // ---- Detection & AI scan ------------------------------------------------
    '/api/properties/{id}/detect': {
      post: {
        tags: ['Detection & AI scan'], summary: 'Compare two images (raw change detection, no alerts)',
        description: 'Omit the body to compare the two latest images.',
        parameters: [id('id', 'Property id')],
        requestBody: PairBody,
        responses: { 201: ok('Detection with stats, regions and encroachment'), 400: E400 },
      },
    },
    '/api/properties/{id}/scan': {
      post: {
        tags: ['Detection & AI scan'], summary: 'Full AI agent run: detect → construction → rules → RAG → LLM → alerts',
        description: 'Omit the body to use the two latest images. Returns 422 if the agent could not run (e.g. fewer than two images).',
        parameters: [id('id', 'Property id')],
        requestBody: PairBody,
        responses: { 201: ok('Agent result with alerts'), 400: E400, 422: ok('Agent error') },
      },
    },
    '/api/properties/{id}/detections': {
      get: {
        tags: ['Detection & AI scan'], summary: 'Detection history for a parcel',
        parameters: [id('id', 'Property id')],
        responses: { 200: ok('Detections', { type: 'array', items: { type: 'object' } }) },
      },
    },
    '/api/properties/{id}/agent-runs': {
      get: {
        tags: ['Detection & AI scan'], summary: 'Agent audit trail (last 20 runs, with step trace)',
        parameters: [id('id', 'Property id')],
        responses: { 200: ok('Agent runs', { type: 'array', items: { type: 'object' } }) },
      },
    },
    '/api/detections/{id}': {
      get: {
        tags: ['Detection & AI scan'], summary: 'Detection detail with regions, images, alerts and PostGIS encroachment report',
        parameters: [id('id', 'Detection id')],
        responses: { 200: ok('Detection'), 404: E404 },
      },
    },
    '/api/detections/{id}/overlay': {
      get: {
        tags: ['Detection & AI scan'], summary: 'Change overlay PNG (red = change, boxes by type, parcel outline)',
        parameters: [id('id', 'Detection id')],
        responses: { 200: { description: 'PNG', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } }, 404: E404 },
      },
    },

    // ---- Construction -------------------------------------------------------
    '/api/construction': {
      get: {
        tags: ['Construction'], summary: 'List permit projects (with latest progress and expected-now %)',
        parameters: [q('status', 'Project status', { type: 'string', enum: enums.ProjectStatus })],
        responses: { 200: ok('Projects', { type: 'array', items: { type: 'object' } }) },
      },
      post: {
        tags: ['Construction'], summary: 'Register a construction permit project',
        requestBody: {
          required: true,
          ...json(ref('ProjectInput'), {
            propertyId: '00000000-0000-0000-0000-000000000000', permitNumber: 'BBMP/LP/2026/0999',
            permittedBuiltUpPct: 50, targetBuiltUpPct: 45, startDate: '2026-03-01', expectedEndDate: '2027-06-30',
          }),
        },
        responses: { 201: ok('Created'), 400: E400 },
      },
    },
    '/api/construction/{id}': {
      get: {
        tags: ['Construction'], summary: 'Project progress timeline vs plan',
        parameters: [id('id', 'Project id')],
        responses: { 200: ok('Project timeline'), 404: E404 },
      },
    },

    // ---- Alerts -------------------------------------------------------------
    '/api/alerts': {
      get: {
        tags: ['Alerts'], summary: 'List AI alerts',
        parameters: [
          q('status', 'Alert status', { type: 'string', enum: enums.AlertStatus }),
          q('severity', 'Severity', { type: 'string', enum: enums.Severity }),
          q('propertyId', 'Property id', { type: 'string', format: 'uuid' }),
          q('limit', 'Max rows (default 100)', { type: 'integer', default: 100 }),
        ],
        responses: { 200: ok('Alerts', { type: 'array', items: ref('Alert') }) },
      },
    },
    '/api/alerts/{id}': {
      patch: {
        tags: ['Alerts'], summary: 'Change alert status',
        parameters: [id('id', 'Alert id')],
        requestBody: {
          required: true,
          ...json({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: enums.AlertStatus } } }, { status: 'ACKNOWLEDGED' }),
        },
        responses: { 200: ok('Updated', ref('Alert')), 400: E400, 404: E404 },
      },
    },

    // ---- Knowledge (RAG) ----------------------------------------------------
    '/api/knowledge': {
      post: {
        tags: ['Knowledge (RAG)'], summary: 'Add a regulation document (chunked + embedded)',
        requestBody: {
          required: true,
          ...json({
            type: 'object', required: ['source', 'title', 'text'],
            properties: {
              source: { type: 'string' }, title: { type: 'string' },
              text: { type: 'string', minLength: 20 }, metadata: { type: 'object', additionalProperties: true },
            },
          }, { source: 'setback-rules.md', title: 'Setback rules', text: 'Minimum front setback for plots up to 250 m² is 1.5 m …' }),
        },
        responses: { 201: ok('Ingested', { type: 'object', properties: { source: { type: 'string' }, chunks: { type: 'integer' } } }), 400: E400 },
      },
    },
    '/api/knowledge/search': {
      get: {
        tags: ['Knowledge (RAG)'], summary: 'Semantic search over regulations',
        parameters: [
          { ...q('q', 'Query (min 2 chars)', { type: 'string' }, true), example: 'encroachment on neighbouring survey number' },
          q('k', 'Number of results (max 20)', { type: 'integer', maximum: 20 }),
        ],
        responses: { 200: ok('Matching chunks', { type: 'array', items: { type: 'object' } }), 400: E400 },
      },
    },
    '/api/knowledge/sources': {
      get: {
        tags: ['Knowledge (RAG)'], summary: 'Ingested documents with chunk counts',
        responses: { 200: ok('Sources', { type: 'array', items: { type: 'object' } }) },
      },
    },

    // ---- AI Assistant -------------------------------------------------------
    '/api/agent/chat': {
      post: {
        tags: ['AI Assistant'], summary: 'Ask the AI assistant (requires OPENAI_API_KEY)',
        requestBody: {
          required: true,
          ...json({
            type: 'object', required: ['question'],
            properties: {
              question: { type: 'string', minLength: 2 },
              propertyId: { type: 'string', format: 'uuid' },
              history: {
                type: 'array', maxItems: 20,
                items: { type: 'object', required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } },
              },
            },
          }, { question: 'What changed on survey number 123/4 in Yelahanka and which rules apply?' }),
        },
        responses: { 200: ok('Answer'), 400: E400, 503: err('No LLM configured (OPENAI_API_KEY not set)') },
      },
    },
  },

  components: {
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' }, details: { type: 'object' } } },
      GeoJSONPolygon: {
        type: 'object', required: ['type', 'coordinates'],
        description: 'EPSG:4326 [lon, lat]. Outer ring must be closed and have ≥ 4 points.',
        properties: {
          type: { type: 'string', enum: ['Polygon'] },
          coordinates: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } } },
        },
      },
      PropertyInput: {
        type: 'object', required: ['surveyNumber', 'village', 'district', 'state', 'ownerName'],
        properties: {
          surveyNumber: { type: 'string' }, subDivision: { type: 'string' },
          village: { type: 'string' }, taluk: { type: 'string' },
          district: { type: 'string' }, state: { type: 'string' },
          ownerName: { type: 'string' }, ownerContact: { type: 'string' },
          landUse: { type: 'string', enum: enums.LandUse, default: 'RESIDENTIAL' },
          boundary: ref('GeoJSONPolygon'),
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      Property: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          surveyNumber: { type: 'string' }, subDivision: { type: 'string', nullable: true },
          village: { type: 'string' }, taluk: { type: 'string', nullable: true },
          district: { type: 'string' }, state: { type: 'string' },
          ownerName: { type: 'string' }, landUse: { type: 'string', enum: enums.LandUse },
          areaSqm: { type: 'number', nullable: true },
          boundary: ref('GeoJSONPolygon'),
        },
      },
      SatelliteImage: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, propertyId: { type: 'string', format: 'uuid' },
          capturedAt: { type: 'string', format: 'date-time' }, source: { type: 'string' },
          width: { type: 'integer' }, height: { type: 'integer' },
          minLon: { type: 'number' }, minLat: { type: 'number' }, maxLon: { type: 'number' }, maxLat: { type: 'number' },
          resolutionM: { type: 'number', nullable: true }, cloudCover: { type: 'number', nullable: true },
        },
      },
      ImagePairInput: {
        type: 'object',
        description: 'Both optional — defaults to the two latest images.',
        properties: { beforeImageId: { type: 'string', format: 'uuid' }, afterImageId: { type: 'string', format: 'uuid' } },
      },
      ProjectInput: {
        type: 'object', required: ['propertyId', 'permittedBuiltUpPct', 'targetBuiltUpPct', 'startDate', 'expectedEndDate'],
        properties: {
          propertyId: { type: 'string', format: 'uuid' },
          permitNumber: { type: 'string' }, description: { type: 'string' },
          permittedBuiltUpPct: { type: 'number', minimum: 0, maximum: 100, description: 'Max ground coverage %' },
          permittedFloors: { type: 'integer', minimum: 1 },
          targetBuiltUpPct: { type: 'number', minimum: 0, maximum: 100, description: 'Planned final footprint %' },
          startDate: { type: 'string', format: 'date' },
          expectedEndDate: { type: 'string', format: 'date', description: 'Must be after startDate' },
        },
      },
      Alert: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, propertyId: { type: 'string', format: 'uuid' },
          detectionId: { type: 'string', format: 'uuid', nullable: true },
          type: { type: 'string' }, severity: { type: 'string', enum: enums.Severity },
          title: { type: 'string' }, message: { type: 'string' },
          recommendation: { type: 'string', nullable: true }, citations: { type: 'array', items: { type: 'object' }, nullable: true },
          status: { type: 'string', enum: enums.AlertStatus },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      DashboardStats: {
        type: 'object',
        properties: {
          properties: { type: 'integer' }, images: { type: 'integer' }, detections: { type: 'integer' }, openAlerts: { type: 'integer' },
          alertsBySeverity: { type: 'object', additionalProperties: { type: 'integer' } },
          alertsByType: { type: 'object', additionalProperties: { type: 'integer' } },
          projectsByStatus: { type: 'object', additionalProperties: { type: 'integer' } },
        },
      },
    },
  },
};
