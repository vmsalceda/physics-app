// server.js - COMPLETE VERSION WITH POSTGRESQL SESSION STORE
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Session store
const pgSession = require('connect-pg-simple')(session);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Trust Railway's proxy
app.set('trust proxy', 1);

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  },
  proxy: true
}));

app.use(express.static('public'));

// Initialize database
async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS problems (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT NOT NULL, variables JSONB NOT NULL, formula TEXT NOT NULL, unit VARCHAR(50) NOT NULL, tolerance_percent DECIMAL NOT NULL, max_attempts INTEGER DEFAULT 3, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS assignments (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, description TEXT NOT NULL, problem_ids INTEGER[] NOT NULL, due_date DATE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS submissions (id SERIAL PRIMARY KEY, student_username VARCHAR(50) NOT NULL, assignment_id INTEGER NOT NULL, problem_id INTEGER NOT NULL, problem_instances JSONB NOT NULL, user_answer DECIMAL, correct_answer DECIMAL, is_correct BOOLEAN, percent_diff DECIMAL, attempts INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(student_username, assignment_id, problem_id));`);
    
    const hashedTeacher = await bcrypt.hash('teacher123', 10);
    const hashedStudent = await bcrypt.hash('student123', 10);
    await pool.query(`INSERT INTO users (username, password, role) VALUES ('teacher', $1, 'teacher'), ('student1', $2, 'student') ON CONFLICT (username) DO NOTHING;`, [hashedTeacher, hashedStudent]);
    
    const problemCount = await pool.query('SELECT COUNT(*) FROM problems');
    if (parseInt(problemCount.rows[0].count) === 0) {
      await pool.query(`INSERT INTO problems (title, description, variables, formula, unit, tolerance_percent, max_attempts) VALUES ('Velocity Calculation', 'A car travels {distance} meters in {time} seconds. Calculate the velocity in m/s.', '{"distance": {"min": 50, "max": 200}, "time": {"min": 5, "max": 20}}', 'distance / time', 'm/s', 2, 3), ('Force Calculation', 'An object with mass {mass} kg accelerates at {acceleration} m/s². Calculate the force in Newtons.', '{"mass": {"min": 10, "max": 100}, "acceleration": {"min": 2, "max": 15}}', 'mass * acceleration', 'N', 2, 3);`);
      await pool.query(`INSERT INTO assignments (title, description, problem_ids, due_date) VALUES ('Week 1 - Kinematics', 'Basic velocity and acceleration problems', ARRAY[1, 2], '2026-01-10');`);
    }
    console.log('✓ Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initDB();

function generateValues(variables) {
  const values = {};
  for (const [varName, range] of Object.entries(variables)) {
    values[varName] = Math.random() * (range.max - range.min) + range.min;
  }
  return values;
}

function calculateAnswer(formula, values) {
  try {
    const func = new Function(...Object.keys(values), `return ${formula}`);
    return func(...Object.values(values));
  } catch (e) {
    return null;
  }
}

function renderProblemText(description, values) {
  let text = description;
  for (const [varName, value] of Object.entries(values)) {
    text = text.replace(`{${varName}}`, value.toFixed(2));
  }
  return text;
}

function checkAnswer(userAnswer, correctAnswer, tolerancePercent) {
  if (correctAnswer === 0) return Math.abs(userAnswer) <= 0.01;
  const percentDiff = Math.abs((userAnswer - correctAnswer) / correctAnswer) * 100;
  return percentDiff <= tolerancePercent;
}

function requireLogin(req, res, next) {
  if (!req.session.username) return res.redirect('/login');
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session.role !== role) return res.redirect('/');
    next();
  };
}

app.get('/', (req, res) => {
  if (!req.session.username) return res.redirect('/login');
  return res.redirect(req.session.role === 'teacher' ? '/teacher' : '/student');
});

app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login - Physics Practice</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; } .card { background: white; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); padding: 40px; width: 100%; max-width: 400px; } h1 { color: #667eea; text-align: center; margin-bottom: 30px; } label { display: block; margin-bottom: 5px; font-weight: 500; color: #555; } input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; } .btn { width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; font-weight: 500; } .btn:hover { background: #5568d3; } .error { color: #e74c3c; margin-bottom: 15px; font-size: 14px; } .demo-info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 20px; font-size: 13px; border: 1px solid #e0e0e0; } .demo-info code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; }</style></head><body><div class="card"><h1>Physics Problem Practice</h1><form method="POST" action="/login"><label>Username</label><input type="text" name="username" required autofocus><label>Password</label><input type="password" name="password" required>${req.query.error ? `<div class="error">${req.query.error}</div>` : ''}<button type="submit" class="btn​​​​​​​​​​​​​​​​
