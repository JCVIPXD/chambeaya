import { createApp } from './app.js';

const port = Number(process.env.API_PORT ?? 4000);

createApp().listen(port, () => {
  console.info(`Chambeaya API listening on port ${port}`);
});

