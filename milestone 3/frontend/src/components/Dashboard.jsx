import { useEffect, useMemo, useState } from 'react';

function normalizeApiBaseUrl(rawValue) {
  const normalized = String(rawValue || '').trim();
  if (!normalized) {
    return import.meta.env.DEV
      ? 'http://localhost:5000'
      : 'https://datastore-production.up.railway.app';
  }

  const withProtocol = /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`;

  return withProtocol.replace(/\/+$/, '');
}

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);

const tabs = [
  { id: 'datasets', label: 'Datasets' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'projects', label: 'Projects' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'portal', label: 'User Portal' },
];

const defaultRegisterForm = {
  email: '',
  username: '',
  gender: 'Male',
  age: '',
  birthdate: '',
  country: '',
};

const defaultUsageForm = {
  email: '',
  datasetName: '',
  projectName: '',
  projectType: 'analytics',
  usageDate: '',
};

const defaultMeta = {
  schemaMode: 'project',
  supportsAge: false,
  supportsUsageDate: false,
  genderOptions: ['Male', 'Female'],
  projectTypeOptions: ['analytics', 'machine_learning', 'field_research'],
};

const defaultOverview = {
  topOrganizations: [],
  contributions: {
    organization: [],
    topic: [],
    format: [],
    organizationType: [],
  },
  topDatasets: [],
  usageByProjectType: [],
  topTagsByProjectType: {},
};

const defaultFilterOptions = {
  organizationTypes: [],
  formats: [],
  tags: [],
};

function labelize(value) {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }

  return String(value)
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value ?? 'N/A';
  }
  return numeric.toLocaleString();
}

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `Request failed (${response.status})`);
  }

  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('Invalid API response format.');
  }

  return payload;
}

function DataTable({ rows, columns, emptyMessage = 'No data to display.' }) {
  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${columns[0].key}-${String(row[columns[0].key] ?? rowIndex)}`}>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : (row[column.key] ?? 'N/A')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ title, value, note }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{title}</div>
      <div className="stat-card-value">{value}</div>
      {note ? <div className="stat-card-note">{note}</div> : null}
    </div>
  );
}

function DatasetCard({ item, onOpen }) {
  return (
    <article className="catalog-card card-clickable" role="button" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen(item);
      }
    }}>
      <div className="card-chip">Dataset</div>
      <h3>{item.dataset_title || item.dataset_name || 'Untitled Dataset'}</h3>
      {hasText(item.dataset_description) ? (
        <p className="card-description">{item.dataset_description}</p>
      ) : (
        <p className="card-description card-description-empty">Description unavailable</p>
      )}
      <div className="card-meta-list">
        {hasText(item.organization_title || item.organization_name) ? (
          <div>
            <span>Organization</span>
            <strong>{item.organization_title || item.organization_name}</strong>
          </div>
        ) : null}
        {hasText(item.org_type) ? (
          <div>
            <span>Organization Type</span>
            <strong>{labelize(item.org_type)}</strong>
          </div>
        ) : null}
        {hasText(item.primary_format) ? (
          <div>
            <span>Format</span>
            <strong>{item.primary_format}</strong>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function OrganizationCard({ item, onOpen }) {
  return (
    <article className="catalog-card card-clickable" role="button" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen(item);
      }
    }}>
      <div className="card-chip">Organization</div>
      <h3>{item.organization_title || item.organization_name || 'Untitled Organization'}</h3>
      <div className="card-meta-list">
        {hasText(item.org_type) ? (
          <div>
            <span>Organization Type</span>
            <strong>{labelize(item.org_type)}</strong>
          </div>
        ) : null}
        {hasText(item.organization_name) ? (
          <div>
            <span>Code</span>
            <strong>{item.organization_name}</strong>
          </div>
        ) : null}
        <div>
          <span>Datasets</span>
          <strong>{formatNumber(item.dataset_count)}</strong>
        </div>
      </div>
    </article>
  );
}

function ProjectCard({ item, onOpen }) {
  return (
    <article className="catalog-card card-clickable" role="button" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen(item);
      }
    }}>
      <div className="card-chip">Project</div>
      <h3>{item.project_name || 'Untitled Project'}</h3>
      <p className="card-description">{labelize(item.project_type)}</p>
      <div className="card-meta-list">
        {item.dataset_count !== undefined ? (
          <div>
            <span>Datasets</span>
            <strong>{formatNumber(item.dataset_count)}</strong>
          </div>
        ) : null}
        <div>
          <span>Usage Rows</span>
          <strong>{formatNumber(item.usage_count)}</strong>
        </div>
      </div>
    </article>
  );
}

function EntityModal({ state, onClose }) {
  if (!state.open) {
    return null;
  }

  const { type, loading, error, data } = state;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose}>Close</button>
        <div className="modal-body">
          {loading ? <div className="empty-state">Loading details...</div> : null}
          {error ? <div className="notice error">{error}</div> : null}

          {!loading && !error && data && type === 'dataset' ? (
            <>
              <h2>{data.dataset?.dataset_title || data.dataset?.dataset_name}</h2>
              {hasText(data.dataset?.dataset_description) ? (
                <p className="card-description">{data.dataset.dataset_description}</p>
              ) : null}
              <div className="modal-grid">
                <section className="panel">
                  <h3>Dataset Metadata</h3>
                  <div className="modal-kv"><span>Name</span><strong>{data.dataset?.dataset_name}</strong></div>
                  <div className="modal-kv"><span>Organization</span><strong>{data.dataset?.organization_title || data.dataset?.organization_name}</strong></div>
                  <div className="modal-kv"><span>Organization Type</span><strong>{labelize(data.dataset?.org_type)}</strong></div>
                  <div className="modal-kv"><span>Format</span><strong>{data.dataset?.primary_format || 'Unknown'}</strong></div>
                  <div className="modal-kv"><span>Access</span><strong>{labelize(data.dataset?.access_level)}</strong></div>
                </section>

                <section className="panel">
                  <h3>Usage Summary</h3>
                  <div className="modal-kv"><span>Usage Rows</span><strong>{formatNumber(data.usageSummary?.usage_count)}</strong></div>
                  <div className="modal-kv"><span>Distinct Users</span><strong>{formatNumber(data.usageSummary?.user_count)}</strong></div>
                  <div className="modal-kv"><span>Project Types</span><strong>{data.usageSummary?.project_types || 'N/A'}</strong></div>
                </section>
              </div>

              <section className="panel">
                <h3>Tags</h3>
                <div className="pill-row">
                  {data.tags?.length ? data.tags.map((tag) => <span key={tag} className="pill">{tag}</span>) : <span className="muted-copy">No tags available.</span>}
                </div>
              </section>

              <section className="panel">
                <h3>Resources</h3>
                <DataTable
                  rows={data.resources || []}
                  columns={[
                    { key: 'name', label: 'Name' },
                    { key: 'format', label: 'Format' },
                    { key: 'url', label: 'URL' },
                  ]}
                  emptyMessage="No resource records available."
                />
              </section>
            </>
          ) : null}

          {!loading && !error && data && type === 'organization' ? (
            <>
              <h2>{data.organization?.organization_title || data.organization?.organization_name}</h2>
              <div className="modal-grid">
                <section className="panel">
                  <h3>Organization Profile</h3>
                  <div className="modal-kv"><span>Code</span><strong>{data.organization?.organization_name}</strong></div>
                  <div className="modal-kv"><span>Type</span><strong>{labelize(data.organization?.org_type)}</strong></div>
                </section>
                <section className="panel">
                  <h3>Related Project Types</h3>
                  <DataTable
                    rows={data.projectTypes || []}
                    columns={[
                      { key: 'project_type', label: 'Project Type', render: (row) => labelize(row.project_type) },
                      { key: 'usage_count', label: 'Usage', render: (row) => formatNumber(row.usage_count) },
                    ]}
                    emptyMessage="No project type data available."
                  />
                </section>
              </div>
              <section className="panel">
                <h3>Datasets</h3>
                <DataTable
                  rows={data.datasets || []}
                  columns={[
                    { key: 'dataset_name', label: 'Dataset Name' },
                    { key: 'dataset_title', label: 'Dataset Title' },
                    { key: 'access_level', label: 'Access', render: (row) => labelize(row.access_level) },
                    { key: 'license_title', label: 'License' },
                  ]}
                  emptyMessage="No datasets available for this organization."
                />
              </section>
            </>
          ) : null}

          {!loading && !error && data && type === 'project' ? (
            <>
              <h2>{data.project?.project_name || 'Project Details'}</h2>
              <div className="modal-grid">
                <section className="panel">
                  <h3>Project Summary</h3>
                  <div className="modal-kv"><span>Project Type</span><strong>{labelize(data.project?.project_type)}</strong></div>
                  <div className="modal-kv"><span>Usage Rows</span><strong>{formatNumber(data.project?.usage_count)}</strong></div>
                  <div className="modal-kv"><span>Contributors</span><strong>{formatNumber(data.project?.contributor_count)}</strong></div>
                  {hasText(data.project?.last_usage_date) ? (
                    <div className="modal-kv"><span>Last Usage Date</span><strong>{data.project.last_usage_date}</strong></div>
                  ) : null}
                </section>
                <section className="panel">
                  <h3>Linked Datasets</h3>
                  <DataTable
                    rows={data.datasets || []}
                    columns={[
                      { key: 'dataset_name', label: 'Dataset Name' },
                      { key: 'dataset_title', label: 'Dataset Title' },
                      { key: 'organization_name', label: 'Organization' },
                    ]}
                    emptyMessage="No linked datasets available."
                  />
                </section>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PaginationControls({ currentPage, totalPages, onPrevious, onNext, isLoading, itemStart, itemEnd, totalCount }) {
  return (
    <div className="pagination-controls">
      <div className="pagination-info">
        {totalCount > 0 ? (
          <span>Showing {itemStart}–{itemEnd} of {totalCount} results</span>
        ) : (
          <span>No results</span>
        )}
      </div>
      <div className="pagination-buttons">
        <button
          type="button"
          className="button button-secondary"
          onClick={onPrevious}
          disabled={currentPage === 1 || isLoading}
        >
          ← Previous
        </button>
        <span className="pagination-page-info">
          Page {totalPages > 0 ? currentPage : '—'} of {totalPages}
        </span>
        <button
          type="button"
          className="button button-secondary"
          onClick={onNext}
          disabled={currentPage >= totalPages || isLoading || totalPages === 0}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function FilterChecklist({ title, items, selectedValues, onToggle }) {
  return (
    <section className="filter-group">
      <h4>{title}</h4>
      <div className="checklist">
        {items.length ? items.map((item) => {
          const checked = selectedValues.includes(item);
          return (
            <label key={item}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(item)}
              />
              <span>{item}</span>
            </label>
          );
        }) : <span className="muted-copy">No options yet</span>}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('datasets');
  const [meta, setMeta] = useState(defaultMeta);
  const [overview, setOverview] = useState(defaultOverview);
  const [datasets, setDatasets] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filterOptions, setFilterOptions] = useState(defaultFilterOptions);
  const [datasetFilters, setDatasetFilters] = useState({ orgType: [], format: [], tag: [] });
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [usageForm, setUsageForm] = useState(defaultUsageForm);
  const [usageLookupEmail, setUsageLookupEmail] = useState('');
  const [usageHistory, setUsageHistory] = useState([]);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [modalState, setModalState] = useState({ open: false, type: '', loading: false, error: '', data: null });
  
  // Pagination state
  const [currentPageDatasets, setCurrentPageDatasets] = useState(1);
  const [currentPageOrganizations, setCurrentPageOrganizations] = useState(1);
  const [currentPageProjects, setCurrentPageProjects] = useState(1);
  const [totalCountDatasets, setTotalCountDatasets] = useState(0);
  const [totalCountOrganizations, setTotalCountOrganizations] = useState(0);
  const [totalCountProjects, setTotalCountProjects] = useState(0);
  const [totalPagesDatasets, setTotalPagesDatasets] = useState(0);
  const [totalPagesOrganizations, setTotalPagesOrganizations] = useState(0);
  const [totalPagesProjects, setTotalPagesProjects] = useState(0);
  
  const [loading, setLoading] = useState({
    meta: false,
    overview: false,
    datasets: false,
    options: false,
    organizations: false,
    projects: false,
    submit: false,
    lookup: false,
  });

  const genderOptions = useMemo(
    () => (meta.genderOptions?.length ? meta.genderOptions : defaultMeta.genderOptions),
    [meta.genderOptions]
  );

  const projectTypeOptions = useMemo(
    () => (meta.projectTypeOptions?.length ? meta.projectTypeOptions : defaultMeta.projectTypeOptions),
    [meta.projectTypeOptions]
  );

  const datasetOptions = useMemo(() => {
    const optionMap = new Map();

    datasets.forEach((row) => {
      if (row.dataset_name) {
        optionMap.set(row.dataset_name, row.dataset_title || row.dataset_name);
      }
    });

    overview.topDatasets.forEach((row) => {
      if (row.dataset_name) {
        optionMap.set(row.dataset_name, row.dataset_title || row.dataset_name);
      }
    });

    usageHistory.forEach((row) => {
      if (row.dataset_name) {
        optionMap.set(row.dataset_name, row.dataset_title || row.dataset_name);
      }
    });

    return Array.from(optionMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [datasets, overview.topDatasets, usageHistory]);

  function updateLoading(key, value) {
    setLoading((current) => ({ ...current, [key]: value }));
  }

  function showMessage(type, text) {
    setMessage({ type, text });
  }

  function toggleDatasetFilter(filterKey, value) {
    setDatasetFilters((current) => {
      const values = current[filterKey];
      const nextValues = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      return { ...current, [filterKey]: nextValues };
    });
  }

  async function loadMeta() {
    updateLoading('meta', true);
    try {
      const response = await fetchJson('/api/meta');
      const metaData = response.data || defaultMeta;
      setMeta(metaData);
      if (metaData.genderOptions?.length) {
        setRegisterForm((current) => ({
          ...current,
          gender: metaData.genderOptions.includes(current.gender)
            ? current.gender
            : metaData.genderOptions[0],
        }));
      }
      if (metaData.projectTypeOptions?.length) {
        setUsageForm((current) => ({
          ...current,
          projectType: metaData.projectTypeOptions.includes(current.projectType)
            ? current.projectType
            : metaData.projectTypeOptions[0],
        }));
      }
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      updateLoading('meta', false);
    }
  }

  async function loadOverview() {
    updateLoading('overview', true);
    try {
      const [topOrganizationsResponse, contributionsResponse, topDatasetsResponse, usageDistributionResponse, topTagsResponse] = await Promise.all([
        fetchJson('/api/stats/top-organizations'),
        fetchJson('/api/stats/contributions'),
        fetchJson('/api/stats/top-datasets'),
        fetchJson('/api/stats/usage-by-project-type'),
        fetchJson('/api/stats/top-tags-by-project-type'),
      ]);

      setOverview({
        topOrganizations: topOrganizationsResponse.data,
        contributions: contributionsResponse.data,
        topDatasets: topDatasetsResponse.data,
        usageByProjectType: usageDistributionResponse.data,
        topTagsByProjectType: topTagsResponse.data,
      });
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      updateLoading('overview', false);
    }
  }

  async function loadFilterOptions() {
    updateLoading('options', true);
    try {
      const response = await fetchJson('/api/datasets/filter-options');
      setFilterOptions(response.data);
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      updateLoading('options', false);
    }
  }

  async function loadDatasets(filters = datasetFilters, page = 1) {
    updateLoading('datasets', true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('limit', '20');
      filters.orgType.forEach((value) => params.append('orgType', value));
      filters.format.forEach((value) => params.append('format', value));
      filters.tag.forEach((value) => params.append('tag', value));

      const response = await fetchJson(`/api/datasets?${params.toString()}`);
      const datasets = response.data || [];
      const totalCount = Number.isFinite(response.totalCount) ? response.totalCount : datasets.length;
      const totalPages = Number.isFinite(response.totalPages) ? response.totalPages : (totalCount > 0 ? 1 : 0);
      
      setDatasets(datasets);
      setTotalCountDatasets(totalCount);
      setTotalPagesDatasets(totalPages);
      setCurrentPageDatasets(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showMessage('error', error.message);
      setDatasets([]);
      setTotalCountDatasets(0);
      setTotalPagesDatasets(0);
    } finally {
      updateLoading('datasets', false);
    }
  }

  async function loadOrganizations(searchValue = '', page = 1) {
    updateLoading('organizations', true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('limit', '20');
      if (hasText(searchValue)) {
        params.set('q', searchValue);
      }
      const response = await fetchJson(`/api/organizations${params.toString() ? `?${params.toString()}` : ''}`);
      const organizations = response.data || [];
      const totalCount = Number.isFinite(response.totalCount) ? response.totalCount : organizations.length;
      const totalPages = Number.isFinite(response.totalPages) ? response.totalPages : (totalCount > 0 ? 1 : 0);
      
      setOrganizations(organizations);
      setTotalCountOrganizations(totalCount);
      setTotalPagesOrganizations(totalPages);
      setCurrentPageOrganizations(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showMessage('error', error.message);
      setOrganizations([]);
      setTotalCountOrganizations(0);
      setTotalPagesOrganizations(0);
    } finally {
      updateLoading('organizations', false);
    }
  }

  async function loadProjects(searchValue = '', page = 1) {
    updateLoading('projects', true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('limit', '20');
      if (hasText(searchValue)) {
        params.set('q', searchValue);
      }
      const response = await fetchJson(`/api/projects${params.toString() ? `?${params.toString()}` : ''}`);
      const projects = response.data || [];
      const totalCount = Number.isFinite(response.totalCount) ? response.totalCount : projects.length;
      const totalPages = Number.isFinite(response.totalPages) ? response.totalPages : (totalCount > 0 ? 1 : 0);
      
      setProjects(projects);
      setTotalCountProjects(totalCount);
      setTotalPagesProjects(totalPages);
      setCurrentPageProjects(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showMessage('error', error.message);
      setProjects([]);
      setTotalCountProjects(0);
      setTotalPagesProjects(0);
    } finally {
      updateLoading('projects', false);
    }
  }

  async function openDatasetModal(item) {
    setModalState({ open: true, type: 'dataset', loading: true, error: '', data: null });
    try {
      const response = await fetchJson(`/api/datasets/${encodeURIComponent(item.dataset_name)}/details`);
      setModalState({ open: true, type: 'dataset', loading: false, error: '', data: response.data });
    } catch (error) {
      setModalState({ open: true, type: 'dataset', loading: false, error: error.message, data: null });
    }
  }

  async function openOrganizationModal(item) {
    setModalState({ open: true, type: 'organization', loading: true, error: '', data: null });
    try {
      const response = await fetchJson(`/api/organizations/${encodeURIComponent(item.organization_name)}/details`);
      setModalState({ open: true, type: 'organization', loading: false, error: '', data: response.data });
    } catch (error) {
      setModalState({ open: true, type: 'organization', loading: false, error: error.message, data: null });
    }
  }

  async function openProjectModal(item) {
    setModalState({ open: true, type: 'project', loading: true, error: '', data: null });
    try {
      const params = new URLSearchParams();
      if (hasText(item.project_name)) {
        params.set('projectName', item.project_name);
      }
      if (hasText(item.project_type)) {
        params.set('projectType', item.project_type);
      }
      const response = await fetchJson(`/api/projects/details?${params.toString()}`);
      setModalState({ open: true, type: 'project', loading: false, error: '', data: response.data });
    } catch (error) {
      setModalState({ open: true, type: 'project', loading: false, error: error.message, data: null });
    }
  }

  useEffect(() => {
    document.title = 'DataStore';
    loadMeta();
    loadOverview();
    loadFilterOptions();
    loadDatasets();
    loadOrganizations();
    loadProjects();
  }, []);

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    updateLoading('submit', true);
    try {
      await fetchJson('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(registerForm),
      });
      showMessage('success', `Registered ${registerForm.username} successfully.`);
      setRegisterForm((current) => ({
        ...defaultRegisterForm,
        gender: current.gender,
      }));
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      updateLoading('submit', false);
    }
  }

  async function handleUsageSubmit(event) {
    event.preventDefault();
    updateLoading('submit', true);
    try {
      await fetchJson('/api/usage', {
        method: 'POST',
        body: JSON.stringify(usageForm),
      });
      showMessage('success', 'Usage record saved successfully.');
      setUsageForm((current) => ({
        ...defaultUsageForm,
        projectType: current.projectType,
      }));
      loadOverview();
      loadProjects(projectSearch);
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      updateLoading('submit', false);
    }
  }

  async function lookupUsage() {
    if (!usageLookupEmail) {
      showMessage('error', 'Enter an email address to view usage history.');
      return;
    }

    updateLoading('lookup', true);
    try {
      const response = await fetchJson(`/api/usage/${encodeURIComponent(usageLookupEmail)}`);
      setUsageHistory(response.data);
      showMessage('success', `Loaded usage history for ${usageLookupEmail}.`);
    } catch (error) {
      showMessage('error', error.message);
    } finally {
      updateLoading('lookup', false);
    }
  }

  function applyDatasetFilters() {
    setCurrentPageDatasets(1);
    loadDatasets(datasetFilters, 1);
  }

  function clearDatasetFilters() {
    const emptyFilters = { orgType: [], format: [], tag: [] };
    setDatasetFilters(emptyFilters);
    setCurrentPageDatasets(1);
    loadDatasets(emptyFilters, 1);
  }

  function goToPreviousDatasetPage() {
    if (currentPageDatasets > 1) {
      loadDatasets(datasetFilters, currentPageDatasets - 1);
    }
  }

  function goToNextDatasetPage() {
    if (currentPageDatasets < totalPagesDatasets) {
      loadDatasets(datasetFilters, currentPageDatasets + 1);
    }
  }

  function goToPreviousOrganizationPage() {
    if (currentPageOrganizations > 1) {
      loadOrganizations(organizationSearch, currentPageOrganizations - 1);
    }
  }

  function goToNextOrganizationPage() {
    if (currentPageOrganizations < totalPagesOrganizations) {
      loadOrganizations(organizationSearch, currentPageOrganizations + 1);
    }
  }

  function goToPreviousProjectPage() {
    if (currentPageProjects > 1) {
      loadProjects(projectSearch, currentPageProjects - 1);
    }
  }

  function goToNextProjectPage() {
    if (currentPageProjects < totalPagesProjects) {
      loadProjects(projectSearch, currentPageProjects + 1);
    }
  }

  const usageHistoryColumns = [
    { key: 'project_name', label: 'Project' },
    { key: 'project_type', label: 'Project Type', render: (row) => labelize(row.project_type) },
    { key: 'dataset_name', label: 'Dataset' },
    { key: 'dataset_title', label: 'Dataset Title' },
    { key: 'organization_name', label: 'Organization' },
    { key: 'usage_date', label: 'Usage Date', render: (row) => row.usage_date || 'N/A' },
  ];

  return (
    <div className="app-shell">
      <header className="top-header">
        <div>
          <div className="eyebrow">Open Data Catalog</div>
          <h1>DataStore</h1>
          <p>Search public datasets, browse publishers, review project categories, and manage usage in one unified portal.</p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            loadOverview();
            loadFilterOptions();
            loadDatasets();
            loadOrganizations(organizationSearch);
            loadProjects(projectSearch);
          }}
          disabled={loading.overview || loading.datasets || loading.organizations || loading.projects}
        >
          {loading.overview || loading.datasets || loading.organizations || loading.projects ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </header>

      <nav className="tab-nav" aria-label="Main sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {message.text ? <div className={`notice ${message.type}`}>{message.text}</div> : null}

      {activeTab === 'datasets' ? (
        <section className="tab-section">
          <div className="section-title-row">
            <div>
              <h2>Datasets</h2>
              <p>Discover datasets in a Data.gov style catalog with faceted multi-select filtering.</p>
            </div>
            <div className="muted-copy">{loading.datasets ? 'Loading datasets...' : `${datasets.length} results`}</div>
          </div>

          <div className="catalog-layout">
            <aside className="catalog-sidebar">
              <h3>Refine Results</h3>
              <FilterChecklist
                title="Organization Type"
                items={filterOptions.organizationTypes}
                selectedValues={datasetFilters.orgType}
                onToggle={(value) => toggleDatasetFilter('orgType', value)}
              />
              <FilterChecklist
                title="Format"
                items={filterOptions.formats}
                selectedValues={datasetFilters.format}
                onToggle={(value) => toggleDatasetFilter('format', value)}
              />
              <FilterChecklist
                title="Tags"
                items={filterOptions.tags}
                selectedValues={datasetFilters.tag}
                onToggle={(value) => toggleDatasetFilter('tag', value)}
              />
              <div className="sidebar-actions">
                <button type="button" className="button" onClick={applyDatasetFilters} disabled={loading.datasets}>Apply</button>
                <button type="button" className="button button-secondary" onClick={clearDatasetFilters} disabled={loading.datasets}>Clear</button>
              </div>
            </aside>

            <div className="catalog-content">
              {datasets.length ? (
                <>
                  <div className="catalog-grid">
                    {datasets.map((item, index) => (
                      <DatasetCard
                        key={`${item.dataset_name || item.dataset_title || 'dataset'}-${index}`}
                        item={item}
                        onOpen={openDatasetModal}
                      />
                    ))}
                  </div>
                  <PaginationControls
                    currentPage={currentPageDatasets}
                    totalPages={totalPagesDatasets}
                    onPrevious={goToPreviousDatasetPage}
                    onNext={goToNextDatasetPage}
                    isLoading={loading.datasets}
                    itemStart={totalCountDatasets > 0 ? (currentPageDatasets - 1) * 20 + 1 : 0}
                    itemEnd={Math.min(currentPageDatasets * 20, totalCountDatasets)}
                    totalCount={totalCountDatasets}
                  />
                </>
              ) : (
                <div className="empty-state">No datasets found for these filters.</div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'organizations' ? (
        <section className="tab-section">
          <div className="section-title-row">
            <div>
              <h2>Organizations</h2>
              <p>Browse open data publishers and search by title, code, or type.</p>
            </div>
          </div>

          <div className="search-row">
            <input
              type="text"
              value={organizationSearch}
              onChange={(event) => setOrganizationSearch(event.target.value)}
              placeholder="Search organizations..."
            />
            <button type="button" className="button button-secondary" onClick={() => { setCurrentPageOrganizations(1); loadOrganizations(organizationSearch, 1); }} disabled={loading.organizations}>
              {loading.organizations ? 'Searching...' : 'Search'}
            </button>
          </div>

          {organizations.length ? (
            <>
              <div className="catalog-grid">
                {organizations.map((item, index) => (
                  <OrganizationCard key={`${item.organization_name || 'org'}-${index}`} item={item} onOpen={openOrganizationModal} />
                ))}
              </div>
              <PaginationControls
                currentPage={currentPageOrganizations}
                totalPages={totalPagesOrganizations}
                onPrevious={goToPreviousOrganizationPage}
                onNext={goToNextOrganizationPage}
                isLoading={loading.organizations}
                itemStart={totalCountOrganizations > 0 ? (currentPageOrganizations - 1) * 20 + 1 : 0}
                itemEnd={Math.min(currentPageOrganizations * 20, totalCountOrganizations)}
                totalCount={totalCountOrganizations}
              />
            </>
          ) : (
            <div className="empty-state">No organization records available.</div>
          )}
        </section>
      ) : null}

      {activeTab === 'projects' ? (
        <section className="tab-section">
          <div className="section-title-row">
            <div>
              <h2>Projects</h2>
              <p>Distinct project records with type and linked usage context.</p>
            </div>
          </div>

          <div className="search-row">
            <input
              type="text"
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="Search projects by name or type..."
            />
            <button type="button" className="button button-secondary" onClick={() => { setCurrentPageProjects(1); loadProjects(projectSearch, 1); }} disabled={loading.projects}>
              {loading.projects ? 'Searching...' : 'Search'}
            </button>
          </div>

          {projects.length ? (
            <>
              <div className="catalog-grid">
                {projects.map((item, index) => (
                  <ProjectCard key={`${item.project_name || 'project'}-${index}`} item={item} onOpen={openProjectModal} />
                ))}
              </div>
              <PaginationControls
                currentPage={currentPageProjects}
                totalPages={totalPagesProjects}
                onPrevious={goToPreviousProjectPage}
                onNext={goToNextProjectPage}
                isLoading={loading.projects}
                itemStart={totalCountProjects > 0 ? (currentPageProjects - 1) * 20 + 1 : 0}
                itemEnd={Math.min(currentPageProjects * 20, totalCountProjects)}
                totalCount={totalCountProjects}
              />
            </>
          ) : (
            <div className="empty-state">No project records available.</div>
          )}
        </section>
      ) : null}

      {activeTab === 'analytics' ? (
        <section className="tab-section">
          <div className="section-title-row">
            <div>
              <h2>Analytics</h2>
              <p>Top organizations, usage distributions, and contribution insights.</p>
            </div>
            <div className="muted-copy">{loading.overview ? 'Refreshing analytics...' : 'Statistics loaded from API.'}</div>
          </div>

          <div className="stats-grid">
            <StatCard title="Top organizations" value={overview.topOrganizations.length} note="Top 5 by dataset count." />
            <StatCard title="Top datasets" value={overview.topDatasets.length} note="Ranked by usage and users." />
            <StatCard title="Project categories" value={overview.usageByProjectType.length} note="From usage/project records." />
            <StatCard title="Contribution groups" value={Object.keys(overview.contributions).length} note="Organization, topic, format, type." />
          </div>

          <div className="analytics-grid">
            <section className="panel">
              <div className="panel-header">
                <h3>Top 5 Contributing Organizations</h3>
              </div>
              <DataTable
                rows={overview.topOrganizations}
                columns={[
                  { key: 'organization_name', label: 'Organization' },
                  { key: 'organization_title', label: 'Title' },
                  { key: 'org_type', label: 'Type', render: (row) => labelize(row.org_type) },
                  { key: 'dataset_count', label: 'Datasets', render: (row) => formatNumber(row.dataset_count) },
                ]}
              />
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>Top 5 Datasets by Users</h3>
              </div>
              <DataTable
                rows={overview.topDatasets}
                columns={[
                  { key: 'dataset_name', label: 'Dataset' },
                  { key: 'dataset_title', label: 'Title' },
                  { key: 'user_count', label: 'Users', render: (row) => formatNumber(row.user_count) },
                  { key: 'usage_count', label: 'Usage Rows', render: (row) => formatNumber(row.usage_count) },
                ]}
              />
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>Usage Distribution by Project Type</h3>
              </div>
              <DataTable
                rows={overview.usageByProjectType}
                columns={[
                  { key: 'project_type', label: 'Project Type', render: (row) => labelize(row.project_type) },
                  { key: 'usage_count', label: 'Usage Count', render: (row) => formatNumber(row.usage_count) },
                  { key: 'user_count', label: 'Users', render: (row) => formatNumber(row.user_count) },
                  { key: 'dataset_count', label: 'Datasets', render: (row) => formatNumber(row.dataset_count) },
                ]}
              />
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>Contributions by Category</h3>
              </div>
              <div className="stacked-tables">
                <DataTable
                  rows={overview.contributions.organization}
                  columns={[
                    { key: 'organization_name', label: 'Organization' },
                    { key: 'dataset_count', label: 'Datasets', render: (row) => formatNumber(row.dataset_count) },
                  ]}
                />
                <DataTable
                  rows={overview.contributions.topic}
                  columns={[
                    { key: 'topic_name', label: 'Topic' },
                    { key: 'dataset_count', label: 'Datasets', render: (row) => formatNumber(row.dataset_count) },
                  ]}
                />
                <DataTable
                  rows={overview.contributions.format}
                  columns={[
                    { key: 'format', label: 'Format' },
                    { key: 'dataset_count', label: 'Datasets', render: (row) => formatNumber(row.dataset_count) },
                  ]}
                />
                <DataTable
                  rows={overview.contributions.organizationType}
                  columns={[
                    { key: 'org_type', label: 'Organization Type', render: (row) => labelize(row.org_type) },
                    { key: 'dataset_count', label: 'Datasets', render: (row) => formatNumber(row.dataset_count) },
                  ]}
                />
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === 'portal' ? (
        <section className="tab-section">
          <div className="section-title-row">
            <div>
              <h2>User Portal</h2>
              <p>Register users, add dataset usage entries, and view usage history.</p>
            </div>
          </div>

          <div className="portal-grid">
            <section className="panel panel-wide">
              <div className="panel-header">
                <h3>Register User</h3>
              </div>
              <form className="form-grid" onSubmit={handleRegisterSubmit}>
                <label>
                  Email
                  <input
                    type="email"
                    value={registerForm.email}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="name@example.com"
                    required
                  />
                </label>
                <label>
                  Username
                  <input
                    type="text"
                    value={registerForm.username}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="unique username"
                    required
                  />
                </label>
                <label>
                  Gender
                  <select
                    value={registerForm.gender}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, gender: event.target.value }))}
                    required
                  >
                    {genderOptions.map((option) => (
                      <option key={option} value={option}>{labelize(option)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Birthdate
                  <input
                    type="date"
                    value={registerForm.birthdate}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, birthdate: event.target.value }))}
                  />
                </label>
                {meta.supportsAge ? (
                  <label>
                    Age
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={registerForm.age}
                      onChange={(event) => setRegisterForm((current) => ({ ...current, age: event.target.value }))}
                      placeholder="optional"
                    />
                  </label>
                ) : null}
                <label>
                  Country
                  <input
                    type="text"
                    value={registerForm.country}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, country: event.target.value }))}
                    placeholder="Country"
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="button" disabled={loading.submit}>
                    {loading.submit ? 'Saving...' : 'Register user'}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel panel-wide">
              <div className="panel-header">
                <h3>Record Usage</h3>
              </div>
              <form className="form-grid" onSubmit={handleUsageSubmit}>
                <label>
                  User Email
                  <input
                    type="email"
                    value={usageForm.email}
                    onChange={(event) => setUsageForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="registered user email"
                    required
                  />
                </label>
                <label>
                  Dataset Name
                  <select
                    value={usageForm.datasetName}
                    onChange={(event) => setUsageForm((current) => ({ ...current, datasetName: event.target.value }))}
                    required
                  >
                    <option value="">Select a dataset</option>
                    {datasetOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Project Name
                  <input
                    type="text"
                    value={usageForm.projectName}
                    onChange={(event) => setUsageForm((current) => ({ ...current, projectName: event.target.value }))}
                    placeholder="project title"
                    required
                  />
                </label>
                <label>
                  Project Type
                  <select
                    value={usageForm.projectType}
                    onChange={(event) => setUsageForm((current) => ({ ...current, projectType: event.target.value }))}
                    required
                  >
                    {projectTypeOptions.map((option) => (
                      <option key={option} value={option}>{labelize(option)}</option>
                    ))}
                  </select>
                </label>
                {meta.supportsUsageDate ? (
                  <label>
                    Usage Date
                    <input
                      type="date"
                      value={usageForm.usageDate}
                      onChange={(event) => setUsageForm((current) => ({ ...current, usageDate: event.target.value }))}
                    />
                  </label>
                ) : null}
                <div className="form-actions">
                  <button type="submit" className="button" disabled={loading.submit}>
                    {loading.submit ? 'Saving...' : 'Add usage record'}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel panel-wide">
              <div className="panel-header">
                <h3>View Usage by User</h3>
              </div>
              <div className="inline-controls">
                <input
                  type="email"
                  value={usageLookupEmail}
                  onChange={(event) => setUsageLookupEmail(event.target.value)}
                  placeholder="user email"
                />
                <button type="button" className="button button-secondary" onClick={lookupUsage} disabled={loading.lookup}>
                  {loading.lookup ? 'Loading...' : 'Load usage'}
                </button>
              </div>
              <DataTable rows={usageHistory} columns={usageHistoryColumns} emptyMessage="No usage history loaded yet." />
            </section>
          </div>
        </section>
      ) : null}

      <EntityModal
        state={modalState}
        onClose={() => setModalState({ open: false, type: '', loading: false, error: '', data: null })}
      />
    </div>
  );
}
