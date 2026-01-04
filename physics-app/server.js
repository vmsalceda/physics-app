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
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'user_sessions'
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Serve static files for modern UI
app.use(express.static('public'));

// Initialize database
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS problems (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        variables JSONB NOT NULL,
        formula TEXT NOT NULL,
        unit VARCHAR(50) NOT NULL,
        tolerance_percent DECIMAL NOT NULL,
        max_attempts INTEGER DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        problem_ids INTEGER[] NOT NULL,
        due_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        student_username VARCHAR(50) NOT NULL,
        assignment_id INTEGER NOT NULL,
        problem_id INTEGER NOT NULL,
        problem_instances JSONB NOT NULL,
        user_answer DECIMAL,
        correct_answer DECIMAL,
        is_correct BOOLEAN,
        percent_diff DECIMAL,
        attempts INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_username, assignment_id, problem_id)
      );
    `);

    // Create default users
    const hashedTeacher = await bcrypt.hash('teacher123', 10);
    const hashedStudent = await bcrypt.hash('student123', 10);
    
    await pool.query(`
      INSERT INTO users (username, password, role) 
      VALUES ('teacher', $1, 'teacher'), ('student1', $2, 'student')
      ON CONFLICT (username) DO NOTHING;
    `, [hashedTeacher, hashedStudent]);

    // Create sample problems
    const problemCount = await pool.query('SELECT COUNT(*) FROM problems');
    if (parseInt(problemCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO problems (title, description, variables, formula, unit, tolerance_percent, max_attempts)
        VALUES 
        ('Velocity Calculation', 
         'A car travels {distance} meters in {time} seconds. Calculate the velocity in m/s.',
         '{"distance": {"min": 50, "max": 200}, "time": {"min": 5, "max": 20}}',
         'distance / time',
         'm/s',
         2,
         3),
        ('Force Calculation',
         'An object with mass {mass} kg accelerates at {acceleration} m/s². Calculate the force in Newtons.',
         '{"mass": {"min": 10, "max": 100}, "acceleration": {"min": 2, "max": 15}}',
         'mass * acceleration',
         'N',
         2,
         3);
      `);

      await pool.query(`
        INSERT INTO assignments (title, description, problem_ids, due_date)
        VALUES ('Week 1 - Kinematics', 'Basic velocity and acceleration problems​​​​​​​​​​​​​​​​
