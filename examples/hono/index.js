import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import * as decentauth from '../../index.js';

const app = new Hono();

const authPrefix = '/auth';

const authServer = new decentauth.Server({
  config: {
    path_prefix: authPrefix,
    login_methods: [
      {
        type: decentauth.LOGIN_METHOD_OIDC,
        name: "LastLogin",
        uri: "https://lastlogin.net",
      },
      {
        type: decentauth.LOGIN_METHOD_ATPROTO,
      },
    ],
  },
});

app.get('/', async (c) => {

  // Note the use of `.raw`. This returns the standard `Request` object
  const session = await authServer.getSession(c.req.raw);

  if (!session) {
    return c.redirect(authPrefix);
  }

  return c.html(`
    <p>Session info:</p>
    <pre><code>${JSON.stringify(session, null, 2)}</code></pre>
    <a href='${authPrefix}/logout'>Logout</a>
  `);
});

app.all(authPrefix + '/*', (c) => authServer.handle(c.req.raw));

serve(app);
