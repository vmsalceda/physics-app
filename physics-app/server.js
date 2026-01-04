const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const pgSession = require('connect-pg-simple')(session);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
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
    console.log('Database initialized successfully');
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
  res.send(`<!DOCTYPE html><html><head><title>Login - Physics Practice</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; } .card { background: white; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); padding: 40px; width: 100%; max-width: 400px; } h1 { color: #667eea; text-align: center; margin-bottom: 30px; } label { display: block; margin-bottom: 5px; font-weight: 500; color: #555; } input { width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; } .btn { width: 100%; padding: 12px; background: #667eea; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; font-weight: 500; } .btn:hover { background: #5568d3; } .error { color: #e74c3c; margin-bottom: 15px; font-size: 14px; } .demo-info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 20px; font-size: 13px; border: 1px solid #e0e0e0; } .demo-info code { background: #e9ecef; padding: 2px 6px; border-radius: 3px; }</style></head><body><div class="card"><h1>Physics Problem Practice</h1><form method="POST" action="/login"><label>Username</label><input type="text" name="username" required autofocus><label>Password</label><input type="password" name="password" required>${req.query.error ? `<div class="error">${req.query.error}</div>` : ''}<button type="submit" class="btn">Login</button></form><div class="demo-info"><strong>Demo Accounts:</strong><br>Teacher: <code>teacher</code> / <code>teacher123</code><br>Student: <code>student1</code> / <code>student123</code></div></div></body></html>`);
});

app.post('/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body.username);
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [req.body.username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (await bcrypt.compare(req.body.password, user.password)) {
        req.session.username = user.username;
        req.session.role = user.role;
        console.log('Session created:', req.session);
        return res.redirect('/');
      }
    }
    res.redirect('/login?error=Invalid username or password');
  } catch (err) {
    console.error('Login error:', err);
    res.redirect('/login?error=An error occurred');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// STUDENT MANAGEMENT ENDPOINTS - Add after the logout route
app.get('/api/users/students', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, created_at FROM users WHERE role = $1 ORDER BY created_at DESC', ['student']);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/students', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, created_at',
      [username, hashedPassword, 'student']
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/students/:username', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const { username } = req.params;
    
    await pool.query('DELETE FROM submissions WHERE student_username = $1', [username]);
    const result = await pool.query('DELETE FROM users WHERE username = $1 AND role = $2 RETURNING username', [username, 'student']);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json({ success: true, username: result.rows[0].username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/students/:username/password', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const { username } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2 AND role = $3 RETURNING username',
      [hashedPassword, username, 'student']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json({ success: true, username: result.rows[0].username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/problems', requireLogin, async (req, res) => {
  const problems = await pool.query('SELECT * FROM problems ORDER BY id');
  res.json(problems.rows);
});

app.post('/api/problems', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const { title, description, variables, formula, unit, tolerancePercent, maxAttempts } = req.body;
    const result = await pool.query('INSERT INTO problems (title, description, variables, formula, unit, tolerance_percent, max_attempts) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [title, description, JSON.stringify(variables), formula, unit, tolerancePercent, maxAttempts]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/problems/:id', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const { title, description, variables, formula, unit, tolerancePercent, maxAttempts } = req.body;
    const result = await pool.query('UPDATE problems SET title=$1, description=$2, variables=$3, formula=$4, unit=$5, tolerance_percent=$6, max_attempts=$7 WHERE id=$8 RETURNING *', [title, description, JSON.stringify(variables), formula, unit, tolerancePercent, maxAttempts, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/problems/:id', requireLogin, requireRole('teacher'), async (req, res) => {
  await pool.query('DELETE FROM problems WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/assignments', requireLogin, async (req, res) => {
  const assignments = await pool.query('SELECT * FROM assignments ORDER BY id');
  res.json(assignments.rows);
});

app.post('/api/assignments', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const { title, description, problemIds, dueDate } = req.body;
    const result = await pool.query('INSERT INTO assignments (title, description, problem_ids, due_date) VALUES ($1, $2, $3, $4) RETURNING *', [title, description, problemIds, dueDate]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assignments/:id', requireLogin, requireRole('teacher'), async (req, res) => {
  try {
    const { title, description, problemIds, dueDate } = req.body;
    const result = await pool.query('UPDATE assignments SET title=$1, description=$2, problem_ids=$3, due_date=$4 WHERE id=$5 RETURNING *', [title, description, problemIds, dueDate, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assignments/:id', requireLogin, requireRole('teacher'), async (req, res) => {
  await pool.query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/submissions', requireLogin, async (req, res) => {
  const subs = await pool.query('SELECT * FROM submissions WHERE student_username = $1', [req.session.username]);
  res.json(subs.rows);
});

app.get('/api/submissions/all', requireLogin, requireRole('teacher'), async (req, res) => {
  const subs = await pool.query('SELECT * FROM submissions');
  res.json(subs.rows);
});

app.post('/api/submit-answer', requireLogin, requireRole('student'), async (req, res) => {
  try {
    const { assignmentId, problemId, answer } = req.body;
    let sub = await pool.query('SELECT * FROM submissions WHERE student_username = $1 AND assignment_id = $2 AND problem_id = $3', [req.session.username, assignmentId, problemId]);
    if (sub.rows.length === 0) {
      const prob = await pool.query('SELECT * FROM problems WHERE id = $1', [problemId]);
      const instances = generateValues(prob.rows[0].variables);
      await pool.query('INSERT INTO submissions (student_username, assignment_id, problem_id, problem_instances, attempts) VALUES ($1, $2, $3, $4, 0)', [req.session.username, assignmentId, problemId, JSON.stringify(instances)]);
      sub = await pool.query('SELECT * FROM submissions WHERE student_username = $1 AND assignment_id = $2 AND problem_id = $3', [req.session.username, assignmentId, problemId]);
    }
    const submission = sub.rows[0];
    const prob = await pool.query('SELECT * FROM problems WHERE id = $1', [problemId]);
    const problem = prob.rows[0];
    if (submission.is_correct || submission.attempts >= problem.max_attempts) {
      return res.json({ error: 'Maximum attempts reached or already correct' });
    }
    const userAnswer = parseFloat(answer);
    const correctAnswer = calculateAnswer(problem.formula, submission.problem_instances);
    const isCorrect = checkAnswer(userAnswer, correctAnswer, problem.tolerance_percent);
    const percentDiff = correctAnswer !== 0 ? Math.abs((userAnswer - correctAnswer) / correctAnswer * 100) : 0;
    await pool.query('UPDATE submissions SET user_answer = $1, correct_answer = $2, is_correct = $3, percent_diff = $4, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $5', [userAnswer, correctAnswer, isCorrect, percentDiff, submission.id]);
    const updated = await pool.query('SELECT * FROM submissions WHERE id = $1', [submission.id]);
    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/teacher', requireLogin, requireRole('teacher'), (req, res) => {
  res.sendFile(__dirname + '/teacher.html');
});

app.get('/student', requireLogin, requireRole('student'), (req, res) => {
  res.sendFile(__dirname + '/student.html');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Login: teacher/teacher123 or student1/student123');
});
