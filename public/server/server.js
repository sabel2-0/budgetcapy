const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Init DB
const db = new Database('budget.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    note TEXT,
    date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL UNIQUE,
    limit_amount REAL NOT NULL,
    month TEXT NOT NULL DEFAULT (strftime('%Y-%m', 'now'))
  );
`);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ── Transactions ────────────────────────────────────────────────
// GET all transactions (with optional month filter)
app.get('/api/transactions', (req, res) => {
  const { month } = req.query; // format: YYYY-MM
  let rows;
  if (month) {
    rows = db.prepare(`SELECT * FROM transactions WHERE strftime('%Y-%m', date) = ? ORDER BY date DESC, created_at DESC`).all(month);
  } else {
    rows = db.prepare(`SELECT * FROM transactions ORDER BY date DESC, created_at DESC`).all();
  }
  res.json(rows);
});

// POST new transaction
app.post('/api/transactions', (req, res) => {
  const { type, amount, category, note, date } = req.body;
  if (!type || !amount || !category) return res.status(400).json({ error: 'Missing required fields' });
  const stmt = db.prepare(`INSERT INTO transactions (type, amount, category, note, date) VALUES (?, ?, ?, ?, ?)`);
  const info = stmt.run(type, parseFloat(amount), category, note || '', date || new Date().toISOString().split('T')[0]);
  const row = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json(row);
});

// DELETE transaction
app.delete('/api/transactions/:id', (req, res) => {
  db.prepare(`DELETE FROM transactions WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// ── Summary ─────────────────────────────────────────────────────
app.get('/api/summary', (req, res) => {
  const { month } = req.query;
  const filter = month ? `WHERE strftime('%Y-%m', date) = '${month}'` : '';

  const income = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions ${filter} AND type = 'income'`.replace('WHERE', month ? 'WHERE'  : 'WHERE 1=1 AND')).get();
  const expense = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions ${filter} AND type = 'expense'`.replace('WHERE', month ? 'WHERE' : 'WHERE 1=1 AND')).get();

  const byCategory = db.prepare(`
    SELECT category, type, SUM(amount) as total
    FROM transactions ${filter || 'WHERE 1=1'}
    GROUP BY category, type
    ORDER BY total DESC
  `).all();

  res.json({
    income: income.total,
    expense: expense.total,
    balance: income.total - expense.total,
    byCategory
  });
});

// ── Budgets ──────────────────────────────────────────────────────
app.get('/api/budgets', (req, res) => {
  const { month } = req.query;
  const m = month || new Date().toISOString().slice(0, 7);
  const budgets = db.prepare(`SELECT * FROM budgets WHERE month = ?`).all(m);

  // Attach spending per category
  const enriched = budgets.map(b => {
    const spent = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions
      WHERE category = ? AND type = 'expense' AND strftime('%Y-%m', date) = ?
    `).get(b.category, m);
    return { ...b, spent: spent.total };
  });

  res.json(enriched);
});

app.post('/api/budgets', (req, res) => {
  const { category, limit_amount, month } = req.body;
  const m = month || new Date().toISOString().slice(0, 7);
  const stmt = db.prepare(`
    INSERT INTO budgets (category, limit_amount, month) VALUES (?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET limit_amount = excluded.limit_amount
  `);
  stmt.run(category, parseFloat(limit_amount), m);
  res.json({ success: true });
});

app.delete('/api/budgets/:id', (req, res) => {
  db.prepare(`DELETE FROM budgets WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Budget Tracker running at http://localhost:${PORT}`);
  console.log(`📁 SQLite database: budget.db`);
});