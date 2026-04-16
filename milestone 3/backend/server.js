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

const META = {
  schemaMode: 'project',
  supportsAge: true,
  supportsUsageDate: false,
  genderOptions: [],
  projectTypeOptions: ALLOWED_PROJECT_TYPES,
};

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
    .map(() => 'LOWER(TRIM(' + columnSql + ')) = LOWER(TRIM(?))')
    .join(' OR ');

  params.push(...values);
  return '(' + clause + ')';
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
    data: META,
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
        WHERE dt.dataset_name = d.name
          AND ` + tagClause + `
      )
    `);
    params.push(...tagParams);
  }

  if (formats.length) {
    const formatParams = [];
    const formatClause = buildOrEqualsClause('r.format', formats, formatParams);
    whereClauses.push(`
      EXISTS (
        SELECT 1
        FROM dataset_resource dr
        JOIN resource r ON r.url = dr.url
        WHERE dr.dataset_name = d.name
          AND ` + formatClause + `
      )
    `);
    params.push(...formatParams);
  }

  const whereClause = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countSql = `
    SELECT COUNT(*) AS total
    FROM dataset d
    LEFT JOIN organization o ON d.org_name = o.name
  ` + whereClause;

  const sql = `
    SELECT
      NULL AS dataset_id,
      d.name AS dataset_name,
      d.title AS dataset_title,
      d.description AS dataset_description,
      d.access_level,
      d.license_title,
      (
        SELECT MIN(rf.format)
        FROM dataset_resource drf
        JOIN resource rf ON rf.url = drf.url
        WHERE drf.dataset_name = d.name
          AND rf.format IS NOT NULL
          AND TRIM(rf.format) != ''
      ) AS primary_format,
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type
    FROM dataset d
    LEFT JOIN organization o ON d.org_name = o.name
  ` + whereClause + `
    ORDER BY d.title ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countResult, [rows]] = await Promise.all([
    pool.execute(countSql, [...params]),
    pool.execute(sql, [...params]),
  ]);

  const totalCount = countResult[0]?.[0]?.total || 0;
  const totalPages = Math.ceil(totalCount / limit);

  res.json({ success: true, data: rows, totalCount, totalPages, page, limit });
}));

app.get('/api/datasets/filter-options', asyncHandler(async (req, res) => {
  const organizationTypeSql = `
    SELECT DISTINCT o.org_type AS value
    FROM organization o
    WHERE o.org_type IS NOT NULL AND TRIM(o.org_type) != ''
    ORDER BY o.org_type ASC
  `;

  const tagsSql = `
    SELECT DISTINCT dt.tag_name AS value
    FROM dataset_tag dt
    WHERE dt.tag_name IS NOT NULL AND TRIM(dt.tag_name) != ''
    ORDER BY dt.tag_name ASC
  `;

  const formatsSql = `
    SELECT DISTINCT r.format AS value
    FROM resource r
    WHERE r.format IS NOT NULL AND TRIM(r.format) != ''
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

app.get('/api/datasets/search', asyncHandler(async (req, res) => {
  const q = normalizeText(req.query.q);
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 20;

  let sql = `
    SELECT
      d.name AS dataset_name,
      d.title AS dataset_title,
      o.name AS organization_name,
      o.title AS organization_title
    FROM dataset d
    LEFT JOIN organization o ON d.org_name = o.name
  `;
  const params = [];

  if (q) {
    sql += `
      WHERE (
        LOWER(d.name) LIKE LOWER(?)
        OR LOWER(COALESCE(d.title, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(o.name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(o.title, '')) LIKE LOWER(?)
      )
    `;
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }

  sql += `
    ORDER BY
      CASE WHEN d.title IS NULL OR TRIM(d.title) = '' THEN d.name ELSE d.title END ASC,
      d.name ASC
    LIMIT ${limit}
  `;

  const [rows] = await pool.execute(sql, params);
  res.json({ success: true, data: rows });
}));

app.get('/api/datasets/:datasetName/details', asyncHandler(async (req, res) => {
  const datasetName = normalizeText(req.params.datasetName);
  if (!datasetName) {
    return badRequest(res, 'datasetName is required');
  }

  const datasetSql = `
    SELECT
      NULL AS dataset_id,
      d.name AS dataset_name,
      d.title AS dataset_title,
      d.description AS dataset_description,
      d.access_level,
      d.license_title,
      (
        SELECT MIN(rf.format)
        FROM dataset_resource drf
        JOIN resource rf ON rf.url = drf.url
        WHERE drf.dataset_name = d.name
          AND rf.format IS NOT NULL
          AND TRIM(rf.format) != ''
      ) AS primary_format,
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type
    FROM dataset d
    LEFT JOIN organization o ON d.org_name = o.name
    WHERE d.name = ?
    LIMIT 1
  `;

  const [datasetRows] = await pool.execute(datasetSql, [datasetName]);
  if (!datasetRows.length) {
    return res.status(404).json({ success: false, message: 'Dataset not found' });
  }

  const dataset = datasetRows[0];

  const tagsSql = 'SELECT DISTINCT tag_name FROM dataset_tag WHERE dataset_name = ? ORDER BY tag_name ASC';
  const tagsArg = dataset.dataset_name;

  const topicsSql = 'SELECT DISTINCT topic_name FROM dataset_topic WHERE dataset_name = ? ORDER BY topic_name ASC';
  const topicsArg = dataset.dataset_name;

  const resourcesSql = `
    SELECT r.name, r.format, r.url
    FROM dataset_resource dr
    JOIN resource r ON r.url = dr.url
    WHERE dr.dataset_name = ?
    ORDER BY r.name ASC
  `;
  const resourcesArg = dataset.dataset_name;

  const usageSql = `
    SELECT
      COUNT(*) AS usage_count,
      COUNT(DISTINCT pd.email) AS user_count,
      GROUP_CONCAT(DISTINCT p.project_type ORDER BY p.project_type SEPARATOR ', ') AS project_types
    FROM project_dataset pd
    LEFT JOIN project p ON p.email = pd.email AND p.project_name = pd.project_name
    WHERE pd.dataset_name = ?
  `;
  const usageArg = dataset.dataset_name;

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
    params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
  }

  const whereClause = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countSql = `
    SELECT COUNT(DISTINCT o.name) AS total
    FROM organization o
  ` + whereClause;

  const sql = `
    SELECT
      o.name AS organization_name,
      o.title AS organization_title,
      o.org_type,
      COUNT(d.name) AS dataset_count
    FROM organization o
    LEFT JOIN dataset d ON d.org_name = o.name
  ` + whereClause + `
    GROUP BY o.name, o.title, o.org_type
    ORDER BY o.title ASC, o.name ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countResult, [rows]] = await Promise.all([
    pool.execute(countSql, [...params]),
    pool.execute(sql, [...params]),
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
    LEFT JOIN organization o ON d.org_name = o.name
    WHERE o.name = ?
    ORDER BY d.title ASC
    LIMIT 100
  `;

  const projectTypeSql = `
    SELECT
      p.project_type,
      COUNT(*) AS usage_count
    FROM project_dataset pd
    JOIN dataset d ON pd.dataset_name = d.name
    LEFT JOIN organization o ON d.org_name = o.name
    LEFT JOIN project p ON p.email = pd.email AND p.project_name = pd.project_name
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
    params.push('%' + q + '%', '%' + q + '%');
  }

  const searchClause = q
    ? 'AND (LOWER(p.project_name) LIKE LOWER(?) OR LOWER(p.project_type) LIKE LOWER(?))'
    : '';

  const countSql = `
    SELECT COUNT(DISTINCT p.project_name, p.project_type) AS total
    FROM project p
    WHERE p.project_name IS NOT NULL
      AND TRIM(p.project_name) != ''
      AND p.project_type IS NOT NULL
      AND TRIM(p.project_type) != ''
  ` + searchClause;

  const sql = `
    SELECT
      p.project_name,
      p.project_type,
      COUNT(DISTINCT pd.dataset_name) AS dataset_count,
      COUNT(*) AS usage_count,
      COUNT(DISTINCT p.email) AS contributor_count
    FROM project p
    LEFT JOIN project_dataset pd ON p.email = pd.email AND p.project_name = pd.project_name
    WHERE p.project_name IS NOT NULL
      AND TRIM(p.project_name) != ''
      AND p.project_type IS NOT NULL
      AND TRIM(p.project_type) != ''
  ` + searchClause + `
    GROUP BY p.project_name, p.project_type
    ORDER BY p.project_name ASC, p.project_type ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countResult, [rows]] = await Promise.all([
    pool.execute(countSql, [...params]),
    pool.execute(sql, [...params]),
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

  const whereSql = whereClauses.join(' AND ');

  const summarySql = `
    SELECT
      p.project_name,
      p.project_type,
      COUNT(DISTINCT p.email) AS contributor_count,
      COUNT(DISTINCT pd.dataset_name) AS dataset_count,
      COUNT(*) AS usage_count
    FROM project p
    LEFT JOIN project_dataset pd ON p.email = pd.email AND p.project_name = pd.project_name
    WHERE ` + whereSql + `
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
    JOIN project_dataset pd ON p.email = pd.email AND p.project_name = pd.project_name
    JOIN dataset d ON pd.dataset_name = d.name
    LEFT JOIN organization o ON d.org_name = o.name
    WHERE ` + whereSql + `
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

  if (!birthdate && req.body.birthdate) {
    return badRequest(res, 'birthdate must be YYYY-MM-DD');
  }

  try {
    await pool.execute(
      'INSERT INTO app_user (email, username, gender, age, birthdate, country) VALUES (?, ?, ?, ?, ?, ?)',
      [email, username, gender, age === '' || age === null || age === undefined ? null : Number(age), birthdate, country]
    );
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
  const singleDatasetName = normalizeText(req.body.datasetName || req.body.dataset_name);
  const datasetNames = Array.isArray(req.body.datasetNames)
    ? req.body.datasetNames.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const selectedDatasetNames = Array.from(new Set(
    singleDatasetName ? [singleDatasetName, ...datasetNames] : datasetNames
  ));
  const projectName = normalizeText(req.body.projectName || req.body.project_name);
  const projectType = normalizeEnumValue(req.body.projectType || req.body.project_category);
  const usageDate = normalizeText(req.body.usageDate || req.body.usage_date) || new Date().toISOString().slice(0, 10);

  if (!email || !projectName || !projectType) {
    return badRequest(res, 'email, projectName, and projectType are required');
  }

  if (!ALLOWED_PROJECT_TYPES.includes(projectType)) {
    return badRequest(res, `projectType must be one of: ${ALLOWED_PROJECT_TYPES.join(', ')}`);
  }

  await withTransaction(async (connection) => {
    const [userRows] = await connection.execute('SELECT email FROM app_user WHERE email = ?', [email]);
    if (!userRows.length) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    let datasetRows = [];
    if (selectedDatasetNames.length) {
      const placeholders = selectedDatasetNames.map(() => '?').join(', ');
      const [rows] = await connection.execute(
        'SELECT name FROM dataset WHERE name IN (' + placeholders + ')',
        selectedDatasetNames
      );
      datasetRows = rows;

      const existingDatasetNames = new Set(datasetRows.map((row) => row.name));
      const missingDatasets = selectedDatasetNames.filter((name) => !existingDatasetNames.has(name));
      if (missingDatasets.length) {
        throw Object.assign(new Error(`Dataset not found: ${missingDatasets.join(', ')}`), { statusCode: 404 });
      }
    }

    const [existingProjectRows] = await connection.execute(
      'SELECT project_type FROM project WHERE project_name = ? LIMIT 1',
      [projectName]
    );
    const resolvedProjectType = existingProjectRows[0]?.project_type || projectType;

    await connection.execute(
      'INSERT INTO project (email, project_name, project_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE project_type = VALUES(project_type)',
      [email, projectName, resolvedProjectType]
    );

    for (const datasetName of selectedDatasetNames) {
      await connection.execute(
        'INSERT INTO project_dataset (email, project_name, dataset_name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE dataset_name = VALUES(dataset_name)',
        [email, projectName, datasetName]
      );
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
      datasetNames: selectedDatasetNames,
      projectName,
      projectType,
      usageDate: usageDate,
    },
  });
}));

app.get('/api/usage/:email', asyncHandler(async (req, res) => {
  const email = normalizeText(req.params.email);

  if (!email) {
    return badRequest(res, 'email is required');
  }

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
    JOIN project p ON p.email = pd.email AND p.project_name = pd.project_name
    JOIN dataset d ON pd.dataset_name = d.name
    LEFT JOIN organization o ON d.org_name = o.name
    WHERE pd.email = ?
    ORDER BY p.project_type ASC, pd.project_name ASC, d.title ASC
  `;
  const [rows] = await pool.execute(sql, [email]);

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
    JOIN dataset d ON d.org_name = o.name
    WHERE LOWER(TRIM(o.org_type)) LIKE LOWER(TRIM(?))
    ORDER BY o.name ASC, d.title ASC
  `;

  const [rows] = await pool.execute(sql, ['%' + orgType + '%']);
  res.json({ success: true, data: rows });
}));

app.get('/api/datasets/by-tag/:tagName', asyncHandler(async (req, res) => {
  const tagName = normalizeText(req.params.tagName);
  if (!tagName) {
    return badRequest(res, 'tagName is required');
  }

  const sql = `
    SELECT DISTINCT
      d.name AS dataset_name,
      d.title AS dataset_title,
      dt.tag_name,
      o.name AS organization_name,
      o.org_type
    FROM dataset_tag dt
    JOIN dataset d ON dt.dataset_name = d.name
    LEFT JOIN organization o ON d.org_name = o.name
    WHERE LOWER(TRIM(dt.tag_name)) LIKE LOWER(TRIM(?))
    ORDER BY d.title ASC
  `;

  const [rows] = await pool.execute(sql, ['%' + tagName + '%']);
  res.json({ success: true, data: rows });
}));

app.get('/api/datasets/by-format/:format', asyncHandler(async (req, res) => {
  const format = normalizeText(req.params.format);
  if (!format) {
    return badRequest(res, 'format is required');
  }

  const sql = `
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

  const [rows] = await pool.execute(sql, ['%' + format + '%']);
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
    LEFT JOIN dataset d ON d.org_name = o.name
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
    LEFT JOIN dataset d ON d.org_name = o.name
    GROUP BY o.name, o.title, o.org_type
    ORDER BY dataset_count DESC, organization_name ASC
  `;

  const topicSql = `
    SELECT
      dt.topic_name,
      COUNT(DISTINCT dt.dataset_name) AS dataset_count
    FROM dataset_topic dt
    GROUP BY dt.topic_name
    ORDER BY dataset_count DESC, dt.topic_name ASC
  `;

  const formatSql = `
    SELECT
      r.format,
      COUNT(DISTINCT dr.dataset_name) AS dataset_count
    FROM resource r
    JOIN dataset_resource dr ON dr.url = r.url
    WHERE r.format IS NOT NULL AND TRIM(r.format) != ''
    GROUP BY r.format
    ORDER BY dataset_count DESC, r.format ASC
  `;

  const orgTypeSql = `
    SELECT
      o.org_type,
      COUNT(d.name) AS dataset_count
    FROM organization o
    LEFT JOIN dataset d ON d.org_name = o.name
    WHERE o.org_type IS NOT NULL AND TRIM(o.org_type) != ''
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
  const sql = `
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
  const sql = `
    SELECT
      p.project_type AS project_type,
      COUNT(*) AS usage_count,
      COUNT(DISTINCT CONCAT_WS('::', p.email, p.project_name)) AS project_count,
      COUNT(DISTINCT pd.email) AS userCount,
      COUNT(DISTINCT pd.email) AS users,
      COUNT(DISTINCT pd.dataset_name) AS dataset_count
    FROM project p
    LEFT JOIN project_dataset pd ON p.email = pd.email AND p.project_name = pd.project_name
    GROUP BY p.project_type
    ORDER BY usage_count DESC, p.project_type ASC
  `;

  const [rows] = await pool.execute(sql);
  res.json({ success: true, data: rows });
}));

app.get('/api/stats/top-tags-by-project-type', asyncHandler(async (req, res) => {
  const sql = `
    SELECT
      p.project_type AS project_type,
      dt.tag_name,
      COUNT(*) AS tag_count
    FROM project p
    JOIN project_dataset pd ON pd.email = p.email AND pd.project_name = p.project_name
    JOIN dataset d ON pd.dataset_name = d.name
    JOIN dataset_tag dt ON d.name = dt.dataset_name
    GROUP BY p.project_type, dt.tag_name
    ORDER BY p.project_type ASC, tag_count DESC, dt.tag_name ASC
  `;

  const [rows] = await pool.execute(sql);

  const grouped = rows.reduce((accumulator, row) => {
    if (!accumulator[row.project_type]) {
      accumulator[row.project_type] = [];
    }

    if (accumulator[row.project_type].length < 10) {
      accumulator[row.project_type].push({
        tag_name: row.tag_name,
        tag_count: row.tag_count,
      });
    }

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
  app.locals.schemaMeta = META;

  app.listen(PORT, () => {
    console.log(`API server listening on port ${PORT}`);
    console.log(`Schema mode: ${META.schemaMode}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
