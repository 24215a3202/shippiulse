import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { io as createSocket } from 'socket.io-client';
import './style.css';

const LiveTrackingMap = React.lazy(() => import('./LiveTrackingMap.jsx'));
const AnalyticsVolumeChart = React.lazy(() => import('./AnalyticsVolumeChart.jsx'));

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

class ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    Object.assign(this, details);
  }
}

function csrfToken() {
  const entry = document.cookie.split('; ').find((value) => value.startsWith('sp_csrf='));
  return entry?.slice('sp_csrf='.length) ?? '';
}

async function sendRequest(path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = csrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  return fetch(`${API_BASE}${path}`, { ...options, method, headers, credentials: 'include' });
}

async function apiRequest(path, options = {}) {
  let response = await sendRequest(path, options);

  if (response.status === 401 && path === '/api/auth/me') {
    const refreshResponse = await sendRequest('/api/auth/refresh', { method: 'POST' });
    if (refreshResponse.ok) response = await sendRequest(path, options);
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error?.message ?? 'Something went wrong. Try again.', {
      status: response.status,
      code: payload.error?.code,
      fields: payload.error?.fields,
    });
  }
  return payload;
}

function Brand({ light = false, to = '/login' }) {
  return (
    <Link className={`brand ${light ? 'brand-light' : ''}`} to={to} aria-label="ShipPulse home">
      <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h4l2.2-5 3.6 10 2.1-5H20" /></svg></span>
      <span>Ship<span>Pulse</span></span>
    </Link>
  );
}

function ProductLandingPage() {
  const capabilities = [
    { number: '01', title: 'Shipments in one place', text: 'Create, assign, and follow each delivery through a clear status timeline and event history.', icon: '↗' },
    { number: '02', title: 'Live fleet visibility', text: 'See the latest driver location, signal freshness, and delivery progress on a shared map.', icon: '⌖' },
    { number: '03', title: 'Exceptions that need action', text: 'Bring delays, missed updates, route deviations, and other operational issues into one queue.', icon: '!' },
    { number: '04', title: 'A clearer operating picture', text: 'Review shipment volume and team performance with analytics grounded in your operations data.', icon: '▥' },
  ];

  return (
    <main className="product-page">
      <header className="product-nav-wrap">
        <nav className="product-nav" aria-label="Main navigation">
          <Brand to="/" />
          <div className="product-nav-links">
            <a href="#capabilities">Capabilities</a>
            <a href="#how-it-works">How it works</a>
          </div>
          <div className="product-nav-actions">
            <Link className="product-login-link" to="/login">Sign in</Link>
            <Link className="product-button product-button-small" to="/register">Get started <span aria-hidden="true">↗</span></Link>
          </div>
        </nav>
      </header>

      <section className="product-hero">
        <div className="product-hero-copy">
          <p className="product-eyebrow"><span /> SHIPMENT INTELLIGENCE FOR THE REAL WORLD</p>
          <h1>Every delivery.<br /><span>In better view.</span></h1>
          <p className="product-hero-description">ShipPulse brings shipments, drivers, fleet activity, and delivery exceptions into one operations workspace—so your team can see what is moving and what needs attention.</p>
          <div className="product-hero-actions">
            <Link className="product-button" to="/register">Create your workspace <span aria-hidden="true">→</span></Link>
            <a className="product-text-link" href="#capabilities">Explore capabilities <span aria-hidden="true">↓</span></a>
          </div>
          <div className="product-hero-note"><span className="product-check">✓</span> Built for dispatchers, operations teams, and growing fleets</div>
        </div>

        <div className="product-preview" aria-label="Illustration of the ShipPulse operations dashboard">
          <div className="preview-window">
            <div className="preview-topbar"><div className="preview-dots"><i /><i /><i /></div><span>WORKSPACE PREVIEW</span><span className="preview-live"><i /> SAMPLE DATA</span></div>
            <div className="preview-body">
              <div className="preview-heading"><div><small>MONDAY, 14 OCTOBER</small><strong>Operations at a glance</strong></div><span className="preview-period">Last 7 days⌄</span></div>
              <div className="preview-metrics">
                <div><span>Active shipments</span><strong>128</strong><small className="preview-positive">Across your fleet</small></div>
                <div><span>On-time deliveries</span><strong>94.2<span className="preview-percent">%</span></strong><small>Delivery performance</small></div>
                <div><span>Needs attention</span><strong className="preview-alert-count">06</strong><small>Open exceptions</small></div>
              </div>
              <div className="preview-content">
                <div className="preview-map">
                  <div className="preview-map-grid" />
                  <svg viewBox="0 0 430 180" role="presentation" aria-hidden="true">
                    <path className="preview-road" d="M-10 130 C65 110 80 28 158 53 S249 159 318 103 369 48 445 58" />
                    <path className="preview-route" d="M24 128 C72 102 85 41 158 55 S249 157 318 103 367 52 403 57" />
                    <circle className="preview-stop" cx="24" cy="128" r="6" /><circle className="preview-stop" cx="403" cy="57" r="6" />
                    <circle className="preview-truck" cx="251" cy="144" r="8" />
                  </svg>
                  <span className="preview-map-label preview-map-start">PICKUP</span><span className="preview-map-label preview-map-end">DELIVERY</span>
                  <span className="preview-vehicle-tag"><i /> Truck 024 <small>In transit</small></span>
                </div>
                <div className="preview-shipments"><div className="preview-list-title">Recent activity <span>View all →</span></div>
                  <div className="preview-shipment-row"><i className="preview-status status-green" /><span><b>SP-20481</b><small>Northside → Downtown</small></span><em>In transit</em></div>
                  <div className="preview-shipment-row"><i className="preview-status status-amber" /><span><b>SP-20479</b><small>West depot → Lakeside</small></span><em className="preview-delayed">Delayed</em></div>
                  <div className="preview-shipment-row"><i className="preview-status status-blue" /><span><b>SP-20476</b><small>Central hub → Airport</small></span><em>Out for delivery</em></div>
                </div>
              </div>
            </div>
          </div>
          <div className="preview-float-card"><span className="preview-float-icon">!</span><span><b>Route deviation</b><small>Shipment SP-20479 · Needs review</small></span></div>
        </div>
      </section>

      <section className="product-value-strip" aria-label="Product summary">
        <div><span className="value-number">01</span><span><b>One shared workspace</b><small>Shipments, people, and vehicles together</small></span></div>
        <div><span className="value-number">02</span><span><b>Live operational context</b><small>Location, status, and timeline in view</small></span></div>
        <div><span className="value-number">03</span><span><b>Actionable exceptions</b><small>Know where your team can step in</small></span></div>
      </section>

      <section className="product-capabilities" id="capabilities">
        <div className="product-section-heading"><div><p className="product-eyebrow">A CONNECTED OPERATIONS WORKSPACE</p><h2>From dispatch to delivery,<br />see the whole picture.</h2></div><p>Give your team the context to coordinate the day, follow each shipment, and act when a delivery changes course.</p></div>
        <div className="product-capability-grid">
          {capabilities.map((capability) => <article className="product-capability" key={capability.number}>
            <div className="capability-topline"><span>{capability.number} / 04</span><span className="capability-icon" aria-hidden="true">{capability.icon}</span></div>
            <h3>{capability.title}</h3><p>{capability.text}</p><a href="#how-it-works" aria-label={`Learn how ${capability.title.toLowerCase()} works`}>See how it fits <span aria-hidden="true">↗</span></a>
          </article>)}
        </div>
      </section>

      <section className="product-workflow" id="how-it-works">
        <div className="workflow-copy"><p className="product-eyebrow">DESIGNED AROUND YOUR DAILY FLOW</p><h2>Less switching.<br />More moving forward.</h2><p>Bring your operational basics together: build a shipment, assign a driver and vehicle, follow location updates, and keep an eye on exceptions from one workspace.</p><Link className="product-button" to="/register">Start with your team <span aria-hidden="true">→</span></Link></div>
        <div className="workflow-steps">
          <div><span>01</span><i className="workflow-icon">＋</i><section><b>Set up your operation</b><p>Add your team, drivers, and vehicles to a private organization workspace.</p></section></div>
          <div><span>02</span><i className="workflow-icon">↗</i><section><b>Plan and dispatch</b><p>Create shipments, add stops, and assign the right driver and vehicle.</p></section></div>
          <div><span>03</span><i className="workflow-icon">⌖</i><section><b>Follow what happens</b><p>See shipment status, location history, and issues that need an operator’s attention.</p></section></div>
        </div>
      </section>

      <section className="product-cta"><div><p className="product-eyebrow">A CLEARER DAY STARTS HERE</p><h2>Bring your operation into view.</h2><p>Create a workspace for your logistics team and start organizing the work behind every delivery.</p></div><div className="product-cta-actions"><Link className="product-button product-button-light" to="/register">Create your workspace <span aria-hidden="true">→</span></Link><Link className="product-cta-login" to="/login">Already have an account? Sign in</Link></div></section>

      <footer className="product-footer"><Brand to="/" /><span>Shipment operations, brought into focus.</span><div><a href="#capabilities">Capabilities</a><Link to="/login">Sign in</Link></div><small>© {new Date().getFullYear()} ShipPulse</small></footer>
    </main>
  );
}

function AuthFrame({ eyebrow, title, description, children, footer }) {
  return (
    <main className="auth-page">
      <section className="auth-aside">
        <div className="auth-aside-top"><Brand light /><Link to="/">Product overview <span aria-hidden="true">↗</span></Link></div>
        <div className="aside-message">
          <p className="aside-kicker">SHIPMENT INTELLIGENCE</p>
          <h1>Keep every delivery moving.</h1>
          <p>Bring your team, fleet, and shipment updates into one clear operations workspace.</p>
        </div>
        <div className="aside-bottom"><span className="live-dot" /> Built for the people who move things forward</div>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <div className="form-heading">
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <p className="form-description">{description}</p>
          </div>
          {children}
          {footer && <div className="form-footer">{footer}</div>}
        </div>
        <p className="legal-note">Secure access for your logistics team</p>
      </section>
    </main>
  );
}

function FormError({ error }) {
  if (!error) return null;
  return <div className="form-error" role="alert">{error.message}</div>;
}

function Field({ label, name, type = 'text', autoComplete, value, onChange, required = true, hint, minLength, maxLength }) {
  return (
    <label className="field" htmlFor={name}>
      <span>{label}</span>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = React.useState({ organizationSlug: '', email: '', password: '' });
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  function update(event) {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(form) });
      navigate('/dashboard', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="WELCOME BACK"
      title="Sign in to ShipPulse"
      description="Enter your organization and account details to continue."
      footer={<>New to ShipPulse? <Link to="/register">Create an organization</Link></>}
    >
      {searchParams.get('reset') === 'complete' && <div className="form-success" role="status">Your password has been updated. Sign in with your new password.</div>}
      <form className="auth-form" onSubmit={submit}>
        <Field label="Organization address" name="organizationSlug" autoComplete="organization" value={form.organizationSlug} onChange={update} hint="The short name your organization uses to sign in." />
        <Field label="Work email" name="email" type="email" autoComplete="username" value={form.email} onChange={update} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" value={form.password} onChange={update} />
        <div className="form-options"><span>Use your organization’s account</span><Link to="/forgot-password">Forgot password?</Link></div>
        <FormError error={error} />
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">→</span>
        </button>
      </form>
    </AuthFrame>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = React.useState({ organizationName: '', organizationSlug: '', name: '', email: '', password: '' });
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  function update(event) {
    const { name, value } = event.target;
    setForm((previous) => {
      if (name === 'organizationName') {
        const suggestedSlug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return { ...previous, organizationName: value, organizationSlug: previous.organizationSlug || suggestedSlug };
      }
      return { ...previous, [name]: value };
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify(form) });
      navigate('/dashboard', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      eyebrow="GET STARTED"
      title="Create your workspace"
      description="Set up your organization and administrator account."
      footer={<>Already have an account? <Link to="/login">Sign in</Link></>}
    >
      <form className="auth-form compact-form" onSubmit={submit}>
        <Field label="Organization name" name="organizationName" autoComplete="organization" value={form.organizationName} onChange={update} maxLength={160} />
        <Field label="Organization address" name="organizationSlug" autoComplete="off" value={form.organizationSlug} onChange={update} hint="Use lowercase letters, numbers, and hyphens." maxLength={80} />
        <div className="field-row">
          <Field label="Your name" name="name" autoComplete="name" value={form.name} onChange={update} maxLength={120} />
          <Field label="Work email" name="email" type="email" autoComplete="email" value={form.email} onChange={update} maxLength={320} />
        </div>
        <Field label="Password" name="password" type="password" autoComplete="new-password" value={form.password} onChange={update} minLength={12} maxLength={72} hint="At least 12 characters." />
        <FormError error={error} />
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating workspace…' : 'Create workspace'} <span aria-hidden="true">→</span></button>
      </form>
    </AuthFrame>
  );
}

function ForgotPasswordPage() {
  const [form, setForm] = React.useState({ organizationSlug: '', email: '' });
  const [error, setError] = React.useState(null);
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  function update(event) {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setResult(await apiRequest('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify(form) }));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Reset your password" description="Enter the organization address and email for your account.">
      {result ? (
        <div className="recovery-result">
          <div className="success-icon" aria-hidden="true">✓</div>
          <p className="form-success" role="status">{result.message}</p>
          {result.developmentToken && <Link className="primary-button button-link" to={`/reset-password?token=${encodeURIComponent(result.developmentToken)}`}>Continue with development reset link <span aria-hidden="true">→</span></Link>}
          <Link className="text-link" to="/login">Return to sign in</Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <Field label="Organization address" name="organizationSlug" autoComplete="organization" value={form.organizationSlug} onChange={update} />
          <Field label="Work email" name="email" type="email" autoComplete="email" value={form.email} onChange={update} />
          <FormError error={error} />
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Preparing reset…' : 'Send reset instructions'} <span aria-hidden="true">→</span></button>
          <Link className="back-link" to="/login">← Back to sign in</Link>
        </form>
      )}
    </AuthFrame>
  );
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequest('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      navigate('/login?reset=complete', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame eyebrow="ACCOUNT RECOVERY" title="Choose a new password" description="Your reset link is one-time use and expires after 30 minutes.">
      {!token && <div className="form-error" role="alert">This reset link is missing its token. Request a new link to continue.</div>}
      <form className="auth-form" onSubmit={submit}>
        <Field label="New password" name="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={72} hint="At least 12 characters." />
        <FormError error={error} />
        <button className="primary-button" type="submit" disabled={busy || !token}>{busy ? 'Updating password…' : 'Update password'} <span aria-hidden="true">→</span></button>
        <Link className="back-link" to="/login">← Back to sign in</Link>
      </form>
    </AuthFrame>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [logoutError, setLogoutError] = React.useState(null);
  const [busy, setBusy] = React.useState(true);
  const [tab, setTab] = React.useState('fleet');
  const [users, setUsers] = React.useState([]);
  const [drivers, setDrivers] = React.useState([]);
  const [vehicles, setVehicles] = React.useState([]);
  const [shipments, setShipments] = React.useState([]);
  const [shipmentPage, setShipmentPage] = React.useState(1);
  const [shipmentPages, setShipmentPages] = React.useState(1);
  const [shipmentQuery, setShipmentQuery] = React.useState('');
  const [shipmentStatusFilter, setShipmentStatusFilter] = React.useState('');
  const [selectedShipment, setSelectedShipment] = React.useState(null);
  const [trackedShipments, setTrackedShipments] = React.useState([]);
  const [trackingHistory, setTrackingHistory] = React.useState(null);
  const [selectedTrackingId, setSelectedTrackingId] = React.useState('');
  const [simulatorForm, setSimulatorForm] = React.useState({ startLatitude: '', startLongitude: '', endLatitude: '', endLongitude: '' });
  const [showShipmentForm, setShowShipmentForm] = React.useState(false);
  const [editingShipment, setEditingShipment] = React.useState(false);
  const [shipmentForm, setShipmentForm] = React.useState({ referenceNumber: '', description: '', recipientName: '', recipientPhone: '', pickupAddress: '', deliveryAddress: '', estimatedDeliveryAt: '', stopsText: '' });
  const [assignmentForm, setAssignmentForm] = React.useState({ driverId: '', vehicleId: '' });
  const [nextStatus, setNextStatus] = React.useState('');
  const [statusReason, setStatusReason] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [showDriverForm, setShowDriverForm] = React.useState(false);
  const [showVehicleForm, setShowVehicleForm] = React.useState(false);
  const [showUserForm, setShowUserForm] = React.useState(false);
  const [driverForm, setDriverForm] = React.useState({ name: '', email: '', password: '', phone: '', licenseNumber: '', licenseExpiresOn: '' });
  const [vehicleForm, setVehicleForm] = React.useState({ registrationNumber: '', make: '', model: '', vehicleType: 'VAN', capacityKg: '' });
  const [userForm, setUserForm] = React.useState({ name: '', email: '', password: '', role: 'DISPATCHER' });
  const [geofences, setGeofences] = React.useState([]);
  const [routeShipmentId, setRouteShipmentId] = React.useState('');
  const [routeData, setRouteData] = React.useState(null);
  const [geofenceForm, setGeofenceForm] = React.useState({ name: '', kind: 'WAREHOUSE', latitude: '', longitude: '', radiusMeters: '500' });
  const [routeForm, setRouteForm] = React.useState({ name: 'Planned route', stops: '' });
  const [exceptions, setExceptions] = React.useState([]);
  const [exceptionStatusFilter, setExceptionStatusFilter] = React.useState('');
  const [exceptionNotes, setExceptionNotes] = React.useState({});
  const [notifications, setNotifications] = React.useState([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = React.useState(0);
  const [analytics, setAnalytics] = React.useState(null);
  const [performance, setPerformance] = React.useState(null);
  const [analyticsFilters, setAnalyticsFilters] = React.useState({ from: '', to: '', driverId: '', vehicleId: '', status: '' });

  const isAdmin = user && ['ORG_ADMIN', 'SUPER_ADMIN'].includes(user.role);
  const canManageFleet = user && ['ORG_ADMIN', 'SUPER_ADMIN', 'DISPATCHER'].includes(user.role);
  const selectedShipmentRef = React.useRef(selectedShipment);
  const selectedTrackingIdRef = React.useRef(selectedTrackingId);
  const routeShipmentIdRef = React.useRef(routeShipmentId);
  const shipmentListParamsRef = React.useRef({ page: 1, search: '', status: '' });
  const userRoleRef = React.useRef(user?.role);
  selectedShipmentRef.current = selectedShipment;
  selectedTrackingIdRef.current = selectedTrackingId;
  routeShipmentIdRef.current = routeShipmentId;
  userRoleRef.current = user?.role;

  React.useEffect(() => {
    let active = true;
    let socket;
    const freshnessTimer = setInterval(() => {
      setTrackedShipments((current) => current.map((shipment) => {
        if (!shipment.latestLocation) return shipment.freshness === 'NO_SIGNAL' ? shipment : { ...shipment, freshness: 'NO_SIGNAL' };
        const age = Date.now() - new Date(shipment.latestLocation.recordedAt).getTime();
        const freshness = age <= 120_000 ? 'LIVE' : age <= 300_000 ? 'DELAYED' : 'STALE';
        return freshness === shipment.freshness ? shipment : { ...shipment, freshness, latestLocation: { ...shipment.latestLocation, freshness } };
      }));
    }, 30_000);
    apiRequest('/api/auth/me')
      .then(async (result) => {
        if (!active) return;
        setUser(result.user);
        apiRequest('/api/notifications?limit=1').then(({ unreadCount }) => setNotificationUnreadCount(unreadCount)).catch(() => {});
        const isOrgAdmin = ['ORG_ADMIN', 'SUPER_ADMIN'].includes(result.user.role);
        const canSeeFleet = ['ORG_ADMIN', 'SUPER_ADMIN', 'DISPATCHER'].includes(result.user.role);
        setTab(isOrgAdmin || canSeeFleet ? 'fleet' : 'account');
        const requests = [
          canSeeFleet ? apiRequest('/api/team/drivers') : Promise.resolve({ drivers: [] }),
          canSeeFleet ? apiRequest('/api/fleet/vehicles') : Promise.resolve({ vehicles: [] }),
          isOrgAdmin ? apiRequest('/api/team/users') : Promise.resolve({ users: [] }),
          apiRequest('/api/shipments?page=1&limit=20'),
          apiRequest('/api/tracking'),
        ];
        const [driverResult, vehicleResult, userResult, shipmentResult, trackingResult] = await Promise.all(requests);
        if (active) {
          setDrivers(driverResult.drivers);
          setVehicles(vehicleResult.vehicles);
          setUsers(userResult.users);
          setShipments(shipmentResult.shipments);
          setShipmentPages(shipmentResult.pagination.pages || 1);
          setTrackedShipments(trackingResult.shipments);
          if (trackingResult.shipments[0]) setSelectedTrackingId(trackingResult.shipments[0].id);

          socket = createSocket({ path: '/socket.io', withCredentials: true, autoConnect: false, reconnection: true });
          socket.on('connect', () => {
            socket.emit('tracking:subscribe', { scope: userRoleRef.current === 'DRIVER' ? 'assigned' : 'organization' }, (ack) => {
              if (!ack?.ok) {
                setActionError(ack?.error || 'Live tracking subscription failed.');
                apiRequest('/api/auth/me').then(({ user: currentUser }) => {
                  userRoleRef.current = currentUser.role;
                  setUser(currentUser);
                  socket.disconnect(); setTimeout(() => socket.connect(), 100);
                }).catch(() => {});
              }
            });
          });
          socket.on('tracking:location', (payload) => {
            setTrackedShipments((current) => current.map((shipment) => {
              if (shipment.id !== payload.shipmentId) return shipment;
              const previousTime = shipment.latestLocation?.recordedAt ? new Date(shipment.latestLocation.recordedAt).getTime() : -Infinity;
              const incomingTime = new Date(payload.location.recordedAt).getTime();
              if (incomingTime < previousTime) return shipment;
              return { ...shipment, status: payload.status, trackingNumber: payload.trackingNumber, latestLocation: payload.location, freshness: payload.location.freshness };
            }));
            if (selectedTrackingIdRef.current === payload.shipmentId) {
              apiRequest(`/api/tracking/${payload.shipmentId}/history`).then(setTrackingHistory).catch(() => {});
            }
          });
          const refreshSpatialProgress = (payload) => {
            const text = payload.transition
              ? `${payload.transition === 'ENTRY' ? 'Entered' : 'Exited'} geofence: ${payload.name}`
              : `${payload.status === 'ARRIVED' ? 'Arrived at' : 'Departed'} stop: ${payload.name}`;
            setNotice(`${text}${payload.source === 'SIMULATOR' ? ' (simulated GPS)' : ''}`);
            const currentRouteShipmentId = routeShipmentIdRef.current;
            if (currentRouteShipmentId && currentRouteShipmentId === payload.shipmentId) {
              apiRequest(`/api/routes/${currentRouteShipmentId}`).then(setRouteData).catch(() => {});
            }
          };
          socket.on('geofence:transition', refreshSpatialProgress);
          socket.on('stop:updated', refreshSpatialProgress);
          const refreshExceptions = (payload) => {
            setNotice(payload.type ? `Shipment exception: ${payload.type.replaceAll('_', ' ')}` : 'Shipment exception updated.');
            apiRequest('/api/exceptions').then(({ exceptions: items }) => setExceptions(items)).catch(() => {});
          };
          socket.on('exception:created', refreshExceptions);
          socket.on('exception:updated', refreshExceptions);
          socket.on('notification:created', (notification) => {
            setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50));
            setNotificationUnreadCount((count) => count + (notification.readAt ? 0 : 1));
            setNotice(notification.title);
          });
          socket.on('notification:read-all', () => setNotificationUnreadCount(0));
          const refreshShipments = () => {
            const filters = shipmentListParamsRef.current;
            const params = new URLSearchParams({ page: String(filters.page), limit: '20' });
            if (filters.search) params.set('q', filters.search);
            if (filters.status) params.set('status', filters.status);
            apiRequest(`/api/shipments?${params}`).then((resultPage) => {
              setShipments(resultPage.shipments); setShipmentPages(resultPage.pagination.pages || 1);
            }).catch(() => {});
          };
          const refreshTracking = () => apiRequest('/api/tracking').then((resultPage) => setTrackedShipments(resultPage.shipments)).catch(() => {});
          socket.on('shipment:created', () => { refreshShipments(); refreshTracking(); });
          socket.on('shipment:updated', (payload) => {
            refreshShipments(); refreshTracking();
            if (selectedShipmentRef.current?.id === payload.shipmentId) {
              apiRequest(`/api/shipments/${payload.shipmentId}`).then(({ shipment }) => setSelectedShipment(shipment)).catch(() => {});
            }
          });
          socket.on('shipment:assigned', (payload) => {
            socket.emit('shipment:subscribe', { shipmentId: payload.shipmentId });
            refreshShipments(); refreshTracking();
          });
          socket.on('shipment:unassigned', () => { refreshShipments(); refreshTracking(); });
          let recovering = false;
          socket.on('connect_error', async () => {
            if (recovering) return;
            recovering = true;
            try { await apiRequest('/api/auth/me'); socket.connect(); }
            catch (caught) { if (caught.status === 401) navigate('/login', { replace: true }); }
            finally { recovering = false; }
          });
          socket.connect();
        }
      })
      .catch((caught) => { if (active) setError(caught); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; clearInterval(freshnessTimer); socket?.disconnect(); };
  }, []);

  React.useEffect(() => {
    if (!user) return;
    if (tab === 'geofences' || tab === 'routes') apiRequest('/api/geofences?includeInactive=true').then(({ geofences: items }) => setGeofences(items)).catch((caught) => setActionError(caught.message));
    if (tab === 'routes' && routeShipmentId) apiRequest(`/api/routes/${routeShipmentId}`).then(setRouteData).catch((caught) => setActionError(caught.message));
    if (tab === 'exceptions') {
      const params = new URLSearchParams();
      if (exceptionStatusFilter) params.set('status', exceptionStatusFilter);
      apiRequest(`/api/exceptions?${params}`).then(({ exceptions: result }) => setExceptions(result)).catch((caught) => setActionError(caught.message));
    }
    if (tab === 'notifications') apiRequest('/api/notifications?limit=50').then((result) => { setNotifications(result.notifications); setNotificationUnreadCount(result.unreadCount); }).catch((caught) => setActionError(caught.message));
    if (tab === 'analytics') {
      const params = new URLSearchParams(Object.entries(analyticsFilters).filter(([, value]) => value));
      Promise.all([apiRequest(`/api/analytics/overview?${params}`), apiRequest(`/api/analytics/performance?${params}`)])
        .then(([summary, breakdown]) => { setAnalytics(summary); setPerformance(breakdown); })
        .catch((caught) => setActionError(caught.message));
    }
  }, [user, tab, routeShipmentId, exceptionStatusFilter, analyticsFilters]);

  async function reloadFleet() {
    const [driverResult, vehicleResult] = await Promise.all([
      apiRequest('/api/team/drivers'), apiRequest('/api/fleet/vehicles'),
    ]);
    setDrivers(driverResult.drivers);
    setVehicles(vehicleResult.vehicles);
  }

  async function reloadUsers() {
    const result = await apiRequest('/api/team/users');
    setUsers(result.users);
  }

  async function loadShipments(page = shipmentPage, search = shipmentQuery, status = shipmentStatusFilter) {
    shipmentListParamsRef.current = { page, search: search.trim(), status };
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search.trim()) params.set('q', search.trim());
    if (status) params.set('status', status);
    const result = await apiRequest(`/api/shipments?${params}`);
    setShipments(result.shipments);
    setShipmentPage(result.pagination.page);
    setShipmentPages(result.pagination.pages || 1);
  }

  async function loadTracking() {
    const result = await apiRequest('/api/tracking');
    setTrackedShipments(result.shipments);
    if (!selectedTrackingId && result.shipments[0]) setSelectedTrackingId(result.shipments[0].id);
  }

  async function loadTrackingHistory(shipmentId) {
    await perform(async () => {
      const result = await apiRequest(`/api/tracking/${shipmentId}/history`);
      setSelectedTrackingId(shipmentId);
      setTrackingHistory(result);
    }, '');
  }

  async function runGpsSimulation(event) {
    event.preventDefault();
    if (!selectedTrackingId) return;
    await perform(async () => {
      const number = (value) => Number(value);
      await apiRequest(`/api/tracking/simulate/${selectedTrackingId}`, { method: 'POST', body: JSON.stringify({
        start: { latitude: number(simulatorForm.startLatitude), longitude: number(simulatorForm.startLongitude) },
        end: { latitude: number(simulatorForm.endLatitude), longitude: number(simulatorForm.endLongitude) },
        points: 6, durationMinutes: 15,
      }) });
      await loadTracking();
      const history = await apiRequest(`/api/tracking/${selectedTrackingId}/history`);
      setTrackingHistory(history);
    }, 'Simulated GPS points added to the selected shipment.');
  }

  async function shareCurrentLocation() {
    if (!selectedShipment?.vehicle?.id || !navigator.geolocation) {
      setActionError('Location sharing is unavailable in this browser.'); return;
    }
    await perform(() => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        await apiRequest('/api/tracking/locations', { method: 'POST', body: JSON.stringify({
          sourceEventId: crypto.randomUUID(),
          shipmentId: selectedShipment.id,
          vehicleId: selectedShipment.vehicle.id,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          speedKph: Number.isFinite(position.coords.speed) ? position.coords.speed * 3.6 : undefined,
          headingDegrees: Number.isFinite(position.coords.heading) ? Math.round(position.coords.heading) : undefined,
          recordedAt: new Date(position.timestamp).toISOString(),
        }) });
        const { shipment } = await apiRequest(`/api/shipments/${selectedShipment.id}`);
        setSelectedShipment(shipment); await loadTracking(); resolve();
      } catch (caught) { reject(caught); }
    }, (caught) => reject(new Error(caught.message)), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })), 'Your current location was shared with dispatch.');
  }

  function parseStops(value) {
    return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const separator = line.indexOf('|');
      if (separator < 1) throw new Error('Write each stop as Name | full address.');
      return { name: line.slice(0, separator).trim(), address: line.slice(separator + 1).trim() };
    });
  }

  async function createShipment(event) {
    event.preventDefault();
    await perform(async () => {
      const { stopsText, estimatedDeliveryAt, ...fields } = shipmentForm;
      const body = {
        ...fields,
        referenceNumber: fields.referenceNumber || (editingShipment ? null : undefined),
        recipientPhone: fields.recipientPhone || (editingShipment ? null : undefined),
        estimatedDeliveryAt: estimatedDeliveryAt ? new Date(estimatedDeliveryAt).toISOString() : (editingShipment ? null : undefined),
        stops: parseStops(stopsText),
      };
      if (editingShipment && selectedShipment) {
        await apiRequest(`/api/shipments/${selectedShipment.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        await openShipment(selectedShipment.id);
      } else {
        await apiRequest('/api/shipments', { method: 'POST', body: JSON.stringify(body) });
        await loadShipments(1, '', '');
        setShipmentQuery(''); setShipmentStatusFilter('');
      }
      setShipmentForm({ referenceNumber: '', description: '', recipientName: '', recipientPhone: '', pickupAddress: '', deliveryAddress: '', estimatedDeliveryAt: '', stopsText: '' });
      setShowShipmentForm(false); setEditingShipment(false);
    }, 'Shipment created.');
  }

  async function openShipment(shipmentId) {
    setActionError(''); setNotice('');
    try {
      const { shipment } = await apiRequest(`/api/shipments/${shipmentId}`);
      setSelectedShipment(shipment);
      setAssignmentForm({ driverId: shipment.driver?.id || '', vehicleId: shipment.vehicle?.id || '' });
      setNextStatus(shipment.allowedTransitions[0] || '');
    } catch (caught) { setActionError(caught.message); }
  }

  async function saveAssignment() {
    if (!selectedShipment) return;
    await perform(async () => {
      await apiRequest(`/api/shipments/${selectedShipment.id}/assignment`, { method: 'PATCH', body: JSON.stringify({ driverId: assignmentForm.driverId || null, vehicleId: assignmentForm.vehicleId || null }) });
      const { shipment } = await apiRequest(`/api/shipments/${selectedShipment.id}`);
      setSelectedShipment(shipment); await loadShipments();
    }, 'Shipment assignment saved.');
  }

  async function changeShipmentStatus() {
    if (!selectedShipment || !nextStatus) return;
    await perform(async () => {
      await apiRequest(`/api/shipments/${selectedShipment.id}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus, reason: statusReason || undefined }) });
      setStatusReason('');
      const { shipment } = await apiRequest(`/api/shipments/${selectedShipment.id}`);
      setSelectedShipment(shipment); setNextStatus(shipment.allowedTransitions[0] || ''); await loadShipments();
    }, 'Shipment status updated.');
  }

  async function updateShipmentSearch(event) {
    event.preventDefault();
    await perform(() => loadShipments(1, shipmentQuery, shipmentStatusFilter), 'Shipment list updated.');
  }

  function beginEditShipment() {
    if (!selectedShipment) return;
    setShipmentForm({
      referenceNumber: selectedShipment.referenceNumber || '', description: selectedShipment.description,
      recipientName: selectedShipment.recipientName, recipientPhone: selectedShipment.recipientPhone || '',
      pickupAddress: selectedShipment.pickupAddress, deliveryAddress: selectedShipment.deliveryAddress,
      estimatedDeliveryAt: selectedShipment.estimatedDeliveryAt ? new Date(selectedShipment.estimatedDeliveryAt).toISOString().slice(0, 16) : '',
      stopsText: selectedShipment.stops.map((stop) => `${stop.name} | ${stop.address}`).join('\n'),
    });
    setEditingShipment(true); setShowShipmentForm(true);
  }

  async function perform(action, successMessage) {
    setActionError(''); setNotice(''); setSaving(true);
    try { await action(); setNotice(successMessage); }
    catch (caught) { setActionError(caught.message); }
    finally { setSaving(false); }
  }

  async function createDriver(event) {
    event.preventDefault();
    await perform(async () => {
      await apiRequest('/api/team/drivers', { method: 'POST', body: JSON.stringify({ ...driverForm, licenseExpiresOn: driverForm.licenseExpiresOn || undefined, phone: driverForm.phone || undefined }) });
      await reloadFleet(); setDriverForm({ name: '', email: '', password: '', phone: '', licenseNumber: '', licenseExpiresOn: '' }); setShowDriverForm(false);
    }, 'Driver added to your team.');
  }

  async function createVehicle(event) {
    event.preventDefault();
    await perform(async () => {
      await apiRequest('/api/fleet/vehicles', { method: 'POST', body: JSON.stringify({ ...vehicleForm, capacityKg: vehicleForm.capacityKg ? Number(vehicleForm.capacityKg) : undefined }) });
      await reloadFleet(); setVehicleForm({ registrationNumber: '', make: '', model: '', vehicleType: 'VAN', capacityKg: '' }); setShowVehicleForm(false);
    }, 'Vehicle added to your fleet.');
  }

  async function createUser(event) {
    event.preventDefault();
    await perform(async () => {
      await apiRequest('/api/team/users', { method: 'POST', body: JSON.stringify(userForm) });
      await reloadUsers(); setUserForm({ name: '', email: '', password: '', role: 'DISPATCHER' }); setShowUserForm(false);
    }, 'Team member added.');
  }

  async function updateUser(member, update) {
    await perform(async () => {
      await apiRequest(`/api/team/users/${member.id}`, { method: 'PATCH', body: JSON.stringify(update) });
      await reloadUsers();
    }, 'Team member updated.');
  }

  async function updateVehicle(vehicleId, update) {
    await perform(async () => {
      await apiRequest(`/api/fleet/vehicles/${vehicleId}`, { method: 'PATCH', body: JSON.stringify(update) });
      const result = await apiRequest('/api/fleet/vehicles'); setVehicles(result.vehicles);
    }, 'Vehicle assignment updated.');
  }

  async function createGeofence(event) {
    event.preventDefault();
    await perform(async () => {
      await apiRequest('/api/geofences', { method: 'POST', body: JSON.stringify({ name: geofenceForm.name, kind: geofenceForm.kind, shape: 'CIRCLE', center: { latitude: Number(geofenceForm.latitude), longitude: Number(geofenceForm.longitude) }, radiusMeters: Number(geofenceForm.radiusMeters) }) });
      const result = await apiRequest('/api/geofences?includeInactive=true'); setGeofences(result.geofences);
      setGeofenceForm({ name: '', kind: 'WAREHOUSE', latitude: '', longitude: '', radiusMeters: '500' });
    }, 'Geofence created. Entry and exit events will be recorded with incoming GPS updates.');
  }

  async function toggleGeofence(geofence) {
    await perform(async () => {
      await apiRequest(`/api/geofences/${geofence.id}`, { method: 'PATCH', body: JSON.stringify({ active: !geofence.active }) });
      const result = await apiRequest('/api/geofences?includeInactive=true'); setGeofences(result.geofences);
    }, 'Geofence updated.');
  }

  async function createRoute(event) {
    event.preventDefault();
    await perform(async () => {
      const waypoints = routeForm.stops.split('\n').map((line) => line.split('|').map((part) => part.trim())).filter((parts) => parts.length >= 5).map(([kind, name, address, latitude, longitude]) => ({ kind: kind.toUpperCase(), name, address, latitude: Number(latitude), longitude: Number(longitude) }));
      if (!routeShipmentId || waypoints.length < 2) throw new Error('Choose a shipment and enter at least two valid stops.');
      const result = await apiRequest(`/api/routes/${routeShipmentId}`, { method: 'POST', body: JSON.stringify({ name: routeForm.name, waypoints }) });
      setRouteData({ shipmentId: routeShipmentId, current: result.route, routes: [result.route] });
    }, 'Route version saved.');
  }

  async function runExceptionScan() {
    let summary;
    await perform(async () => {
      const { scan } = await apiRequest('/api/exceptions/scan', { method: 'POST', body: JSON.stringify({}) });
      summary = scan;
      const params = new URLSearchParams();
      if (exceptionStatusFilter) params.set('status', exceptionStatusFilter);
      const result = await apiRequest(`/api/exceptions?${params}`);
      setExceptions(result.exceptions);
    }, '');
    if (summary) setNotice(`Scan complete: ${summary.detected} new, ${summary.escalated} escalated, ${summary.resolved} automatically cleared.`);
  }

  async function updateException(exception, update, successMessage) {
    await perform(async () => {
      await apiRequest(`/api/exceptions/${exception.id}`, { method: 'PATCH', body: JSON.stringify(update) });
      const params = new URLSearchParams();
      if (exceptionStatusFilter) params.set('status', exceptionStatusFilter);
      const result = await apiRequest(`/api/exceptions?${params}`);
      setExceptions(result.exceptions);
    }, successMessage);
  }

  async function markNotificationRead(notification) {
    if (notification.readAt) return;
    await perform(async () => {
      const { notification: updated } = await apiRequest(`/api/notifications/${notification.id}/read`, { method: 'PATCH', body: JSON.stringify({}) });
      setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotificationUnreadCount((count) => Math.max(0, count - 1));
    }, 'Notification marked as read.');
  }

  async function markAllNotificationsRead() {
    await perform(async () => {
      await apiRequest('/api/notifications/read-all', { method: 'POST', body: JSON.stringify({}) });
      const { notifications: items, unreadCount } = await apiRequest('/api/notifications?limit=50');
      setNotifications(items); setNotificationUnreadCount(unreadCount);
    }, 'All notifications marked as read.');
  }

  async function signOut() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      navigate('/login', { replace: true });
    } catch (caught) {
      setLogoutError(caught);
    }
  }

  if (busy) return <main className="loading-screen"><span className="loader" />Loading your workspace…</main>;
  if (!user && error?.status === 401) return <Navigate to="/login" replace />;
  if (!user) {
    return (
      <main className="loading-screen error-screen">
        <div><h1>We couldn’t load your workspace</h1><p>{error?.message ?? 'Check your connection and try again.'}</p><button className="primary-button" onClick={() => window.location.reload()}>Try again</button><Link className="text-link" to="/login">Return to sign in</Link></div>
      </main>
    );
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Brand />
        <div className="header-actions"><span className="user-chip"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}</span></span><button className="quiet-button" onClick={signOut}>Sign out</button></div>
      </header>
      <section className="workspace-content">
        {logoutError && <div className="form-error workspace-error" role="alert">{logoutError.message}</div>}
        <p className="eyebrow">{user.organization.name}</p>
        <h1>Operations workspace</h1>
        <p className="workspace-intro">Welcome, {user.name.split(' ')[0]}. Manage your team and fleet in one place.</p>
        <nav className="workspace-tabs" aria-label="Workspace sections">
          <button className={tab === 'shipments' ? 'active' : ''} onClick={() => { setTab('shipments'); setSelectedShipment(null); }}>Shipments</button>
          <button className={tab === 'tracking' ? 'active' : ''} onClick={() => { setTab('tracking'); setTrackingHistory(null); }}>Tracking</button>
          {canManageFleet && <button className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>Routes</button>}
          {canManageFleet && <button className={tab === 'geofences' ? 'active' : ''} onClick={() => setTab('geofences')}>Geofences</button>}
          {canManageFleet && <button className={tab === 'exceptions' ? 'active' : ''} onClick={() => setTab('exceptions')}>Exceptions</button>}
          {canManageFleet && <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}>Analytics</button>}
          <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}>Notifications{notificationUnreadCount > 0 && <span className="notification-count">{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}</span>}</button>
          {canManageFleet && <button className={tab === 'fleet' ? 'active' : ''} onClick={() => setTab('fleet')}>Fleet</button>}
          {isAdmin && <button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>Team</button>}
          <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>Account</button>
        </nav>
        {(actionError || notice) && <div className={actionError ? 'form-error workspace-error' : 'form-success workspace-error'} role={actionError ? 'alert' : 'status'}>{actionError || notice}</div>}

        {tab === 'shipments' && <>
          {!selectedShipment ? <>
            <div className="section-heading"><div><h2>Shipments</h2><p>Search deliveries, check progress, and open shipment history.</p></div>{canManageFleet && <button className="small-primary" onClick={() => { setEditingShipment(false); setShowShipmentForm((value) => !value); }}>{showShipmentForm ? 'Close' : 'Create shipment'}</button>}</div>
            {showShipmentForm && <form className="management-form shipment-form" onSubmit={createShipment}>
              <label>Reference number<input maxLength="80" value={shipmentForm.referenceNumber} onChange={(event) => setShipmentForm({ ...shipmentForm, referenceNumber: event.target.value })} /></label>
              <label>Shipment description<input required minLength="3" maxLength="240" value={shipmentForm.description} onChange={(event) => setShipmentForm({ ...shipmentForm, description: event.target.value })} /></label>
              <label>Recipient name<input required minLength="2" value={shipmentForm.recipientName} onChange={(event) => setShipmentForm({ ...shipmentForm, recipientName: event.target.value })} /></label>
              <label>Recipient phone<input value={shipmentForm.recipientPhone} onChange={(event) => setShipmentForm({ ...shipmentForm, recipientPhone: event.target.value })} /></label>
              <label>Pickup address<input required minLength="5" value={shipmentForm.pickupAddress} onChange={(event) => setShipmentForm({ ...shipmentForm, pickupAddress: event.target.value })} /></label>
              <label>Delivery address<input required minLength="5" value={shipmentForm.deliveryAddress} onChange={(event) => setShipmentForm({ ...shipmentForm, deliveryAddress: event.target.value })} /></label>
              <label>Estimated delivery<input type="datetime-local" value={shipmentForm.estimatedDeliveryAt} onChange={(event) => setShipmentForm({ ...shipmentForm, estimatedDeliveryAt: event.target.value })} /></label>
              <label className="wide-field">Intermediate stops <textarea rows="3" placeholder={'Warehouse | 100 Market Street, Springfield'} value={shipmentForm.stopsText} onChange={(event) => setShipmentForm({ ...shipmentForm, stopsText: event.target.value })} /><small>Optional. Enter one stop per line as Name | full address.</small></label>
              <div className="wide-field shipment-form-actions"><button className="small-primary" disabled={saving}>{saving ? 'Saving…' : editingShipment ? 'Save shipment' : 'Create shipment'}</button>{editingShipment && <button type="button" className="quiet-button" onClick={() => { setShowShipmentForm(false); setEditingShipment(false); }}>Cancel</button>}</div>
            </form>}
            <form className="shipment-filters" onSubmit={updateShipmentSearch}>
              <input aria-label="Search shipments" placeholder="Tracking number, recipient, or reference" value={shipmentQuery} onChange={(event) => setShipmentQuery(event.target.value)} />
              <select aria-label="Filter by status" value={shipmentStatusFilter} onChange={(event) => setShipmentStatusFilter(event.target.value)}><option value="">All statuses</option>{['CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select>
              <button className="small-primary" disabled={saving}>Search</button>
            </form>
            <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Tracking</th><th>Shipment</th><th>Route</th><th>Driver / vehicle</th><th>Status</th><th></th></tr></thead><tbody>{shipments.length ? shipments.map((shipment) => <tr key={shipment.id}><td><strong>{shipment.trackingNumber}</strong><small>{shipment.referenceNumber || 'No reference'}</small></td><td>{shipment.recipientName}<small>{shipment.description}</small></td><td>{shipment.pickupAddress}<small>to {shipment.deliveryAddress}</small></td><td>{shipment.driver?.name || 'Unassigned'}<small>{shipment.vehicle?.registrationNumber || 'No vehicle'}</small></td><td><span className={`status-pill shipment-${shipment.status.toLowerCase()}`}>{shipment.status.replaceAll('_', ' ')}</span></td><td><button className="text-action view-action" onClick={() => openShipment(shipment.id)}>View</button></td></tr>) : <tr><td colSpan="6" className="empty-row">No shipments match this search.</td></tr>}</tbody></table></div>
            <div className="pagination"><span>Page {shipmentPage} of {shipmentPages}</span><div><button className="quiet-button" disabled={shipmentPage <= 1 || saving} onClick={() => perform(() => loadShipments(shipmentPage - 1), '')}>← Previous</button><button className="quiet-button" disabled={shipmentPage >= shipmentPages || saving} onClick={() => perform(() => loadShipments(shipmentPage + 1), '')}>Next →</button></div></div>
          </> : <>
            <div className="shipment-detail-heading"><button className="quiet-button" onClick={() => { setSelectedShipment(null); setShowShipmentForm(false); }}>← All shipments</button><span className={`status-pill shipment-${selectedShipment.status.toLowerCase()}`}>{selectedShipment.status.replaceAll('_', ' ')}</span></div>
            <div className="shipment-detail-title"><div><p className="eyebrow">{selectedShipment.trackingNumber}</p><h2>{selectedShipment.description}</h2><p>{selectedShipment.referenceNumber || 'No customer reference'} · Created {new Date(selectedShipment.createdAt).toLocaleString()}</p></div>{canManageFleet && ['CREATED', 'ASSIGNED'].includes(selectedShipment.status) && <button className="small-primary" onClick={beginEditShipment}>Edit details</button>}</div>
            {showShipmentForm && editingShipment && <form className="management-form shipment-form" onSubmit={createShipment}>
              <label>Reference number<input maxLength="80" value={shipmentForm.referenceNumber} onChange={(event) => setShipmentForm({ ...shipmentForm, referenceNumber: event.target.value })} /></label>
              <label>Shipment description<input required minLength="3" value={shipmentForm.description} onChange={(event) => setShipmentForm({ ...shipmentForm, description: event.target.value })} /></label>
              <label>Recipient name<input required value={shipmentForm.recipientName} onChange={(event) => setShipmentForm({ ...shipmentForm, recipientName: event.target.value })} /></label>
              <label>Recipient phone<input value={shipmentForm.recipientPhone} onChange={(event) => setShipmentForm({ ...shipmentForm, recipientPhone: event.target.value })} /></label>
              <label>Pickup address<input required value={shipmentForm.pickupAddress} onChange={(event) => setShipmentForm({ ...shipmentForm, pickupAddress: event.target.value })} /></label>
              <label>Delivery address<input required value={shipmentForm.deliveryAddress} onChange={(event) => setShipmentForm({ ...shipmentForm, deliveryAddress: event.target.value })} /></label>
              <label>Estimated delivery<input type="datetime-local" value={shipmentForm.estimatedDeliveryAt} onChange={(event) => setShipmentForm({ ...shipmentForm, estimatedDeliveryAt: event.target.value })} /></label>
              <label className="wide-field">Intermediate stops <textarea rows="3" value={shipmentForm.stopsText} onChange={(event) => setShipmentForm({ ...shipmentForm, stopsText: event.target.value })} /><small>One stop per line as Name | full address.</small></label>
              <div className="wide-field shipment-form-actions"><button className="small-primary" disabled={saving}>{saving ? 'Saving…' : 'Save shipment'}</button><button type="button" className="quiet-button" onClick={() => { setShowShipmentForm(false); setEditingShipment(false); }}>Cancel</button></div>
            </form>}
            <div className="shipment-detail-grid">
              <article className="detail-card"><h3>Delivery</h3><dl><dt>Recipient</dt><dd>{selectedShipment.recipientName}{selectedShipment.recipientPhone && <small>{selectedShipment.recipientPhone}</small>}</dd><dt>Pickup</dt><dd>{selectedShipment.pickupAddress}</dd><dt>Delivery</dt><dd>{selectedShipment.deliveryAddress}</dd><dt>Estimated arrival</dt><dd>{selectedShipment.estimatedDeliveryAt ? new Date(selectedShipment.estimatedDeliveryAt).toLocaleString() : 'Not set'}</dd></dl></article>
              <article className="detail-card"><h3>Stops</h3>{selectedShipment.stops.length ? <ol className="stop-list">{selectedShipment.stops.map((stop) => <li key={stop.id}><strong>{stop.name}</strong><span>{stop.address}</span></li>)}</ol> : <p className="muted-copy">No intermediate stops.</p>}</article>
            </div>
            {user.role === 'DRIVER' && selectedShipment.vehicle && ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY'].includes(selectedShipment.status) && <article className="detail-card driver-location-card"><div><h3>Share current GPS location</h3><p>ShipPulse will request this device’s current position only after you choose the button.</p></div><button className="small-primary" onClick={shareCurrentLocation} disabled={saving}>{saving ? 'Sharing…' : 'Use my current location'}</button></article>}
            {canManageFleet && !['PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'].includes(selectedShipment.status) && <article className="detail-card dispatch-card"><h3>Dispatch assignment</h3><div className="dispatch-controls"><label>Driver<select className="table-select" value={assignmentForm.driverId} onChange={(event) => setAssignmentForm({ ...assignmentForm, driverId: event.target.value })}><option value="">Select driver</option>{drivers.filter((driver) => driver.status === 'ACTIVE').map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label><label>Vehicle<select className="table-select" value={assignmentForm.vehicleId} onChange={(event) => setAssignmentForm({ ...assignmentForm, vehicleId: event.target.value })}><option value="">Select vehicle</option>{vehicles.filter((vehicle) => vehicle.status === 'ACTIVE' && (!vehicle.assignedDriverId || vehicle.assignedDriverId === assignmentForm.driverId)).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registrationNumber} · {vehicle.make} {vehicle.model}</option>)}</select></label><button className="small-primary" onClick={saveAssignment} disabled={saving}>{saving ? 'Saving…' : selectedShipment.status === 'ASSIGNED' ? 'Update assignment' : 'Assign shipment'}</button></div></article>}
            {canManageFleet && selectedShipment.allowedTransitions.length > 0 && <article className="detail-card dispatch-card"><h3>Update shipment status</h3><div className="dispatch-controls"><label>Next status<select className="table-select" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>{selectedShipment.allowedTransitions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label><label>Update note<input value={statusReason} maxLength="300" onChange={(event) => setStatusReason(event.target.value)} placeholder="Optional note for the history" /></label><button className="small-primary" onClick={changeShipmentStatus} disabled={saving || !nextStatus}>Update status</button></div></article>}
            <article className="detail-card event-card"><h3>Shipment history</h3><ol className="event-list">{selectedShipment.events.map((event) => <li key={event.id}><span className="event-dot" /><div><strong>{event.description}</strong><small>{event.actorName} · {new Date(event.createdAt).toLocaleString()}</small></div></li>)}</ol></article>
          </>}
        </>}

        {tab === 'tracking' && <>
          <div className="section-heading"><div><h2>Shipment tracking</h2><p>Latest known GPS position and signal freshness for active shipments.</p></div><button className="small-primary" onClick={() => perform(loadTracking, 'Tracking positions refreshed.')} disabled={saving}>Refresh positions</button></div>
          <div className="map-panel"><div className="map-heading"><div><strong>Live fleet map</strong><span>Positions update as new GPS reports arrive.</span></div><div className="map-legend"><span><i className="legend-live" /> Live</span><span><i className="legend-delayed" /> Delayed</span><span><i className="legend-stale" /> Stale</span></div></div><React.Suspense fallback={<div className="map-loading">Loading map controls…</div>}><LiveTrackingMap shipments={trackedShipments} /></React.Suspense></div>
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Shipment</th><th>Vehicle / driver</th><th>Last known position</th><th>Last update</th><th>Signal</th><th></th></tr></thead><tbody>{trackedShipments.length ? trackedShipments.map((shipment) => <tr key={shipment.id}><td><strong>{shipment.trackingNumber}</strong><small>{shipment.description}</small></td><td>{shipment.vehicle?.registrationNumber || 'No vehicle'}<small>{shipment.driver?.name || 'No driver'}</small></td><td>{shipment.latestLocation ? `${shipment.latestLocation.latitude.toFixed(5)}, ${shipment.latestLocation.longitude.toFixed(5)}` : 'No GPS update'}{shipment.latestLocation?.source === 'SIMULATOR' && <small className="simulated-label">SIMULATED LOCATION</small>}</td><td>{shipment.latestLocation ? new Date(shipment.latestLocation.recordedAt).toLocaleString() : '—'}</td><td><span className={`status-pill signal-${shipment.freshness.toLowerCase()}`}>{shipment.freshness.replaceAll('_', ' ')}</span></td><td><button className="text-action view-action" onClick={() => loadTrackingHistory(shipment.id)}>History</button></td></tr>) : <tr><td colSpan="6" className="empty-row">No actively assigned shipments to track.</td></tr>}</tbody></table></div>
          {trackingHistory && <article className="detail-card event-card"><div className="section-heading history-heading"><div><h3>Location history</h3><p>Recorded GPS positions, shown from oldest to newest.</p></div><span className="connected-pill"><span /> {trackingHistory.locations.length} points</span></div>{trackingHistory.locations.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Recorded</th><th>Latitude</th><th>Longitude</th><th>Speed</th><th>Accuracy</th><th>Source</th></tr></thead><tbody>{trackingHistory.locations.map((location) => <tr key={location.id}><td>{new Date(location.recordedAt).toLocaleString()}</td><td>{location.latitude.toFixed(6)}</td><td>{location.longitude.toFixed(6)}</td><td>{location.speedKph === null ? '—' : `${location.speedKph.toFixed(1)} km/h`}</td><td>{location.accuracyMeters === null ? '—' : `${location.accuracyMeters.toFixed(0)} m`}</td><td>{location.source === 'SIMULATOR' ? <span className="simulated-label">SIMULATED</span> : 'Device'}<small>{location.freshness}</small></td></tr>)}</tbody></table></div> : <p className="muted-copy">No GPS points recorded for this shipment yet.</p>}</article>}
          {import.meta.env.DEV && canManageFleet && trackedShipments.length > 0 && <article className="detail-card simulator-card"><div className="simulator-heading"><div><span className="simulated-label">DEVELOPMENT ONLY</span><h3>GPS route simulator</h3><p>Creates clearly marked sample points between the coordinates you enter.</p></div></div><form className="simulator-form" onSubmit={runGpsSimulation}><label>Shipment<select required value={selectedTrackingId} onChange={(event) => { setSelectedTrackingId(event.target.value); setTrackingHistory(null); }}>{trackedShipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.trackingNumber} · {shipment.status.replaceAll('_', ' ')}</option>)}</select></label><div className="coordinate-row"><label>Start latitude<input required type="number" min="-90" max="90" step="any" value={simulatorForm.startLatitude} onChange={(event) => setSimulatorForm({ ...simulatorForm, startLatitude: event.target.value })} /></label><label>Start longitude<input required type="number" min="-180" max="180" step="any" value={simulatorForm.startLongitude} onChange={(event) => setSimulatorForm({ ...simulatorForm, startLongitude: event.target.value })} /></label></div><div className="coordinate-row"><label>End latitude<input required type="number" min="-90" max="90" step="any" value={simulatorForm.endLatitude} onChange={(event) => setSimulatorForm({ ...simulatorForm, endLatitude: event.target.value })} /></label><label>End longitude<input required type="number" min="-180" max="180" step="any" value={simulatorForm.endLongitude} onChange={(event) => setSimulatorForm({ ...simulatorForm, endLongitude: event.target.value })} /></label></div><button className="small-primary" disabled={saving}>{saving ? 'Generating…' : 'Generate simulated GPS points'}</button></form></article>}
        </>}

        {tab === 'geofences' && canManageFleet && <>
          <div className="section-heading"><div><h2>Geofences</h2><p>Create circular warehouse or delivery areas. GPS points inside them generate entry and exit events.</p></div></div>
          <form className="management-form" onSubmit={createGeofence}>
            <label>Name<input required minLength="2" maxLength="120" value={geofenceForm.name} onChange={(event) => setGeofenceForm({ ...geofenceForm, name: event.target.value })} /></label>
            <label>Purpose<select value={geofenceForm.kind} onChange={(event) => setGeofenceForm({ ...geofenceForm, kind: event.target.value })}><option value="WAREHOUSE">Warehouse</option><option value="DELIVERY">Delivery area</option><option value="CUSTOM">Custom</option></select></label>
            <label>Center latitude<input required type="number" min="-90" max="90" step="any" value={geofenceForm.latitude} onChange={(event) => setGeofenceForm({ ...geofenceForm, latitude: event.target.value })} /></label>
            <label>Center longitude<input required type="number" min="-180" max="180" step="any" value={geofenceForm.longitude} onChange={(event) => setGeofenceForm({ ...geofenceForm, longitude: event.target.value })} /></label>
            <label>Radius in meters<input required type="number" min="25" max="50000" value={geofenceForm.radiusMeters} onChange={(event) => setGeofenceForm({ ...geofenceForm, radiusMeters: event.target.value })} /></label>
            <button className="small-primary" disabled={saving}>{saving ? 'Saving…' : 'Create geofence'}</button>
          </form>
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Purpose</th><th>Shape</th><th>Status</th><th></th></tr></thead><tbody>{geofences.length ? geofences.map((fence) => <tr key={fence.id}><td><strong>{fence.name}</strong></td><td>{fence.kind.replaceAll('_', ' ')}</td><td>{fence.shape}{fence.radiusMeters ? <small>{fence.radiusMeters} m radius</small> : null}</td><td><span className={`status-pill ${fence.active ? 'active' : 'inactive'}`}>{fence.active ? 'ACTIVE' : 'INACTIVE'}</span></td><td><button className="text-action" onClick={() => toggleGeofence(fence)}>{fence.active ? 'Deactivate' : 'Activate'}</button></td></tr>) : <tr><td colSpan="5" className="empty-row">No geofences yet. Add one above to track arrivals and departures.</td></tr>}</tbody></table></div>
        </>}

        {tab === 'routes' && canManageFleet && <>
          <div className="section-heading"><div><h2>Shipment routes</h2><p>Save ordered waypoints and review planned and device-recorded distance. Route distance follows straight lines between stops.</p></div></div>
          <label className="route-shipment-picker">Shipment<select value={routeShipmentId} onChange={(event) => { setRouteShipmentId(event.target.value); setRouteData(null); }}><option value="">Choose an active shipment</option>{shipments.filter((shipment) => !['DELIVERED', 'FAILED', 'CANCELLED'].includes(shipment.status)).map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.trackingNumber} · {shipment.recipientName}</option>)}</select></label>
          {routeShipmentId && <>
            <form className="management-form route-form" onSubmit={createRoute}>
              <label>Route name<input required minLength="2" maxLength="120" value={routeForm.name} onChange={(event) => setRouteForm({ ...routeForm, name: event.target.value })} /></label>
              <label className="wide-field">Ordered stops<textarea required rows="6" placeholder={'PICKUP | Warehouse | 10 Main Street | 40.7128 | -74.0060\nDELIVERY | Customer | 20 Park Ave | 40.7306 | -73.9866'} value={routeForm.stops} onChange={(event) => setRouteForm({ ...routeForm, stops: event.target.value })} /><small>One stop per line: PICKUP, STOP, or DELIVERY | name | address | latitude | longitude. Saving creates a new version.</small></label>
              <button className="small-primary" disabled={saving}>{saving ? 'Saving…' : 'Save route version'}</button>
            </form>
            {routeData?.current && <article className="detail-card"><div className="section-heading"><div><h3>Current route · version {routeData.current.version}</h3><p>Planned {(routeData.current.plannedDistanceMeters / 1000).toFixed(1)} km · Actual {(routeData.current.actualDistanceMeters / 1000).toFixed(1)} km</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Stop</th><th>Address</th><th>Progress</th></tr></thead><tbody>{routeData.current.waypoints?.map((stop) => <tr key={stop.id}><td><strong>{stop.sequence}. {stop.name}</strong><small>{stop.kind}</small></td><td>{stop.address}</td><td><span className={`status-pill ${stop.status.toLowerCase()}`}>{stop.status}</span></td></tr>)}</tbody></table></div>{routeData.routes?.length > 1 && <p className="muted-copy">Route history: {routeData.routes.map((route) => `v${route.version}`).join(' · ')}</p>}</article>}
          </>}
        </>}

        {tab === 'exceptions' && canManageFleet && <>
          <div className="section-heading"><div><h2>Delivery exceptions</h2><p>Review overdue deliveries, missing device GPS, route deviations, delayed pickups, missed stops, and inactive vehicles.</p></div><button className="small-primary" disabled={saving} onClick={runExceptionScan}>{saving ? 'Scanning…' : 'Run scan now'}</button></div>
          <div className="shipment-filters exception-filters"><label>Show status<select value={exceptionStatusFilter} onChange={(event) => setExceptionStatusFilter(event.target.value)}><option value="">Open and acknowledged</option><option value="OPEN">Open</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select></label><span className="muted-copy">Automatic scan runs every minute. Thresholds are configurable in the local environment file.</span></div>
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Severity</th><th>Exception</th><th>Shipment</th><th>Detected / last seen</th><th>Owner</th><th>Actions</th></tr></thead><tbody>{exceptions.length ? exceptions.map((exception) => <tr key={exception.id}><td><span className={`status-pill exception-${exception.severity.toLowerCase()}`}>{exception.severity}</span></td><td><strong>{exception.type.replaceAll('_', ' ')}</strong><small>{exception.description}</small>{exception.escalatedAt && <span className="status-pill exception-critical">ESCALATED</span>}<span className={`status-pill ${exception.status.toLowerCase()}`}>{exception.status}</span></td><td><strong>{exception.trackingNumber}</strong><small>{exception.metadata?.stopName || ''}</small></td><td>{new Date(exception.detectedAt).toLocaleString()}<small>Last seen {new Date(exception.lastSeenAt).toLocaleString()}</small></td><td>{exception.assignedName || 'Unassigned'}{!['RESOLVED', 'DISMISSED'].includes(exception.status) && <button className="text-action" onClick={() => updateException(exception, { assignedTo: user.id }, 'Exception assigned to you.')}>Assign to me</button>}</td><td>{!['RESOLVED', 'DISMISSED'].includes(exception.status) ? <div className="exception-actions">{exception.status === 'OPEN' && <button className="text-action" onClick={() => updateException(exception, { status: 'ACKNOWLEDGED' }, 'Exception acknowledged.')}>Acknowledge</button>}<input aria-label={`Resolution notes for ${exception.trackingNumber}`} minLength="3" maxLength="1000" placeholder="Resolution note" value={exceptionNotes[exception.id] || ''} onChange={(event) => setExceptionNotes({ ...exceptionNotes, [exception.id]: event.target.value })} /><button className="text-action" disabled={(exceptionNotes[exception.id] || '').trim().length < 3} onClick={() => updateException(exception, { status: 'RESOLVED', resolutionNotes: exceptionNotes[exception.id] }, 'Exception resolved.')}>Resolve</button><button className="text-action" disabled={(exceptionNotes[exception.id] || '').trim().length < 3} onClick={() => updateException(exception, { status: 'DISMISSED', resolutionNotes: exceptionNotes[exception.id] }, 'Exception dismissed.')}>Dismiss</button></div> : <small>{exception.resolutionNotes || 'Closed automatically after the condition cleared.'}</small>}</td></tr>) : <tr><td colSpan="6" className="empty-row">No exceptions in this view. Use “Run scan now” to check current operations.</td></tr>}</tbody></table></div>
        </>}

        {tab === 'notifications' && <>
          <div className="section-heading"><div><h2>Notifications</h2><p>Shipment assignments, geofence and stop updates, and new delivery exceptions.</p></div>{notificationUnreadCount > 0 && <button className="small-primary" onClick={markAllNotificationsRead}>Mark all read</button>}</div>
          <div className="notification-list">{notifications.length ? notifications.map((notification) => <article key={notification.id} className={`notification-card ${notification.readAt ? 'read' : 'unread'}`}><div className="notification-dot" /><div className="notification-copy"><div className="notification-card-heading"><strong>{notification.title}</strong><time>{new Date(notification.createdAt).toLocaleString()}</time></div><p>{notification.message}</p>{notification.metadata?.trackingNumber && <small>Shipment {notification.metadata.trackingNumber}</small>}</div>{!notification.readAt && <button className="text-action" onClick={() => markNotificationRead(notification)}>Mark read</button>}</article>) : <div className="workspace-panel"><div><h2>You’re all caught up</h2><p>New operational notifications will appear here.</p></div></div>}</div>
        </>}

        {tab === 'analytics' && canManageFleet && <>
          <div className="section-heading"><div><h2>Operations analytics</h2><p>Shipment, delivery, fleet, and driver metrics calculated from your organization’s records.</p></div></div>
          <form className="analytics-filters" onSubmit={(event) => event.preventDefault()}>
            <label>From<input type="date" value={analyticsFilters.from} onChange={(event) => setAnalyticsFilters({ ...analyticsFilters, from: event.target.value })} /></label>
            <label>To<input type="date" value={analyticsFilters.to} onChange={(event) => setAnalyticsFilters({ ...analyticsFilters, to: event.target.value })} /></label>
            <label>Driver<select value={analyticsFilters.driverId} onChange={(event) => setAnalyticsFilters({ ...analyticsFilters, driverId: event.target.value })}><option value="">All drivers</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label>
            <label>Vehicle<select value={analyticsFilters.vehicleId} onChange={(event) => setAnalyticsFilters({ ...analyticsFilters, vehicleId: event.target.value })}><option value="">All vehicles</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registrationNumber}</option>)}</select></label>
            <label>Status<select value={analyticsFilters.status} onChange={(event) => setAnalyticsFilters({ ...analyticsFilters, status: event.target.value })}><option value="">All statuses</option>{['CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'].map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
          </form>
          {!analytics && <p className="muted-copy">Loading organization metrics…</p>}
          {analytics && <>
            <div className="analytics-kpis"><article><span>Shipments</span><strong>{Number(analytics.metrics.totalShipments).toLocaleString()}</strong></article><article><span>Active</span><strong>{Number(analytics.metrics.activeShipments).toLocaleString()}</strong></article><article><span>Delivered</span><strong>{Number(analytics.metrics.deliveredShipments).toLocaleString()}</strong></article><article><span>Delayed</span><strong>{Number(analytics.metrics.delayedShipments).toLocaleString()}</strong></article><article><span>Failed</span><strong>{Number(analytics.metrics.failedShipments).toLocaleString()}</strong></article><article><span>On time</span><strong>{analytics.metrics.onTimePercentage === null ? '—' : `${analytics.metrics.onTimePercentage}%`}</strong></article><article><span>Avg. delivery time</span><strong>{analytics.metrics.averageDeliveryHours === null ? '—' : `${analytics.metrics.averageDeliveryHours} h`}</strong></article><article><span>Vehicle utilization</span><strong>{analytics.metrics.vehicleUtilizationPercentage}%</strong></article></div>
            <article className="detail-card analytics-chart-card"><div className="section-heading"><div><h3>Shipment volume</h3><p>Daily created shipments and completed deliveries.</p></div></div>{analytics.trend.length ? <React.Suspense fallback={<div className="analytics-chart-loading">Loading chart…</div>}><AnalyticsVolumeChart data={analytics.trend} /></React.Suspense> : <p className="empty-row">No shipments in the selected period.</p>}</article>
            <div className="analytics-breakdowns"><article className="detail-card"><div className="section-heading"><div><h3>Driver performance</h3><p>Delivery outcomes for the selected period.</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Driver</th><th>Shipments</th><th>Delivered</th><th>On time</th><th>Avg. hours</th></tr></thead><tbody>{performance?.drivers?.length ? performance.drivers.map((driver) => <tr key={driver.driverId}><td>{driver.driverName}</td><td>{driver.totalShipments}</td><td>{driver.deliveredShipments}</td><td>{driver.onTimePercentage === null ? '—' : `${driver.onTimePercentage}%`}</td><td>{driver.averageDeliveryHours ?? '—'}</td></tr>) : <tr><td colSpan="5" className="empty-row">No driver results for this period.</td></tr>}</tbody></table></div></article><article className="detail-card"><div className="section-heading"><div><h3>Vehicle usage</h3><p>Shipment and active assignment counts.</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Vehicle</th><th>Type</th><th>Shipments</th><th>Active</th><th>Delivered</th></tr></thead><tbody>{performance?.vehicles?.length ? performance.vehicles.map((vehicle) => <tr key={vehicle.vehicleId}><td>{vehicle.registrationNumber}</td><td>{vehicle.vehicleType}</td><td>{vehicle.totalShipments}</td><td>{vehicle.activeShipments}</td><td>{vehicle.deliveredShipments}</td></tr>) : <tr><td colSpan="5" className="empty-row">No vehicle results for this period.</td></tr>}</tbody></table></div></article></div>
          </>}
        </>}

        {tab === 'fleet' && canManageFleet && <>
          <div className="section-heading"><div><h2>Drivers</h2><p>Driver accounts and license records for your organization.</p></div>{isAdmin && <button className="small-primary" onClick={() => setShowDriverForm((value) => !value)}>{showDriverForm ? 'Close' : 'Add driver'}</button>}</div>
          {showDriverForm && <form className="management-form" onSubmit={createDriver}>
            <label>Name<input required minLength="2" maxLength="120" value={driverForm.name} onChange={(event) => setDriverForm({ ...driverForm, name: event.target.value })} /></label>
            <label>Email<input required type="email" value={driverForm.email} onChange={(event) => setDriverForm({ ...driverForm, email: event.target.value })} /></label>
            <label>Temporary password<input required type="password" minLength="12" maxLength="72" value={driverForm.password} onChange={(event) => setDriverForm({ ...driverForm, password: event.target.value })} /></label>
            <label>Phone<input maxLength="32" value={driverForm.phone} onChange={(event) => setDriverForm({ ...driverForm, phone: event.target.value })} /></label>
            <label>License number<input required value={driverForm.licenseNumber} onChange={(event) => setDriverForm({ ...driverForm, licenseNumber: event.target.value })} /></label>
            <label>License expires<input type="date" value={driverForm.licenseExpiresOn} onChange={(event) => setDriverForm({ ...driverForm, licenseExpiresOn: event.target.value })} /></label>
            <button className="small-primary" disabled={saving}>{saving ? 'Saving…' : 'Create driver'}</button>
          </form>}
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Driver</th><th>License</th><th>Phone</th><th>Account</th></tr></thead><tbody>{drivers.length ? drivers.map((driver) => <tr key={driver.id}><td><strong>{driver.name}</strong><small>{driver.email}</small></td><td>{driver.licenseNumber}{driver.licenseExpiresOn && <small>Expires {driver.licenseExpiresOn}</small>}</td><td>{driver.phone || '—'}</td><td><span className={`status-pill ${driver.status.toLowerCase()}`}>{driver.status}</span></td></tr>) : <tr><td colSpan="4" className="empty-row">No drivers yet. Add your first driver to get started.</td></tr>}</tbody></table></div>

          <div className="section-heading fleet-heading"><div><h2>Vehicles</h2><p>Register fleet vehicles and assign one active driver to each vehicle.</p></div>{isAdmin && <button className="small-primary" onClick={() => setShowVehicleForm((value) => !value)}>{showVehicleForm ? 'Close' : 'Add vehicle'}</button>}</div>
          {showVehicleForm && <form className="management-form" onSubmit={createVehicle}>
            <label>Registration number<input required value={vehicleForm.registrationNumber} onChange={(event) => setVehicleForm({ ...vehicleForm, registrationNumber: event.target.value })} /></label>
            <label>Make<input required value={vehicleForm.make} onChange={(event) => setVehicleForm({ ...vehicleForm, make: event.target.value })} /></label>
            <label>Model<input required value={vehicleForm.model} onChange={(event) => setVehicleForm({ ...vehicleForm, model: event.target.value })} /></label>
            <label>Type<select value={vehicleForm.vehicleType} onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })}><option value="VAN">Van</option><option value="TRUCK">Truck</option><option value="TRAILER">Trailer</option><option value="MOTORCYCLE">Motorcycle</option><option value="OTHER">Other</option></select></label>
            <label>Capacity (kg)<input type="number" min="1" value={vehicleForm.capacityKg} onChange={(event) => setVehicleForm({ ...vehicleForm, capacityKg: event.target.value })} /></label>
            <button className="small-primary" disabled={saving}>{saving ? 'Saving…' : 'Create vehicle'}</button>
          </form>}
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Vehicle</th><th>Type</th><th>Capacity</th><th>Assigned driver</th><th>Status</th></tr></thead><tbody>{vehicles.length ? vehicles.map((vehicle) => <tr key={vehicle.id}><td><strong>{vehicle.registrationNumber}</strong><small>{vehicle.make} {vehicle.model}</small></td><td>{vehicle.vehicleType}</td><td>{vehicle.capacityKg ? `${vehicle.capacityKg.toLocaleString()} kg` : '—'}</td><td><select className="table-select" aria-label={`Assign driver for ${vehicle.registrationNumber}`} value={vehicle.assignedDriver?.id || ''} onChange={(event) => updateVehicle(vehicle.id, { driverId: event.target.value || null })}><option value="">Unassigned</option>{drivers.filter((driver) => driver.status === 'ACTIVE' && (!vehicles.some((other) => other.assignedDriver?.id === driver.id && other.id !== vehicle.id))).map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></td><td><select className="table-select" aria-label={`Set status for ${vehicle.registrationNumber}`} value={vehicle.status} onChange={(event) => updateVehicle(vehicle.id, { status: event.target.value })}><option value="ACTIVE">Active</option><option value="MAINTENANCE">Maintenance</option><option value="INACTIVE">Inactive</option></select></td></tr>) : <tr><td colSpan="5" className="empty-row">No vehicles registered yet.</td></tr>}</tbody></table></div>
        </>}

        {tab === 'team' && isAdmin && <>
          <div className="section-heading"><div><h2>Team members</h2><p>Manage access for your organization. Each person belongs to this workspace only.</p></div><button className="small-primary" onClick={() => setShowUserForm((value) => !value)}>{showUserForm ? 'Close' : 'Add member'}</button></div>
          {showUserForm && <form className="management-form" onSubmit={createUser}>
            <label>Name<input required minLength="2" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></label>
            <label>Email<input required type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></label>
            <label>Temporary password<input required type="password" minLength="12" maxLength="72" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></label>
            <label>Role<select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}><option value="DISPATCHER">Dispatcher</option><option value="VIEWER">Viewer</option><option value="ORG_ADMIN">Organization admin</option></select></label>
            <button className="small-primary" disabled={saving}>{saving ? 'Saving…' : 'Create member'}</button>
          </form>}
          <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>{users.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td>{member.role.replaceAll('_', ' ')}</td><td><span className={`status-pill ${member.status.toLowerCase()}`}>{member.status}</span></td><td>{member.id === user.id ? <small>Current account</small> : <div className="member-actions"><select className="table-select" value={member.role} onChange={(event) => updateUser(member, { role: event.target.value })}><option value="ORG_ADMIN">Org admin</option><option value="DISPATCHER">Dispatcher</option><option value="VIEWER">Viewer</option></select><button className="text-action" onClick={() => updateUser(member, { status: member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}>{member.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></div>}</td></tr>)}</tbody></table></div>
        </>}

        {tab === 'account' && <>
        <div className="workspace-panel">
          <div className="panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.8 9-4.8M12 12.3V21" /></svg></div>
          <div><h2>Your workspace is connected</h2><p>Organization access and account security are active for this session.</p></div>
          <span className="connected-pill"><span /> Connected</span>
        </div>
        <div className="account-grid">
          <article className="account-card"><p>ORGANIZATION</p><h3>{user.organization.name}</h3><span>{user.organization.slug}</span></article>
          <article className="account-card"><p>ACCOUNT</p><h3>{user.email}</h3><span>Active session</span></article>
          <article className="account-card"><p>ACCESS ROLE</p><h3>{user.role.replaceAll('_', ' ')}</h3><span>Assigned by organization</span></article>
        </div>
        </>}
      </section>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProductLandingPage />} />
        <Route path="/product" element={<ProductLandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>,
);
