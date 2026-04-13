const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const ALLOWED_PROJECT_TYPES = ['analytics', 'machine_learning', 'field_research'];

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

app.use(cors({
  origin(origin, callback) {
    const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const localhostOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
    const allowedOrigins = new Set([...configuredOrigins, ...localhostOrigins]);
    const isRailwayOrigin = Boolean(origin) && /^https?:\/\/[a-z0-9-]+(\.up)?\.railway\.app$/i.test(origin);
    const isVercelOrigin = Boolean(origin) && /^https?:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(origin);
    const isLocalNetworkOrigin = Boolean(origin) && /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/i.test(origin);

    if (!origin || allowedOrigins.has(origin) || isRailwayOrigin || isVercelOrigin || isLocalNetworkOrigin) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));

let schemaInfo = null;

function normalizeText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeEnumValue(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(/\s+/g, '_') : null;
}

function parseFilterValues(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const rawValues = Array.isArray(value) ? value : [value];
  const normalizedValues = rawValues
    .flatMap((item) => String(item).split(','))
    .map((item) => normalizeText(item))
    .filter(Boolean);

  return Array.from(new Set(normalizedValues));
}

function buildOrEqualsClause(columnSql, values, params) {
  if (!values.length) {
    return '';
  }

  const clause = values
    .map(() => `LOWER(TRIM(${columnSql})) = LOWER(TRIM(?))`)
    .join(' OR ');

  params.push(...values);
  return `(${clause})`;
}

function parseBirthdate(age, birthdate) {
  const normalizedBirthdate = normalizeText(birthdate);
  if (normalizedBirthdate) {
    return normalizedBirthdate;
  }

  const parsedAge = Number(age);
  if (!Number.isFinite(parsedAge) || parsedAge <= 0) {
    return null;
  }

  const date = new Date();
  date.setFullYear(date.getFullYear() - Math.floor(parsedAge));
  return date.toISOString().slice(0, 10);
}

function parseEnumValues(columnType) {
  if (!columnType || !columnType.toLowerCase().startsWith('enum(')) {
    return [];
  }

  const match = columnType.match(/^enum\((.*)\)$/i);
  if (!match) {
    return [];
  }

  return match[1]
    .split(',')
    .map((value) => value.trim().replace(/^'/, '').replace(/'$/, '').replace(/\\'/g, "'"));
}

async function inspectSchema() {
  const [tableRows] = await pool.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()'
  );

  const tableSet = new Set(tableRows.map((row) => row.table_name));
  const columnMap = {};
  const knownTables = [
    'organization',
    'dataset',
    'resource',
    'dataset_tag',
    'dataset_topic',
    'dataset_resource',
    'app_user',
    'project',
    'project_dataset',
    'dataset_usage',
  ];

  for (const tableName of knownTables) {
    if (!tableSet.has(tableName)) {
      continue;
    }

    const [columnRows] = await pool.query(
      'SELECT column_name, column_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position',
      [tableName]
    );

    columnMap[tableName] = columnRows.reduce((accumulator, row) => {
      accumulator[row.column_name] = row.column_type;
      return accumulator;
    }, {});
  }

  return {
    tableSet,
    columnMap,
    hasTable(tableName) {
      return tableSet.has(tableName);
    },
    hasColumn(tableName, columnName) {
      return Boolean(columnMap[tableName] && columnMap[tableName][columnName]);
    },
    enumValues(tableName, columnName) {
      return parseEnumValues(columnMap[tableName] && columnMap[tableName][columnName]);
    },
    schemaMode: tableSet.has('dataset_usage') ? 'dataset_usage' : 'project',
    supportsAge: Boolean(columnMap.app_user && columnMap.app_user.age),
    supportsUsageDate: Boolean(columnMap.dataset_usage && columnMap.dataset_usage.usage_date),
  };
}

function datasetOrgJoinCondition() {
  if (schemaInfo.hasColumn('dataset', 'org_id')) {
    return 'd.org_id = o.org_id';
  }

  return 'd.org_name = o.name';
}

function datasetTagJoinCondition(datasetAlias = 'd', tagAlias = 'dt') {
  if (schemaInfo.hasColumn('dataset_tag', 'dataset_id')) {
    return `${tagAlias}.dataset_id = ${datasetAlias}.dataset_id`;
  }

  return `${tagAlias}.dataset_name = ${datasetAlias}.name`;
}

function resourceJoinCondition(datasetAlias = 'd', resourceAlias = 'r', linkAlias = 'dr') {
  if (schemaInfo.hasColumn('resource', 'dataset_id')) {
    return `${resourceAlias}.dataset_id = ${datasetAlias}.dataset_id`;
  }

  return `${linkAlias}.dataset_name = ${datasetAlias}.name`;
}

function usageDatasetJoinCondition(usageAlias = 'u', datasetAlias = 'd') {
  if (schemaInfo.schemaMode === 'dataset_usage') {
    return `${usageAlias}.dataset_id = ${datasetAlias}.dataset_id`;
  }

  return `${usageAlias}.dataset_name = ${datasetAlias}.name`;
}

function usageProjectJoinCondition(projectAlias = 'p', usageAlias = 'u') {
  return `${projectAlias}.email = ${usageAlias}.email AND ${projectAlias}.project_name = ${usageAlias}.project_name`;
}

function projectTypeColumn() {
  return schemaInfo.schemaMode === 'dataset_usage' ? 'u.project_category' : 'p.project_type';
}

function usageEmailColumn() {
  return schemaInfo.schemaMode === 'dataset_usage' ? 'u.email' : 'p.email';
}

function usageDateColumn() {
  return schemaInfo.schemaMode === 'dataset_usage' ? 'u.usage_date' : 'NULL';
}

function usageDatasetColumn() {
  return schemaInfo.schemaMode === 'dataset_usage' ? 'u.dataset_id' : 'u.dataset_name';
}

function usageTableName() {
  return schemaInfo.schemaMode === 'dataset_usage' ? 'dataset_usage' : 'project_dataset';
}

function usageProjectInsertSql() {
  return schemaInfo.schemaMode === 'dataset_usage'
    ? null
    : 'INSERT INTO project (email, project_name, project_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE project_type = VALUES(project_type)';
}

function usageInsertSql() {
  if (schemaInfo.schemaMode === 'dataset_usage') {
    return 'INSERT INTO dataset_usage (email, dataset_id, project_name, project_category, usage_date) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE project_category = VALUES(project_category), usage_date = VALUES(usage_date)';
  }

  return 'INSERT INTO project_dataset (email, project_name, dataset_name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE dataset_name = VALUES(dataset_name)';
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.get('/api/meta', (req, res) => {
  res.json({
    success: true,
    data: {
      schemaMode: schemaInfo.schemaMode,
      supportsAge: schemaInfo.supportsAge,
      supportsUsageDate: schemaInfo.supportsUsageDate,
      genderOptions: schemaInfo.enumValues('app_user', 'gender'),
      projectTypeOptions: schemaInfo.enumValues(
        schemaInfo.schemaMode === 'dataset_usage' ? 'dataset_usage' : 'project',
        schemaInfo.schemaMode === 'dataset_usage' ? 'project_category' : 'project_type'
      ),
    },
  });
});

app.get('/api/datasets', asyncHandler(async (req, res) => {
  const orgTypes = parseFilterValues(req.query.orgType);
  const tags = parseFilterValues(req.query.tag);
  const formats = parseFilterValues(req.query.format);
  
  const rawPage = Number.parseInt(req.query.page, 10);
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;
  const offset = (page - 1) * limit;

  const whereClauses = [];
  const params = [];

  const orgTypeClause = buildOrEqualsClause('o.org_type', orgTypes, params);
  if (orgTypeClause) {
    whereClauses.push(orgTypeClause);
  }

  if (tags.length) {
    const tagParams = [];
    const tagClause = buildOrEqualsClause('dt.tag_name', tags, tagParams);
    whereClauses.push(`
      EXISTS (
        SELECT 1
        FROM dataset_tag dt
        WHERE ${datasetTagJoinCondition('d', 'dt')}
          AND ${tagClause}
      )
    `);
    params.push(...tagParams);
  }

  if (formats.length) {
    const formatParams = [];
    const formatClause = buildOrEqualsClause('r.format', formats, formatParams);
    if (schemaInfo.hasColumn('resource', 'dataset_id')) {
      whereClauses.push(`
        EXISTS (
          SELECT 1
          FROM resource r
          WHERE r.dataset_id = d.dataset_id
            AND ${formatClause}
        )
      `);
    } else {
      whereClauses.push(`
        EXISTS (
          SELECT 1
          FROM dataset_resource dr
          JOIN resource r ON r.url = dr.url
          WHERE dr.dataset_name = d.name
            AND ${formatClause}
        )
      `);
    }
    params.push(...formatParams);
  }

  let datasetDescriptionColumn = 'NULL';
  if (schemaInfo.hasColumn('dataset', 'notes')) {
    datasetDescriptionColumn = 'd.notes';
  } else if (schemaInfo.hasColumn('dataset', 'description')) {
    datasetDescriptionColumn = 'd.description';
  }

  const datasetIdColumn = schemaInfo.hasColumn('dataset', 'dataset_id') ? 'd.dataset_id' : 'NULL';

  const primaryFormatSql = schemaInfo.hasColumn('resource', 'dataset_id')
    ? `(
      SELECT MIN(rf.format)
      FROM resource rf
      WHERE rf.dataset_id = d.dataset_id
        AND rf.format IS NOT NULL
        AND TRIM(rf.format) <> ''
    )`
    : `(
      SELECT MIN(rf.format)
      FROM dataset_resource drf
      JOIN resource rf ON rf.url = drf.url
      WHERE drf.dataset_name = d.name
        AND rf.format IS NOT NULL
        AND TRIM(rf.format) <> ''
    )`;

  const whereClause = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*) AS total
    FROM dataset d
    LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
    ${whereClause}
  `;

  const sql = `
    SELECT
      ${datasetIdColumn} AS dataset_id,
      d.name AS dataset_name,
      d.title AS dataset_title,
      ${datasetDescriptionColumn} AS dataset_description,
      d.access_level,
      d.license_title,
      ${primaryFormatSql} AS primary_format,
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type
    FROM dataset d
    LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
    ${whereClause}
    ORDER BY d.title ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countResult, [rows]] = await Promise.all([
    pool.execute(countSql, params),
    pool.execute(sql, params),
  ]);

  const totalCount = countResult[0]?.[0]?.total || 0;
  const totalPages = Math.ceil(totalCount / limit);

  res.json({ success: true, data: rows, totalCount, totalPages, page, limit });
}));

app.get('/api/datasets/filter-options', asyncHandler(async (req, res) => {
  const organizationTypeSql = `
    SELECT DISTINCT o.org_type AS value
    FROM organization o
    WHERE o.org_type IS NOT NULL AND TRIM(o.org_type) <> ''
    ORDER BY o.org_type ASC
  `;

  const tagsSql = `
    SELECT DISTINCT dt.tag_name AS value
    FROM dataset_tag dt
    WHERE dt.tag_name IS NOT NULL AND TRIM(dt.tag_name) <> ''
    ORDER BY dt.tag_name ASC
    LIMIT 300
  `;

  const formatsSql = schemaInfo.hasColumn('resource', 'dataset_id')
    ? `
      SELECT DISTINCT r.format AS value
      FROM resource r
      WHERE r.format IS NOT NULL AND TRIM(r.format) <> ''
      ORDER BY r.format ASC
    `
    : `
      SELECT DISTINCT r.format AS value
      FROM resource r
      WHERE r.format IS NOT NULL AND TRIM(r.format) <> ''
      ORDER BY r.format ASC
    `;

  const [organizationTypeRows, formatRows, tagRows] = await Promise.all([
    pool.execute(organizationTypeSql),
    pool.execute(formatsSql),
    pool.execute(tagsSql),
  ]);

  res.json({
    success: true,
    data: {
      organizationTypes: organizationTypeRows[0].map((row) => row.value),
      formats: formatRows[0].map((row) => row.value),
      tags: tagRows[0].map((row) => row.value),
    },
  });
}));

app.get('/api/datasets/:datasetName/details', asyncHandler(async (req, res) => {
  const datasetName = normalizeText(req.params.datasetName);
  if (!datasetName) {
    return badRequest(res, 'datasetName is required');
  }

  let datasetDescriptionColumn = 'NULL';
  if (schemaInfo.hasColumn('dataset', 'notes')) {
    datasetDescriptionColumn = 'd.notes';
  } else if (schemaInfo.hasColumn('dataset', 'description')) {
    datasetDescriptionColumn = 'd.description';
  }

  const datasetIdColumn = schemaInfo.hasColumn('dataset', 'dataset_id') ? 'd.dataset_id' : 'NULL';

  const primaryFormatSql = schemaInfo.hasColumn('resource', 'dataset_id')
    ? `(
      SELECT MIN(rf.format)
      FROM resource rf
      WHERE rf.dataset_id = d.dataset_id
        AND rf.format IS NOT NULL
        AND TRIM(rf.format) <> ''
    )`
    : `(
      SELECT MIN(rf.format)
      FROM dataset_resource drf
      JOIN resource rf ON rf.url = drf.url
      WHERE drf.dataset_name = d.name
        AND rf.format IS NOT NULL
        AND TRIM(rf.format) <> ''
    )`;

  const datasetSql = `
    SELECT
      ${datasetIdColumn} AS dataset_id,
      d.name AS dataset_name,
      d.title AS dataset_title,
      ${datasetDescriptionColumn} AS dataset_description,
      d.access_level,
      d.license_title,
      ${primaryFormatSql} AS primary_format,
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type
    FROM dataset d
    LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
    WHERE d.name = ?
    LIMIT 1
  `;

  const [datasetRows] = await pool.execute(datasetSql, [datasetName]);
  if (!datasetRows.length) {
    return res.status(404).json({ success: false, message: 'Dataset not found' });
  }

  const dataset = datasetRows[0];

  const tagsSql = schemaInfo.hasColumn('dataset_tag', 'dataset_id')
    ? 'SELECT DISTINCT tag_name FROM dataset_tag WHERE dataset_id = ? ORDER BY tag_name ASC'
    : 'SELECT DISTINCT tag_name FROM dataset_tag WHERE dataset_name = ? ORDER BY tag_name ASC';
  const tagsArg = schemaInfo.hasColumn('dataset_tag', 'dataset_id') ? dataset.dataset_id : dataset.dataset_name;

  const topicsSql = schemaInfo.hasColumn('dataset_topic', 'dataset_id')
    ? 'SELECT DISTINCT topic_name FROM dataset_topic WHERE dataset_id = ? ORDER BY topic_name ASC'
    : 'SELECT DISTINCT topic_name FROM dataset_topic WHERE dataset_name = ? ORDER BY topic_name ASC';
  const topicsArg = schemaInfo.hasColumn('dataset_topic', 'dataset_id') ? dataset.dataset_id : dataset.dataset_name;

  const resourcesSql = schemaInfo.hasColumn('resource', 'dataset_id')
    ? `
      SELECT name, format, url
      FROM resource
      WHERE dataset_id = ?
      ORDER BY name ASC
    `
    : `
      SELECT r.name, r.format, r.url
      FROM dataset_resource dr
      JOIN resource r ON r.url = dr.url
      WHERE dr.dataset_name = ?
      ORDER BY r.name ASC
    `;
  const resourcesArg = schemaInfo.hasColumn('resource', 'dataset_id') ? dataset.dataset_id : dataset.dataset_name;

  const usageSql = schemaInfo.schemaMode === 'dataset_usage'
    ? `
      SELECT
        COUNT(*) AS usage_count,
        COUNT(DISTINCT u.email) AS user_count,
        GROUP_CONCAT(DISTINCT u.project_category ORDER BY u.project_category SEPARATOR ', ') AS project_types
      FROM dataset_usage u
      WHERE ${schemaInfo.hasColumn('dataset_usage', 'dataset_id') ? 'u.dataset_id = ?' : 'u.dataset_name = ?'}
    `
    : `
      SELECT
        COUNT(*) AS usage_count,
        COUNT(DISTINCT pd.email) AS user_count,
        GROUP_CONCAT(DISTINCT p.project_type ORDER BY p.project_type SEPARATOR ', ') AS project_types
      FROM project_dataset pd
      LEFT JOIN project p ON ${usageProjectJoinCondition('p', 'pd')}
      WHERE pd.dataset_name = ?
    `;
  const usageArg = schemaInfo.schemaMode === 'dataset_usage' && schemaInfo.hasColumn('dataset_usage', 'dataset_id')
    ? dataset.dataset_id
    : dataset.dataset_name;

  const [tagRows, topicRows, resourceRows, usageRows] = await Promise.all([
    pool.execute(tagsSql, [tagsArg]),
    pool.execute(topicsSql, [topicsArg]),
    pool.execute(resourcesSql, [resourcesArg]),
    pool.execute(usageSql, [usageArg]),
  ]);

  res.json({
    success: true,
    data: {
      dataset,
      tags: tagRows[0].map((row) => row.tag_name),
      topics: topicRows[0].map((row) => row.topic_name),
      resources: resourceRows[0],
      usageSummary: usageRows[0][0] || { usage_count: 0, user_count: 0, project_types: null },
    },
  });
}));

app.get('/api/organizations', asyncHandler(async (req, res) => {
  const q = normalizeText(req.query.q);
  const rawPage = Number.parseInt(req.query.page, 10);
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;
  const offset = (page - 1) * limit;

  const whereClauses = [];
  const params = [];

  if (q) {
    whereClauses.push("(LOWER(o.name) LIKE LOWER(?) OR LOWER(o.title) LIKE LOWER(?) OR LOWER(COALESCE(o.org_type, '')) LIKE LOWER(?))");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const whereClause = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(DISTINCT o.name) AS total
    FROM organization o
    ${whereClause}
  `;

  const sql = `
    SELECT
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type,
      COUNT(d.name) AS dataset_count
    FROM organization o
    LEFT JOIN dataset d ON ${datasetOrgJoinCondition()}
    ${whereClause}
    GROUP BY o.name, o.title, o.org_type
    ORDER BY o.title ASC, o.name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countResult, [rows]] = await Promise.all([
    pool.execute(countSql, params),
    pool.execute(sql, params),
  ]);

  const totalCount = countResult[0]?.[0]?.total || 0;
  const totalPages = Math.ceil(totalCount / limit);

  res.json({ success: true, data: rows, totalCount, totalPages, page, limit });
}));

app.get('/api/organizations/:organizationName/details', asyncHandler(async (req, res) => {
  const organizationName = normalizeText(req.params.organizationName);
  if (!organizationName) {
    return badRequest(res, 'organizationName is required');
  }

  const [orgRows] = await pool.execute(
    'SELECT name AS organization_name, title AS organization_title, org_type FROM organization WHERE name = ? LIMIT 1',
    [organizationName]
  );

  if (!orgRows.length) {
    return res.status(404).json({ success: false, message: 'Organization not found' });
  }

  const datasetSql = `
    SELECT
      d.name AS dataset_name,
      d.title AS dataset_title,
      d.access_level,
      d.license_title
    FROM dataset d
    LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
    WHERE o.name = ?
    ORDER BY d.title ASC
    LIMIT 100
  `;

  const projectTypeSql = schemaInfo.schemaMode === 'dataset_usage'
    ? `
      SELECT
        u.project_category AS project_type,
        COUNT(*) AS usage_count
      FROM dataset_usage u
      JOIN dataset d ON ${usageDatasetJoinCondition('u', 'd')}
      LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
      WHERE o.name = ?
      GROUP BY u.project_category
      ORDER BY usage_count DESC, u.project_category ASC
    `
    : `
      SELECT
        p.project_type,
        COUNT(*) AS usage_count
      FROM project_dataset pd
      JOIN dataset d ON ${usageDatasetJoinCondition('pd', 'd')}
      LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
      LEFT JOIN project p ON ${usageProjectJoinCondition('p', 'pd')}
      WHERE o.name = ?
      GROUP BY p.project_type
      ORDER BY usage_count DESC, p.project_type ASC
    `;

  const [datasetRows, projectTypeRows] = await Promise.all([
    pool.execute(datasetSql, [organizationName]),
    pool.execute(projectTypeSql, [organizationName]),
  ]);

  res.json({
    success: true,
    data: {
      organization: orgRows[0],
      datasets: datasetRows[0],
      projectTypes: projectTypeRows[0],
    },
  });
}));

app.get('/api/projects', asyncHandler(async (req, res) => {
  const q = normalizeText(req.query.q);
  const rawPage = Number.parseInt(req.query.page, 10);
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;
  const offset = (page - 1) * limit;
  const params = [];

  if (q) {
    params.push(`%${q}%`, `%${q}%`);
  }

  const countSql = schemaInfo.schemaMode === 'dataset_usage'
    ? `
      SELECT COUNT(DISTINCT u.project_name, u.project_category) AS total
      FROM dataset_usage u
      WHERE u.project_name IS NOT NULL
        AND TRIM(u.project_name) <> ''
        AND u.project_category IS NOT NULL
        AND TRIM(u.project_category) <> ''
        ${q ? 'AND (LOWER(u.project_name) LIKE LOWER(?) OR LOWER(u.project_category) LIKE LOWER(?))' : ''}
    `
    : `
      SELECT COUNT(DISTINCT p.project_name, p.project_type) AS total
      FROM project p
      WHERE p.project_name IS NOT NULL
        AND TRIM(p.project_name) <> ''
        AND p.project_type IS NOT NULL
        AND TRIM(p.project_type) <> ''
        ${q ? 'AND (LOWER(p.project_name) LIKE LOWER(?) OR LOWER(p.project_type) LIKE LOWER(?))' : ''}
    `;

  const sql = schemaInfo.schemaMode === 'dataset_usage'
    ? `
      SELECT
        u.project_name,
        u.project_category AS project_type,
        COUNT(*) AS usage_count,
        COUNT(DISTINCT u.email) AS contributor_count,
        MAX(u.usage_date) AS last_usage_date
      FROM dataset_usage u
      WHERE u.project_name IS NOT NULL
        AND TRIM(u.project_name) <> ''
        AND u.project_category IS NOT NULL
        AND TRIM(u.project_category) <> ''
        ${q ? 'AND (LOWER(u.project_name) LIKE LOWER(?) OR LOWER(u.project_category) LIKE LOWER(?))' : ''}
      GROUP BY u.project_name, u.project_category
      ORDER BY u.project_name ASC, u.project_category ASC
      LIMIT ${limit} OFFSET ${offset}
    `
    : `
      SELECT
        p.project_name,
        p.project_type,
        COUNT(DISTINCT pd.dataset_name) AS dataset_count,
        COUNT(*) AS usage_count,
        COUNT(DISTINCT p.email) AS contributor_count
      FROM project p
      LEFT JOIN project_dataset pd ON ${usageProjectJoinCondition('p', 'pd')}
      WHERE p.project_name IS NOT NULL
        AND TRIM(p.project_name) <> ''
        AND p.project_type IS NOT NULL
        AND TRIM(p.project_type) <> ''
        ${q ? 'AND (LOWER(p.project_name) LIKE LOWER(?) OR LOWER(p.project_type) LIKE LOWER(?))' : ''}
      GROUP BY p.project_name, p.project_type
      ORDER BY p.project_name ASC, p.project_type ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

  const [countResult, [rows]] = await Promise.all([
    pool.execute(countSql, params),
    pool.execute(sql, params),
  ]);

  const totalCount = countResult[0]?.[0]?.total || 0;
  const totalPages = Math.ceil(totalCount / limit);

  res.json({ success: true, data: rows, totalCount, totalPages, page, limit });
}));

app.get('/api/projects/details', asyncHandler(async (req, res) => {
  const projectName = normalizeText(req.query.projectName);
  const projectType = normalizeText(req.query.projectType);

  if (!projectName && !projectType) {
    return badRequest(res, 'projectName or projectType is required');
  }

  if (schemaInfo.schemaMode === 'dataset_usage') {
    const whereClauses = [];
    const params = [];

    if (projectName) {
      whereClauses.push('u.project_name = ?');
      params.push(projectName);
    }

    if (projectType) {
      whereClauses.push('u.project_category = ?');
      params.push(projectType);
    }

    const summarySql = `
      SELECT
        u.project_name,
        u.project_category AS project_type,
        COUNT(*) AS usage_count,
        COUNT(DISTINCT u.email) AS contributor_count,
        MIN(u.usage_date) AS first_usage_date,
        MAX(u.usage_date) AS last_usage_date
      FROM dataset_usage u
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY u.project_name, u.project_category
      ORDER BY u.project_name ASC, u.project_category ASC
      LIMIT 1
    `;

    const datasetsSql = `
      SELECT
        d.name AS dataset_name,
        d.title AS dataset_title,
        o.name AS organization_name,
        o.title AS organization_title,
        COUNT(*) AS usage_count
      FROM dataset_usage u
      JOIN dataset d ON ${usageDatasetJoinCondition('u', 'd')}
      LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY d.name, d.title, o.name, o.title
      ORDER BY usage_count DESC, d.title ASC
      LIMIT 100
    `;

    const [summaryRows, datasetRows] = await Promise.all([
      pool.execute(summarySql, params),
      pool.execute(datasetsSql, params),
    ]);

    if (!summaryRows[0].length) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    return res.json({
      success: true,
      data: {
        project: summaryRows[0][0],
        datasets: datasetRows[0],
      },
    });
  }

  const whereClauses = [];
  const params = [];

  if (projectName) {
    whereClauses.push('p.project_name = ?');
    params.push(projectName);
  }

  if (projectType) {
    whereClauses.push('p.project_type = ?');
    params.push(projectType);
  }

  const summarySql = `
    SELECT
      p.project_name,
      p.project_type,
      COUNT(DISTINCT p.email) AS contributor_count,
      COUNT(DISTINCT pd.dataset_name) AS dataset_count,
      COUNT(*) AS usage_count
    FROM project p
    LEFT JOIN project_dataset pd ON ${usageProjectJoinCondition('p', 'pd')}
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY p.project_name, p.project_type
    ORDER BY p.project_name ASC, p.project_type ASC
    LIMIT 1
  `;

  const datasetsSql = `
    SELECT
      d.name AS dataset_name,
      d.title AS dataset_title,
      o.name AS organization_name,
      o.title AS organization_title
    FROM project p
    JOIN project_dataset pd ON ${usageProjectJoinCondition('p', 'pd')}
    JOIN dataset d ON ${usageDatasetJoinCondition('pd', 'd')}
    LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY d.name, d.title, o.name, o.title
    ORDER BY d.title ASC
    LIMIT 100
  `;

  const [summaryRows, datasetRows] = await Promise.all([
    pool.execute(summarySql, params),
    pool.execute(datasetsSql, params),
  ]);

  if (!summaryRows[0].length) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  return res.json({
    success: true,
    data: {
      project: summaryRows[0][0],
      datasets: datasetRows[0],
    },
  });
}));

app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const email = normalizeText(req.body.email);
  const username = normalizeText(req.body.username);
  const gender = normalizeText(req.body.gender);
  const age = req.body.age;
  const birthdate = parseBirthdate(age, req.body.birthdate);
  const country = normalizeText(req.body.country);

  if (!email || !username || !gender) {
    return badRequest(res, 'email, username, and gender are required');
  }

  const allowedGenders = schemaInfo.enumValues('app_user', 'gender');
  if (allowedGenders.length && !allowedGenders.includes(gender)) {
    return badRequest(res, `gender must be one of: ${allowedGenders.join(', ')}`);
  }

  if (!birthdate && req.body.birthdate) {
    return badRequest(res, 'birthdate must be YYYY-MM-DD');
  }

  try {
    if (schemaInfo.supportsAge) {
      await pool.execute(
        'INSERT INTO app_user (email, username, gender, age, birthdate, country) VALUES (?, ?, ?, ?, ?, ?)',
        [email, username, gender, age === '' || age === null || age === undefined ? null : Number(age), birthdate, country]
      );
    } else {
      await pool.execute(
        'INSERT INTO app_user (email, username, gender, birthdate, country) VALUES (?, ?, ?, ?, ?)',
        [email, username, gender, birthdate, country]
      );
    }
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A user with that email or username already exists' });
    }
    throw error;
  }

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      email,
      username,
      gender,
      birthdate,
      country,
    },
  });
}));

app.post('/api/usage', asyncHandler(async (req, res) => {
  const email = normalizeText(req.body.email);
  const datasetName = normalizeText(req.body.datasetName || req.body.dataset_name);
  const projectName = normalizeText(req.body.projectName || req.body.project_name);
  const projectType = normalizeEnumValue(req.body.projectType || req.body.project_category);
  const usageDate = normalizeText(req.body.usageDate || req.body.usage_date) || new Date().toISOString().slice(0, 10);

  if (!email || !datasetName || !projectName || !projectType) {
    return badRequest(res, 'email, datasetName, projectName, and projectType are required');
  }

  const projectTypeOptions = schemaInfo.enumValues(
    schemaInfo.schemaMode === 'dataset_usage' ? 'dataset_usage' : 'project',
    schemaInfo.schemaMode === 'dataset_usage' ? 'project_category' : 'project_type'
  );

  if (projectTypeOptions.length && !projectTypeOptions.includes(projectType)) {
    return badRequest(res, `projectType must be one of: ${projectTypeOptions.join(', ')}`);
  }

  await withTransaction(async (connection) => {
    const [userRows] = await connection.execute('SELECT email FROM app_user WHERE email = ?', [email]);
    if (!userRows.length) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const [datasetRows] = await connection.execute('SELECT name FROM dataset WHERE name = ?', [datasetName]);
    if (!datasetRows.length) {
      throw Object.assign(new Error('Dataset not found'), { statusCode: 404 });
    }

    if (schemaInfo.schemaMode === 'dataset_usage') {
      await connection.execute(
        usageInsertSql(),
        [email, datasetName, projectName, projectType, usageDate]
      );
    } else {
      await connection.execute(usageProjectInsertSql(), [email, projectName, projectType]);
      await connection.execute(usageInsertSql(), [email, projectName, datasetName]);
    }
  }).catch((error) => {
    if (error.statusCode === 404) {
      throw error;
    }
    throw error;
  });

  res.status(201).json({
    success: true,
    message: 'Usage record saved successfully',
    data: {
      email,
      datasetName,
      projectName,
      projectType,
      usageDate: schemaInfo.schemaMode === 'dataset_usage' ? usageDate : null,
    },
  });
}));

app.get('/api/usage/:email', asyncHandler(async (req, res) => {
  const email = normalizeText(req.params.email);

  if (!email) {
    return badRequest(res, 'email is required');
  }

  let rows = [];

  if (schemaInfo.schemaMode === 'dataset_usage') {
    const sql = `
      SELECT
        u.email,
        u.project_name,
        u.project_category AS project_type,
        u.usage_date,
        d.name AS dataset_name,
        d.title AS dataset_title,
        o.name AS organization_name,
        o.title AS organization_title
      FROM dataset_usage u
      JOIN dataset d ON ${usageDatasetJoinCondition('u', 'd')}
      LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
      WHERE u.email = ?
      ORDER BY u.usage_date DESC, u.project_name ASC, d.title ASC
    `;
    [rows] = await pool.execute(sql, [email]);
  } else {
    const sql = `
      SELECT
        pd.email,
        pd.project_name,
        p.project_type,
        NULL AS usage_date,
        d.name AS dataset_name,
        d.title AS dataset_title,
        o.name AS organization_name,
        o.title AS organization_title
      FROM project_dataset pd
      JOIN project p ON ${usageProjectJoinCondition('p', 'pd')}
      JOIN dataset d ON ${usageDatasetJoinCondition('pd', 'd')}
      LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
      WHERE pd.email = ?
      ORDER BY p.project_type ASC, pd.project_name ASC, d.title ASC
    `;
    [rows] = await pool.execute(sql, [email]);
  }

  res.json({ success: true, data: rows });
}));

app.get('/api/datasets/by-organization-type/:orgType', asyncHandler(async (req, res) => {
  const orgType = normalizeText(req.params.orgType);
  if (!orgType) {
    return badRequest(res, 'orgType is required');
  }

  const sql = `
    SELECT
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type,
      d.name AS dataset_name,
      d.title AS dataset_title,
      d.access_level,
      d.license_title
    FROM organization o
    JOIN dataset d ON ${datasetOrgJoinCondition()}
    WHERE LOWER(TRIM(o.org_type)) LIKE LOWER(TRIM(?))
    ORDER BY o.name ASC, d.title ASC
  `;

  const [rows] = await pool.execute(sql, [`%${orgType}%`]);
  res.json({ success: true, data: rows });
}));

app.get('/api/datasets/by-tag/:tagName', asyncHandler(async (req, res) => {
  const tagName = normalizeText(req.params.tagName);
  if (!tagName) {
    return badRequest(res, 'tagName is required');
  }

  const tagJoin = datasetTagJoinCondition('d', 'dt');
  const sql = `
    SELECT DISTINCT
      d.name AS dataset_name,
      d.title AS dataset_title,
      dt.tag_name,
      o.name AS organization_name,
      o.org_type
    FROM dataset_tag dt
    JOIN dataset d ON ${tagJoin}
    LEFT JOIN organization o ON ${datasetOrgJoinCondition()}
    WHERE LOWER(TRIM(dt.tag_name)) LIKE LOWER(TRIM(?))
    ORDER BY d.title ASC
  `;

  const [rows] = await pool.execute(sql, [`%${tagName}%`]);
  res.json({ success: true, data: rows });
}));

app.get('/api/datasets/by-format/:format', asyncHandler(async (req, res) => {
  const format = normalizeText(req.params.format);
  if (!format) {
    return badRequest(res, 'format is required');
  }

  let sql = '';

  if (schemaInfo.hasColumn('resource', 'dataset_id')) {
    sql = `
      SELECT
        d.name AS dataset_name,
        d.title AS dataset_title,
        r.format,
        COUNT(*) AS resource_count,
        GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS resource_names
      FROM dataset d
      JOIN resource r ON r.dataset_id = d.dataset_id
      WHERE LOWER(TRIM(r.format)) LIKE LOWER(TRIM(?))
      GROUP BY d.name, d.title, r.format
      ORDER BY resource_count DESC, d.title ASC
    `;
  } else {
    sql = `
      SELECT
        d.name AS dataset_name,
        d.title AS dataset_title,
        r.format,
        COUNT(*) AS resource_count,
        GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS resource_names
      FROM dataset d
      JOIN dataset_resource dr ON dr.dataset_name = d.name
      JOIN resource r ON r.url = dr.url
      WHERE LOWER(TRIM(r.format)) LIKE LOWER(TRIM(?))
      GROUP BY d.name, d.title, r.format
      ORDER BY resource_count DESC, d.title ASC
    `;
  }

  const [rows] = await pool.execute(sql, [`%${format}%`]);
  res.json({ success: true, data: rows });
}));

app.get('/api/stats/top-organizations', asyncHandler(async (req, res) => {
  const sql = `
    SELECT
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type,
      COUNT(d.name) AS dataset_count
    FROM organization o
    LEFT JOIN dataset d ON ${datasetOrgJoinCondition()}
    GROUP BY o.name, o.title, o.org_type
    ORDER BY dataset_count DESC, organization_name ASC
    LIMIT 5
  `;

  const [rows] = await pool.execute(sql);
  res.json({ success: true, data: rows });
}));

app.get('/api/stats/contributions', asyncHandler(async (req, res) => {
  const orgSql = `
    SELECT
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type,
      COUNT(d.name) AS dataset_count
    FROM organization o
    LEFT JOIN dataset d ON ${datasetOrgJoinCondition()}
    GROUP BY o.name, o.title, o.org_type
    ORDER BY dataset_count DESC, organization_name ASC
  `;

  const topicSql = `
    SELECT
      dt.topic_name,
      COUNT(DISTINCT ${schemaInfo.schemaMode === 'dataset_usage' ? 'dt.dataset_id' : 'dt.dataset_name'}) AS dataset_count
    FROM dataset_topic dt
    GROUP BY dt.topic_name
    ORDER BY dataset_count DESC, dt.topic_name ASC
  `;

  const formatSql = schemaInfo.hasColumn('resource', 'dataset_id')
    ? `
      SELECT
        r.format,
        COUNT(DISTINCT r.dataset_id) AS dataset_count
      FROM resource r
      WHERE r.format IS NOT NULL AND TRIM(r.format) <> ''
      GROUP BY r.format
      ORDER BY dataset_count DESC, r.format ASC
    `
    : `
      SELECT
        r.format,
        COUNT(DISTINCT dr.dataset_name) AS dataset_count
      FROM resource r
      JOIN dataset_resource dr ON dr.url = r.url
      WHERE r.format IS NOT NULL AND TRIM(r.format) <> ''
      GROUP BY r.format
      ORDER BY dataset_count DESC, r.format ASC
    `;

  const orgTypeSql = `
    SELECT
      o.org_type,
      COUNT(d.name) AS dataset_count
    FROM organization o
    LEFT JOIN dataset d ON ${datasetOrgJoinCondition()}
    WHERE o.org_type IS NOT NULL AND TRIM(o.org_type) <> ''
    GROUP BY o.org_type
    ORDER BY dataset_count DESC, o.org_type ASC
  `;

  const [organizationRows, topicRows, formatRows, orgTypeRows] = await Promise.all([
    pool.execute(orgSql),
    pool.execute(topicSql),
    pool.execute(formatSql),
    pool.execute(orgTypeSql),
  ]);

  res.json({
    success: true,
    data: {
      organization: organizationRows[0],
      topic: topicRows[0],
      format: formatRows[0],
      organizationType: orgTypeRows[0],
    },
  });
}));

app.get('/api/stats/top-datasets', asyncHandler(async (req, res) => {
  const sql = schemaInfo.schemaMode === 'dataset_usage'
    ? `
      SELECT
        d.name AS dataset_name,
        d.title AS dataset_title,
        COUNT(DISTINCT u.email) AS user_count,
        COUNT(*) AS usage_count
      FROM dataset d
      LEFT JOIN dataset_usage u ON u.dataset_id = d.dataset_id
      GROUP BY d.name, d.title
      ORDER BY user_count DESC, usage_count DESC, d.title ASC
      LIMIT 5
    `
    : `
      SELECT
        d.name AS dataset_name,
        d.title AS dataset_title,
        COUNT(DISTINCT pd.email) AS user_count,
        COUNT(*) AS usage_count
      FROM dataset d
      LEFT JOIN project_dataset pd ON pd.dataset_name = d.name
      GROUP BY d.name, d.title
      ORDER BY user_count DESC, usage_count DESC, d.title ASC
      LIMIT 5
    `;

  const [rows] = await pool.execute(sql);
  res.json({ success: true, data: rows });
}));

app.get('/api/stats/usage-by-project-type', asyncHandler(async (req, res) => {
  const sql = schemaInfo.schemaMode === 'dataset_usage'
    ? `
      SELECT
        u.project_category AS project_type,
        COUNT(*) AS usage_count,
        COUNT(DISTINCT u.email) AS user_count,
        COUNT(DISTINCT u.dataset_id) AS dataset_count
      FROM dataset_usage u
      GROUP BY u.project_category
      ORDER BY usage_count DESC, u.project_category ASC
    `
    : `
      SELECT
        p.project_type AS project_type,
        COUNT(*) AS usage_count,
        COUNT(DISTINCT CONCAT_WS('::', p.email, p.project_name)) AS project_count,
        COUNT(DISTINCT pd.dataset_name) AS dataset_count
      FROM project p
      JOIN project_dataset pd ON pd.email = p.email AND pd.project_name = p.project_name
      GROUP BY p.project_type
      ORDER BY usage_count DESC, p.project_type ASC
    `;

  const [rows] = await pool.execute(sql);
  res.json({ success: true, data: rows });
}));

app.get('/api/stats/top-tags-by-project-type', asyncHandler(async (req, res) => {
  const tagJoin = datasetTagJoinCondition('d', 'dt');

  const sql = schemaInfo.schemaMode === 'dataset_usage'
    ? `
      WITH tag_counts AS (
        SELECT
          u.project_category AS project_type,
          dt.tag_name,
          COUNT(*) AS tag_count
        FROM dataset_usage u
        JOIN dataset d ON u.dataset_id = d.dataset_id
        JOIN dataset_tag dt ON ${tagJoin}
        GROUP BY u.project_category, dt.tag_name
      ),
      ranked AS (
        SELECT
          project_type,
          tag_name,
          tag_count,
          ROW_NUMBER() OVER (PARTITION BY project_type ORDER BY tag_count DESC, tag_name ASC) AS rn
        FROM tag_counts
      )
      SELECT project_type, tag_name, tag_count
      FROM ranked
      WHERE rn <= 10
      ORDER BY project_type ASC, tag_count DESC, tag_name ASC
    `
    : `
      WITH tag_counts AS (
        SELECT
          p.project_type AS project_type,
          dt.tag_name,
          COUNT(*) AS tag_count
        FROM project p
        JOIN project_dataset u ON u.email = p.email AND u.project_name = p.project_name
        JOIN dataset d ON u.dataset_name = d.name
        JOIN dataset_tag dt ON ${tagJoin}
        GROUP BY p.project_type, dt.tag_name
      ),
      ranked AS (
        SELECT
          project_type,
          tag_name,
          tag_count,
          ROW_NUMBER() OVER (PARTITION BY project_type ORDER BY tag_count DESC, tag_name ASC) AS rn
        FROM tag_counts
      )
      SELECT project_type, tag_name, tag_count
      FROM ranked
      WHERE rn <= 10
      ORDER BY project_type ASC, tag_count DESC, tag_name ASC
    `;

  const [rows] = await pool.execute(sql);

  const grouped = rows.reduce((accumulator, row) => {
    if (!accumulator[row.project_type]) {
      accumulator[row.project_type] = [];
    }
    accumulator[row.project_type].push({
      tag_name: row.tag_name,
      tag_count: row.tag_count,
    });
    return accumulator;
  }, {});

  res.json({ success: true, data: grouped });
}));

app.use((error, req, res, next) => {
  console.error(error);
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: error.message || 'Internal server error',
  });
});

async function start() {
  schemaInfo = await inspectSchema();
  const meta = {
    schemaMode: schemaInfo.schemaMode,
    supportsAge: schemaInfo.supportsAge,
    supportsUsageDate: schemaInfo.supportsUsageDate,
    genderOptions: schemaInfo.enumValues('app_user', 'gender'),
    projectTypeOptions: schemaInfo.enumValues(
      schemaInfo.schemaMode === 'dataset_usage' ? 'dataset_usage' : 'project',
      schemaInfo.schemaMode === 'dataset_usage' ? 'project_category' : 'project_type'
    ),
  };

  app.locals.schemaMeta = meta;

  app.listen(PORT, () => {
    console.log(`API server listening on port ${PORT}`);
    console.log(`Schema mode: ${schemaInfo.schemaMode}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
