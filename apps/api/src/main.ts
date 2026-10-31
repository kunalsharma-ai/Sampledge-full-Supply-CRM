import 'dotenv/config';
import { createApp } from './bootstrap';
import { config } from './common/config';

createApp()
  .then(async (app) => {
    await app.listen(config.port);
    console.log(`Sampledge API on http://localhost:${config.port}/api/v1`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
