# MediaFire API

This is a Node.js application that provides an API for extracting direct download links from MediaFire and streaming files.

## Features

- Extract direct MediaFire download links
- Stream MediaFire files with Range support (for seeking in videos)

## API Endpoints

- `GET /getlink?url=<mediafire_url>` - Returns resolved direct MediaFire link
- `GET /stream?url=<mediafire_url>` - Streams MediaFire file with Range support

## Deployment to Render (Recommended)

Render offers a free tier that is compatible with this application.

### Steps to deploy:

1. Create a GitHub repository for your project
2. Push your code to GitHub
3. Go to [render.com](https://render.com/) and sign up
4. Click "New +" and select "Web Service"
5. Connect your GitHub account and select this repository
6. Render will automatically detect the Node.js environment
7. Configure the service:
   - Name: `mediafire-api`
   - Region: Choose the closest to your users
   - Branch: `main` or `master`
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: `Free`
8. Click "Create Web Service"

Your application will be deployed and available at a URL like `https://mediafire-api.onrender.com`.

## Alternative Free Hosting Options

### 1. Heroku

Heroku also offers a free tier, but requires additional setup for Puppeteer:

1. Create a `Procfile` with `web: node server.js`
2. Add the Puppeteer buildpack:
   ```
   heroku buildpacks:add jontewks/puppeteer
   ```
3. Deploy to Heroku using Git or GitHub integration

### 2. Railway

Railway is another good option with a free tier:

1. Create a GitHub repository for your project
2. Go to [railway.app](https://railway.app/) and sign up
3. Click "New Project" and connect your GitHub repository
4. Railway will automatically detect the Node.js environment
5. Configure environment variables if needed
6. Deploy

## Notes

- The application uses ES modules (import statements) which requires Node.js 14+ with "type": "module" in package.json
- Puppeteer requires a headless browser environment which might have limited resources on free tiers
- Free hosting services may have limitations on uptime, resource usage, and request limits
