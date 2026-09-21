import express from "express";
import session from "express-session";
import pg from "pg";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production" && ADMIN_PASSWORD === "change-this-password") {
  throw new Error("Set a strong ADMIN_PASSWORD in production");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','staff')),
      staff_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dob TEXT,
      parent TEXT,
      mobile TEXT,
      batch TEXT,
      joining_date TEXT,
      monthly_fee NUMERIC(12,2) DEFAULT 0,
      status TEXT DEFAULT 'Active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fees (
      id SERIAL PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      due_amount NUMERIC(12,2) DEFAULT 0,
      paid_amount NUMERIC(12,2) DEFAULT 0,
      due_date TEXT,
      payment_date TEXT,
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      mobile TEXT,
      role TEXT,
      joining_date TEXT,
      status TEXT DEFAULT 'Active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS staff_attendance (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      remarks TEXT,
      UNIQUE(staff_id,date)
    );
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_staff_fk FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE INDEX IF NOT EXISTS fees_month_idx ON fees(month);
    CREATE INDEX IF NOT EXISTS fees_student_month_idx ON fees(student_id,month);
    CREATE INDEX IF NOT EXISTS attendance_staff_date_idx ON staff_attendance(staff_id,date);
  `);
  const existing = await pool.query("SELECT id FROM users WHERE username=$1", [ADMIN_USERNAME]);
  if (!existing.rowCount) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query("INSERT INTO users(username,password_hash,role) VALUES($1,$2,'admin')", [ADMIN_USERNAME, hash]);
  }
}

const app = express();
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "100kb" }));

const SessionStore = pgSession(session);
app.use(session({
  store: new SessionStore({ pool, createTableIfMissing: true }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const monthOrCurrent = (value) => /^\d{4}-\d{2}$/.test(String(value || "")) ? String(value) : new Date().toISOString().slice(0, 7);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
function auth(req, res, next) { if (!req.session.userId) return res.status(401).json({ error: "Authentication required" }); next(); }
function admin(req, res, next) { if (req.session.role !== "admin") return res.status(403).json({ error: "Admin access required" }); next(); }
function staffOrAdmin(req, res, next) { if (!['admin','staff'].includes(req.session.role)) return res.status(403).json({ error: "Access denied" }); next(); }

app.get("/health", (req,res)=>res.json({ok:true}));

app.post("/api/login", limiter, async (req,res,next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: "Invalid username or password" });
    req.session.userId = u.id;
    req.session.username = u.username;
    req.session.role = u.role;
    req.session.staffId = u.staff_id || null;
    res.json({ ok:true, username:u.username, role:u.role });
  } catch(e) { next(e); }
});
app.post("/api/logout", auth, (req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me", auth, (req,res)=>res.json({username:req.session.username,role:req.session.role,staffId:req.session.staffId||null}));

app.get("/api/dashboard", auth, async (req,res,next) => {
  try {
    const total = Number((await pool.query("SELECT COUNT(*)::int AS n FROM students")).rows[0].n);
    const active = Number((await pool.query("SELECT COUNT(*)::int AS n FROM students WHERE status='Active'")).rows[0].n);
    if (req.session.role !== "admin") return res.json({ total, active, staff:0, staffView:true });
    const staffCount = Number((await pool.query("SELECT COUNT(*)::int AS n FROM staff WHERE status='Active'")).rows[0].n);
    const month = monthOrCurrent(req.query.month);
    const m = (await pool.query(`SELECT COALESCE(SUM(due_amount),0) AS due, COALESCE(SUM(paid_amount),0) AS collected, COALESCE(SUM(GREATEST(due_amount-paid_amount,0)),0) AS pending FROM fees WHERE month=$1`, [month])).rows[0];
    const all = (await pool.query("SELECT COALESCE(SUM(paid_amount),0) AS n FROM fees")).rows[0];
    res.json({total,active,staff:staffCount,month,collected:Number(m.collected),pending:Number(m.pending),due:Number(m.due),allCollected:Number(all.n),staffView:false});
  } catch(e){next(e)}
});

app.get("/api/students", auth, async (req,res,next) => {
  try {
    if (req.session.role === "admin") {
      return res.json((await pool.query("SELECT * FROM students ORDER BY name")).rows);
    }
    const month = monthOrCurrent(req.query.month);
    const rows = (await pool.query(`SELECT s.id,s.name,s.parent,s.mobile,s.batch,s.status,
      COALESCE((SELECT SUM(f.due_amount) FROM fees f WHERE f.student_id=s.id AND f.month=$1),0) AS due,
      COALESCE((SELECT SUM(f.paid_amount) FROM fees f WHERE f.student_id=s.id AND f.month=$1),0) AS paid
      FROM students s ORDER BY s.name`, [month])).rows;
    res.json(rows.map(x=>({id:x.id,name:x.name,parent:x.parent,mobile:x.mobile,batch:x.batch,status:x.status,month,pending:Math.max(0,Number(x.due)-Number(x.paid)),paymentStatus:Number(x.due)<=Number(x.paid)?"Paid":(Number(x.due)>0?"Pending":"Not Recorded")})));
  } catch(e){next(e)}
});

app.post("/api/students", auth, admin, async (req,res,next)=>{
  try {
    const s=req.body||{};
    if(!s.id||!s.name)return res.status(400).json({error:"Student ID and name required"});
    await pool.query(`INSERT INTO students(id,name,dob,parent,mobile,batch,joining_date,monthly_fee,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[String(s.id).trim(),String(s.name).trim(),s.dob||null,s.parent||null,s.mobile||null,s.batch||null,s.joining_date||null,Number(s.monthly_fee||0),s.status||"Active"]);
    res.status(201).json({ok:true});
  }catch(e){if(e.code==='23505')return res.status(409).json({error:"Student ID already exists"});next(e)}
});
app.delete("/api/students/:id",auth,admin,async(req,res,next)=>{try{await pool.query("DELETE FROM students WHERE id=$1",[req.params.id]);res.json({ok:true})}catch(e){next(e)}});

app.get("/api/fees",auth,admin,async(req,res,next)=>{try{res.json((await pool.query("SELECT f.*,s.name,s.parent,s.mobile FROM fees f JOIN students s ON s.id=f.student_id ORDER BY f.month DESC,f.due_date DESC,f.id DESC")).rows)}catch(e){next(e)}});
app.post("/api/fees",auth,admin,async(req,res,next)=>{try{let f=req.body||{};if(!f.student_id||!/^\d{4}-\d{2}$/.test(String(f.month||"")))return res.status(400).json({error:"Student and valid month required"});await pool.query(`INSERT INTO fees(student_id,month,due_amount,paid_amount,due_date,payment_date,remarks) VALUES($1,$2,$3,$4,$5,$6,$7)`,[f.student_id,f.month,Number(f.due_amount||0),Number(f.paid_amount||0),f.due_date||null,f.payment_date||null,f.remarks||null]);res.status(201).json({ok:true})}catch(e){next(e)}});
app.get("/api/reminders",auth,admin,async(req,res,next)=>{try{const d=String(req.query.date||"");if(!validDate(d))return res.status(400).json({error:"Valid date required"});const rows=(await pool.query(`SELECT s.id,s.name,s.parent,s.mobile,f.month,f.due_amount,f.paid_amount,f.due_date FROM fees f JOIN students s ON s.id=f.student_id WHERE f.due_date<=$1 AND f.due_amount>f.paid_amount ORDER BY f.due_date,s.name`,[d])).rows;res.json(rows.map(x=>({...x,pending_amount:Number(x.due_amount)-Number(x.paid_amount)})))}catch(e){next(e)}});

app.get("/api/staff",auth,async(req,res,next)=>{try{const rows=(await pool.query(`SELECT s.id,s.name,s.mobile,s.role,s.joining_date,s.status,u.username FROM staff s LEFT JOIN users u ON u.staff_id=s.id ORDER BY s.name`)).rows;res.json(rows)}catch(e){next(e)}});
app.post("/api/staff",auth,admin,async(req,res,next)=>{
  const s=req.body||{};
  if(!s.name||!s.username||!s.password)return res.status(400).json({error:"Staff name, username and password are required"});
  if(String(s.password).length<8)return res.status(400).json({error:"Staff password must be at least 8 characters"});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query("INSERT INTO staff(name,mobile,role,joining_date,status) VALUES($1,$2,$3,$4,$5) RETURNING id",[String(s.name).trim(),s.mobile||null,s.role||null,s.joining_date||null,s.status||"Active"]);
    const hash=await bcrypt.hash(String(s.password),12);
    await client.query("INSERT INTO users(username,password_hash,role,staff_id) VALUES($1,$2,'staff',$3)",[String(s.username).trim(),hash,r.rows[0].id]);
    await client.query('COMMIT');res.status(201).json({ok:true});
  }catch(e){await client.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:"Username already exists or staff could not be created"});next(e)}finally{client.release()}
});
app.delete("/api/staff/:id",auth,admin,async(req,res,next)=>{try{await pool.query("DELETE FROM staff WHERE id=$1",[req.params.id]);res.json({ok:true})}catch(e){next(e)}});

app.get("/api/staff-attendance",auth,staffOrAdmin,async(req,res,next)=>{try{const d=String(req.query.date||"");let sql=`SELECT a.*,s.name,s.role FROM staff_attendance a JOIN staff s ON s.id=a.staff_id`;const params=[];const where=[];if(req.session.role!=='admin'){params.push(req.session.staffId);where.push(`a.staff_id=$${params.length}`)}if(d&&validDate(d)){params.push(d);where.push(`a.date=$${params.length}`)}if(where.length)sql+=' WHERE '+where.join(' AND ');sql+=' ORDER BY a.date DESC,s.name';res.json((await pool.query(sql,params)).rows)}catch(e){next(e)}});
app.post("/api/staff-attendance",auth,staffOrAdmin,async(req,res,next)=>{try{let a=req.body||{};if(!a.staff_id||!a.date||!a.status)return res.status(400).json({error:"Staff, date and status required"});if(req.session.role!=='admin'&&Number(a.staff_id)!==Number(req.session.staffId))return res.status(403).json({error:"You can only update your own attendance"});await pool.query(`INSERT INTO staff_attendance(staff_id,date,status,check_in,check_out,remarks) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(staff_id,date) DO UPDATE SET status=EXCLUDED.status,check_in=EXCLUDED.check_in,check_out=EXCLUDED.check_out,remarks=EXCLUDED.remarks`,[Number(a.staff_id),a.date,a.status,a.check_in||null,a.check_out||null,a.remarks||null]);res.json({ok:true})}catch(e){next(e)}});

app.use(express.static(path.join(__dirname,"public")));
app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Server error"})});

await initDb();
app.listen(PORT,"0.0.0.0",()=>console.log(`Running on port ${PORT}`));
