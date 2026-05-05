# Railway + Render Deployment Guide

## Current Setup ✅

Your budget tracker is now **production-ready** for Railway and Render with MySQL!

### Database
- **Type**: MySQL (via Railway)
- **Credentials**: Already configured in your account
- **Tables**: 
  - `transactions` - Income/expense tracking
  - `budgets` - Monthly budget limits

### Environment Configuration

#### Local Development (.env)
```
MYSQL_HOST=trolley.proxy.rlwy.net
MYSQL_PORT=52082
MYSQL_USER=root
MYSQL_PASSWORD=VpQJLusojwguqowugyGJDoesxQmUMWuV
MYSQL_DATABASE=railway
PORT=3000
NODE_ENV=development
```

#### Railway Deployment
When deployed to Railway, the system will:
1. Automatically detect `PORT` from Railway's environment
2. Use internal Railway MySQL URL: `mysql.railway.internal:3306`
3. Use other Railway environment variables: `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`

---

## Deployment Instructions

### To Railway

1. **Connect your GitHub repo**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub"
   - Select your `budget-tracker` repo

2. **Add MySQL Database**
   - In Railway dashboard: Click "Add Service" → "MySQL"
   - Variables will auto-populate in your service

3. **Deploy**
   - Railway will automatically run `npm install` and `npm start`
   - Your app will be available at: `https://budget-tracker-[random].railway.app`

### To Render

1. **Connect your GitHub repo**
   - Go to [render.com](https://render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repo

2. **Configure Service**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Runtime**: Node
   - **Plan**: Free (or paid)

3. **Add Environment Variables** (if using external MySQL)
   - Copy variables from `.env.example`
   - Update with your MySQL host/credentials

4. **Add Database** (optional)
   - Render allows PostgreSQL but not MySQL directly
   - **Recommendation**: Use Railway MySQL with connection string

---

## Health Check Endpoint

Test your deployed app:
```bash
curl https://your-app-url/api/health
```

Should return:
```json
{
  "status": "OK",
  "database": "Connected"
}
```

---

## Important Notes

- ✅ **Dynamic Port**: Server uses `PORT` env variable (required for Railway/Render)
- ✅ **MySQL**: Fully migrated from SQLite (no ephemeral storage issues)
- ✅ **Error Handling**: All API endpoints have proper error handling
- ✅ **CORS**: Enabled for frontend requests
- ✅ **.gitignore**: Protects sensitive files (node_modules, .env, .db files)
- ✅ **npm scripts**: `npm start` for production, `npm run dev` for local development

---

## Local Development

```bash
# Install dependencies
npm install

# Start development server (with nodemon auto-reload)
npm run dev

# Or production mode
npm start

# Test API
curl http://localhost:3000/api/health
curl http://localhost:3000/api/transactions
```

---

## Troubleshooting

**Issue**: Connection timeout to Railway
- **Solution**: Check if `.env` file has correct credentials

**Issue**: Database tables not created
- **Solution**: Check Railway MySQL logs for SQL errors

**Issue**: 500 errors on API calls
- **Solution**: Check server logs with `npm start` locally to debug

---

## Next Steps

1. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Setup MySQL with Railway for production"
   git push origin main
   ```

2. Deploy to Railway/Render using their GitHub integration

3. Test your deployed application with the health endpoint

Your app is now **production-ready**! 🚀
