# What the landing page claims, and where it comes from

Every figure and module named on the landing page is checked against this
repository. This file is the source list, so the copy can be re-verified
when the product changes.

VERIFIED FROM THE CODEBASE (file: fact)

App surface
  frontend/src/App.jsx        32 routed screens
  backend/routes/             26 route modules

Roles & access
  permissions.py              5 system roles: Admin, HR Head, HR, Manager, Employee
  permissions.py              45 distinct permissions
  tenant_scope.py             every query scoped to a tenant

Plans (feature_gating.py)
  Starter     25 seats,  free
  Pro        200 seats,  Rs 4,999/mo  -> payroll runs, custom workflows, custom roles
  Enterprise unlimited              -> + audit log, API access
  TRIAL_DAYS = 14

Payroll (payroll_engine.py)
  PF   12% employer + 12% employee, wage ceiling Rs 15,000
  ESI  3.25% employer + 0.75% employee, eligible at gross <= Rs 21,000
  PT   slabs for karnataka, maharashtra, telangana, gujarat
  TDS  simplified monthly estimate from annualised slabs
  LOP  loss-of-pay handling

Leave (routes/leaves.py)
  8 built-in types: CL SL LP ML MATERNITY OD CO PERMISSION
  monthly caps by category: regular 2, probationary 1, female 2 (+1 ML)
  overflow past the cap becomes loss of pay inside the same request

Attendance
  services/essl_sync.py       eSSL / ZKTeco device polling (python zk)
  routes/attendance.py        web self-punch; both land in attendance_punches
                              tagged by source, rolled into attendance_daily

Lifecycle
  routes/letters.py           offer letters, versioned, new + revised subtypes
  routes/appointment_orders.py appointment orders
  routes/exit.py              5-stage pipeline: resignation_pending,
                              notice_period, clearance_pending,
                              clearance_complete, exited
                              5 clearances: it_assets, finance, admin,
                              hr_docs, access_cards

Workflows
  workflow_engine.py          configurable multi-stage approval chains,
                              default stages e.g. HR Head Review, Manager Approval

Integrations
  routes/public_api.py        GET /employees, /attendance, /calendar.ics
  routes/api_keys.py          per-tenant API keys
  routes/webhooks.py          events: employee.exited, expense.approved

Compliance & security
  encryption.py               Fernet encryption at rest for KYC uploads
                              (Aadhaar, PAN, bank passbook)
  routes/audit.py             audit log
  routes/analytics.py         /headcount, /compliance-register

Other modules
  assets, expenses, announcements, policies (+acknowledgements),
  org chart, support tickets, notifications
  scheduler.py                daily 09:00 birthday + work-anniversary mail
