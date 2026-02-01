-- Example Sprint Tasks
-- Load with: sqlite3 .pm/tasks.db < .pm/todo/example-sprint/tasks.sql
--
-- This file demonstrates the task format. Delete this folder when you
-- create your first real sprint.

-- =============================================================================
-- TASKS
-- =============================================================================

INSERT INTO tasks (sprint, spec, task_num, title, type, owner, skills, done_when, description) VALUES
('example-sprint', '01-user-auth.md', 1, 'Create users table with RLS', 'database', NULL, 'database',
  'Migration runs, RLS policies pass tests (positive + negative cases)',
  'Build users table with email, password_hash, company_id. Add RLS policy: users can only see users in their company.');

INSERT INTO tasks (sprint, spec, task_num, title, type, owner, skills, done_when, description) VALUES
('example-sprint', '01-user-auth.md', 2, 'Create login server action', 'actions', NULL, 'server-actions',
  'Unit tests pass, returns session token on valid credentials',
  'Implement loginUser server action. Validate credentials against users table, return JWT.');

INSERT INTO tasks (sprint, spec, task_num, title, type, owner, skills, done_when, description) VALUES
('example-sprint', '01-user-auth.md', 3, 'Build LoginForm component', 'frontend', NULL, 'react-components',
  'Component renders, form validation works, Storybook story added',
  'Create LoginForm with email/password fields. Use react-hook-form for validation. Show loading state during submit.');

INSERT INTO tasks (sprint, spec, task_num, title, type, owner, skills, done_when, description) VALUES
('example-sprint', '01-user-auth.md', 4, 'Wire login page', 'frontend', NULL, 'react-components',
  'Manual test: can log in and see dashboard',
  'Connect LoginForm to loginUser action. Redirect to /dashboard on success. Show error toast on failure.');

INSERT INTO tasks (sprint, spec, task_num, title, type, owner, skills, done_when, description) VALUES
('example-sprint', '99-e2e-verification.md', 5, 'E2E: User authentication flow', 'e2e', NULL, 'testing-e2e',
  'Playwright tests pass for login happy path',
  'Write E2E test: navigate to /login, enter credentials, verify redirect to /dashboard.');

-- =============================================================================
-- DEPENDENCIES
-- =============================================================================

-- Task 2 (login action) depends on Task 1 (users table)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('example-sprint', 2, 'example-sprint', 1);

-- Task 3 (LoginForm) has no dependencies (can be built with mock data)

-- Task 4 (wire login page) depends on Task 2 (login action) and Task 3 (LoginForm)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('example-sprint', 4, 'example-sprint', 2);
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('example-sprint', 4, 'example-sprint', 3);

-- Task 5 (E2E) depends on Task 4 (wired page)
INSERT INTO task_dependencies (sprint, task_num, depends_on_sprint, depends_on_task) VALUES
('example-sprint', 5, 'example-sprint', 4);

-- =============================================================================
-- VERIFY
-- =============================================================================
-- After loading, check available tasks:
-- sqlite3 .pm/tasks.db "SELECT task_num, title FROM available_tasks WHERE sprint = 'example-sprint';"
--
-- Should show: Task 1 (users table) and Task 3 (LoginForm) - both have no dependencies
