require('dotenv').config();

const http = require('http');
const { createApp, attachErrorHandlers } = require('./src/v2/app');
const { config } = require('./src/v2/config');

function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    console.warn(`⚠️  Optional module ${modulePath} not loaded`, error.message);
    return null;
  }
}

async function bootstrap() {
  const app = await createApp();

  const authRouter = safeRequire('./routes/auth');
  if (authRouter) {
    app.use('/api/auth', authRouter);
    if (typeof authRouter.handleWorkOSCallback === 'function') {
      app.get('/callback', authRouter.handleWorkOSCallback);
    }
  }

  attachErrorHandlers(app);

  const server = http.createServer(app);
  server.listen(config.app.port, () => {
    console.log(`🚀 API listening on port ${config.app.port}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
