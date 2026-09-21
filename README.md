# Cricket Academy Manager — Production v3

Secure Express + PostgreSQL version for deployment on Render or another Node.js host.

## Roles
- Admin: full student, staff, fee, income, month-wise financial and attendance access.
- Staff: student basic details and month-wise payment status/pending amount only; no academy income, total collection, overall pending, fee records, or other staff financial information.
- Staff can view/update only their own attendance.

## Persistent data
This version uses PostgreSQL instead of local SQLite. That is important for cloud hosting because free Render web services have an ephemeral filesystem; local SQLite data would be lost after restarts/redeploys/spin-downs. Render supports PostgreSQL, while Supabase also provides a free Postgres database with 500 MB included (subject to its free-plan limits).

## Environment variables
Set:
- NODE_ENV=production
- DATABASE_URL=your Postgres connection string
- DATABASE_SSL=true
- SESSION_SECRET=long random secret
- ADMIN_USERNAME=your admin username
- ADMIN_PASSWORD=strong admin password

## Local run
npm install
npm start

## Render
Create a Web Service from a Git repository.
Build command: npm install
Start command: npm start
Set the environment variables above. The service must listen on PORT/0.0.0.0 (this project does).

Recommended database for a no-cost test deployment: Supabase Free Postgres. Render Free Postgres currently expires after 30 days, so it is not suitable for long-term academy data without upgrading.

## Important
Free hosting tiers can sleep/pause. For real academy production use, use a paid persistent database/hosting plan and backups. Never commit .env or passwords to GitHub.
