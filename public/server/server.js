const path = require('path');
// Specify the correct path to .env file (project root)
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Debug: Check if env vars are loaded
console.log('🔍 Environment variables loaded:');
console.log(`   MYSQL_HOST: ${process.env.MYSQL_HOST ? '✅' : '❌'}`);
console.log(`   MYSQL_DATABASE: ${process.env.MYSQL_DATABASE ? '✅' : '❌'}`);
console.log(`   MYSQL_USER: ${process.env.MYSQL_USER ? '✅' : '❌'}`);
console.log(`   MYSQL_PASSWORD: ${process.env.MYSQL_PASSWORD ? '✅' : '❌'}`);

// ── MySQL Connection Pool ───────────────────────────────────────
// Use DATABASE_URL if available (Railway provides this), otherwise fallback to individual vars
const dbConfig = process.env.DATABASE_URL 
  ? process.env.DATABASE_URL
  : {
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      port: process.env.MYSQL_PORT,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };

console.log('📡 Connecting to database...');
console.log(`📍 Host: ${process.env.MYSQL_HOST || 'Not set'}:${process.env.MYSQL_PORT || 'Not set'}`);
console.log(`💾 Database: ${process.env.MYSQL_DATABASE || 'Not set'}`);

// Validate required environment variables
if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) {
  console.error('❌ Missing required database environment variables!');
  console.error('Please check your .env file has: MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE');
  process.exit(1);
}

const pool = mysql.createPool(dbConfig);

// ── Initialize Database Tables ──────────────────────────────────
async function initializeDB() {
  const connection = await pool.getConnection();
  try {
    // Transactions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('income', 'expense') NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        category VARCHAR(255) NOT NULL,
        note TEXT,
        date DATE NOT NULL DEFAULT (CURDATE()),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_date (date),
        INDEX idx_type (type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Budgets table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS budgets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category VARCHAR(255) NOT NULL,
        limit_amount DECIMAL(10, 2) NOT NULL,
        month VARCHAR(7) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_category_month (category, month),
        INDEX idx_month (month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

// Initialize on startup
initializeDB().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../..')));

// ── Transactions API ────────────────────────────────────────────

// GET all transactions (optional month filter)
app.get('/api/transactions', async (req, res) => {
  try {
    const { month } = req.query;
    const connection = await pool.getConnection();

    let rows;
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        connection.release();
        return res.status(400).json({ error: 'Invalid month format (use YYYY-MM)' });
      }
      [rows] = await connection.execute(
        `SELECT * FROM transactions
         WHERE DATE_FORMAT(date, '%Y-%m') = ?
         ORDER BY date DESC, created_at DESC`,
        [month]
      );
    } else {
      [rows] = await connection.execute(
        `SELECT * FROM transactions
         ORDER BY date DESC, created_at DESC`
      );
    }

    connection.release();
    res.json(rows);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// POST new transaction
app.post('/api/transactions', async (req, res) => {
  try {
    const { type, amount, category, note, date } = req.body;

    if (!type || !amount || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type (use income or expense)' });
    }

    const connection = await pool.getConnection();
    const finalDate = date || new Date().toISOString().split('T')[0];

    const [result] = await connection.execute(
      `INSERT INTO transactions (type, amount, category, note, date)
       VALUES (?, ?, ?, ?, ?)`,
      [type, parseFloat(amount), category, note || '', finalDate]
    );

    const [rows] = await connection.execute(
      `SELECT * FROM transactions WHERE id = ?`,
      [result.insertId]
    );

    connection.release();
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// DELETE transaction
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.execute(
      `DELETE FROM transactions WHERE id = ?`,
      [req.params.id]
    );
    connection.release();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// ── Summary API ─────────────────────────────────────────────────
app.get('/api/summary', async (req, res) => {
  try {
    const { month } = req.query;
    const connection = await pool.getConnection();

    let income, expense, byCategory;

    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        connection.release();
        return res.status(400).json({ error: 'Invalid month format (use YYYY-MM)' });
      }

      [[{ total: incomeTotal }]] = await connection.execute(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM transactions
         WHERE type = 'income' AND DATE_FORMAT(date, '%Y-%m') = ?`,
        [month]
      );

      [[{ total: expenseTotal }]] = await connection.execute(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM transactions
         WHERE type = 'expense' AND DATE_FORMAT(date, '%Y-%m') = ?`,
        [month]
      );

      [byCategory] = await connection.execute(
        `SELECT category, type, SUM(amount) as total
         FROM transactions
         WHERE DATE_FORMAT(date, '%Y-%m') = ?
         GROUP BY category, type
         ORDER BY total DESC`,
        [month]
      );

      income = incomeTotal;
      expense = expenseTotal;
    } else {
      [[{ total: incomeTotal }]] = await connection.execute(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM transactions WHERE type = 'income'`
      );

      [[{ total: expenseTotal }]] = await connection.execute(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM transactions WHERE type = 'expense'`
      );

      [byCategory] = await connection.execute(
        `SELECT category, type, SUM(amount) as total
         FROM transactions
         GROUP BY category, type
         ORDER BY total DESC`
      );

      income = incomeTotal;
      expense = expenseTotal;
    }

    connection.release();
    res.json({
      income,
      expense,
      balance: income - expense,
      byCategory
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ── Budgets API ─────────────────────────────────────────────────

// GET budgets
app.get('/api/budgets', async (req, res) => {
  try {
    const { month } = req.query;
    const m = month || new Date().toISOString().slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(m)) {
      return res.status(400).json({ error: 'Invalid month format (use YYYY-MM)' });
    }

    const connection = await pool.getConnection();
    const [budgets] = await connection.execute(
      `SELECT * FROM budgets WHERE month = ?`,
      [m]
    );

    // Enrich with spending data
    const enriched = await Promise.all(
      budgets.map(async (b) => {
        const [[{ total }]] = await connection.execute(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM transactions
           WHERE category = ? AND type = 'expense' AND DATE_FORMAT(date, '%Y-%m') = ?`,
          [b.category, m]
        );
        return { ...b, spent: total };
      })
    );

    connection.release();
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

// POST budget (upsert)
app.post('/api/budgets', async (req, res) => {
  try {
    const { category, limit_amount, month } = req.body;

    if (!category || !limit_amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const m = month || new Date().toISOString().slice(0, 7);

    const connection = await pool.getConnection();
    await connection.execute(
      `INSERT INTO budgets (category, limit_amount, month)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE limit_amount = VALUES(limit_amount)`,
      [category, parseFloat(limit_amount), m]
    );

    connection.release();
    res.json({ success: true });
  } catch (error) {
    console.error('Error creating/updating budget:', error);
    res.status(500).json({ error: 'Failed to save budget' });
  }
});

// DELETE budget
app.delete('/api/budgets/:id', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.execute(
      `DELETE FROM budgets WHERE id = ?`,
      [req.params.id]
    );
    connection.release();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

// ── Health Check ────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.execute('SELECT 1');
    connection.release();
    res.json({ status: 'OK', database: 'Connected' });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', database: 'Disconnected', error: error.message });
  }
});

// ── Start Server ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Budget Tracker running on port ${PORT}`);
  console.log(`📊 Database: ${process.env.MYSQL_DATABASE}`);
  console.log(`🏠 Host: ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await pool.end();
  process.exit(0);
});