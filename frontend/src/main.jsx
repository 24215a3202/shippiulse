import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import './style.css';

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

function Brand({ light = false }) {
  return (
    <Link className={`brand ${light ? 'brand-light' : ''}`} to="/login" aria-label="ShipPulse login">
      <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h4l2.2-5 3.6 10 2.1-5H20" /></svg></span>
      <span>Ship<span>Pulse</span></span>
    </Link>
  );
}

function AuthFrame({ eyebrow, title, description, children, footer }) {
  return (
    <main className="auth-page">
      <section className="auth-aside">
        <Brand light />
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

  React.useEffect(() => {
    let active = true;
    apiRequest('/api/auth/me')
      .then((result) => { if (active) setUser(result.user); })
      .catch((caught) => { if (active) setError(caught); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

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
        <h1>Welcome, {user.name.split(' ')[0]}</h1>
        <p className="workspace-intro">Your ShipPulse account is ready. Shipment operations will appear here as those tools are added.</p>
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
      </section>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
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
